import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveTokscaleTraeCacheDir, resolveTraeIntlCacheDir } from './scanners/trae.js';

/**
 * Trae international account usage sync.
 *
 * The credential discovery, SafeStorage decryption and official API contract
 * follow tokscale's MIT-licensed implementation:
 * https://github.com/junhoyeo/tokscale/blob/main/crates/tokscale-cli/src/trae.rs
 */

const DEFAULT_HOST = 'https://api-sg-central.trae.ai';
// Stable IDs from Trae's shipped product.json. IDE and Solo use different
// OAuth clients even though their account usage endpoint is shared.
const CLIENT_IDS: Record<TraeIntlCredentialVariant, string> = {
  ide: 'ono9krqynydwx5',
  solo: 'en1oxy7wnw8j9n',
};
const EXCHANGE_TOKEN_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken';
const USAGE_PATH = '/trae/api/v1/pay/query_user_usage_group_by_session';
const PAGE_SIZE = 20;
const PAGE_DELAY_MS = 300;
const DEFAULT_SINCE_DAYS = 180;

export type TraeIntlCredentialVariant = 'ide' | 'solo';

interface TraeIntlCredentials {
  variant: TraeIntlCredentialVariant;
  token: string;
  refreshToken: string;
  expiredAt: string;
  refreshExpiredAt: string;
  host: string;
  clientId: string;
  userId?: string;
}

export interface TraeIntlSession {
  model_name?: string;
  mode?: string;
  session_id?: string;
  usage_time?: number;
  dollar_float?: number;
  extra_info?: {
    input_token?: number;
    output_token?: number;
    cache_read_token?: number;
    cache_write_token?: number;
  };
  [key: string]: unknown;
}

export interface TraeIntlSyncOptions {
  sinceDays?: number;
  credentialVariant?: TraeIntlCredentialVariant | 'auto';
  cacheDir?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface TraeIntlSyncResult {
  edition: 'intl';
  scope: 'account';
  credentialVariant: TraeIntlCredentialVariant | 'environment';
  cacheDir: string;
  sinceDays: number;
  fetchedSessions: number;
  storedSessions: number;
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  };
}

export async function syncTraeIntlUsage(options: TraeIntlSyncOptions = {}): Promise<TraeIntlSyncResult> {
  const sinceDays = normalizeSinceDays(options.sinceDays);
  const cacheDir = options.cacheDir ?? resolveTraeIntlCacheDir();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const releaseLock = await acquireTraeIntlSyncLock(dirname(cacheDir));
  try {
    return await performTraeIntlSync(options, sinceDays, cacheDir, fetchImpl, now);
  } finally {
    await releaseLock();
  }
}

async function performTraeIntlSync(
  options: TraeIntlSyncOptions,
  sinceDays: number,
  cacheDir: string,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<TraeIntlSyncResult> {
  const resolved = await resolveCredentials(options.credentialVariant ?? 'auto', fetchImpl, cacheDir);

  const startTime = Math.floor(now.getTime() / 1000) - sinceDays * 86_400;
  const endTime = Math.floor(now.getTime() / 1000);
  let credentials = resolved.credentials;
  let sessions: TraeIntlSession[];

  try {
    sessions = await fetchUsagePages(credentials.host, credentials.token, startTime, endTime, fetchImpl);
  } catch (error) {
    if (!(error instanceof TraeIntlHttpError) || error.status !== 401 || !credentials.refreshToken) throw error;
    credentials = await exchangeCredentials(credentials, fetchImpl);
    await saveCredentials(credentials, cacheDir);
    sessions = await fetchUsagePages(credentials.host, credentials.token, startTime, endTime, fetchImpl);
  }

  const canonicalPath = join(cacheDir, 'usage.json');
  const existing = await readSessionArray(canonicalPath);
  const merged = mergeTraeIntlSessions(existing, sessions);
  await writePrivateJson(canonicalPath, merged);

  const totals = merged.reduce<TraeIntlSyncResult['totals']>((sum, session) => {
    const extra = session.extra_info ?? {};
    sum.inputTokens += tokenValue(extra.input_token);
    sum.cachedInputTokens += tokenValue(extra.cache_read_token);
    sum.cacheWriteTokens += tokenValue(extra.cache_write_token);
    sum.outputTokens += tokenValue(extra.output_token);
    sum.costUSD += positiveNumber(session.dollar_float);
    return sum;
  }, {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUSD: 0,
  });
  totals.totalTokens = totals.inputTokens + totals.cachedInputTokens + totals.cacheWriteTokens + totals.outputTokens;
  totals.costUSD = Math.round(totals.costUSD * 1_000_000) / 1_000_000;

  return {
    edition: 'intl',
    scope: 'account',
    credentialVariant: resolved.source,
    cacheDir,
    sinceDays,
    fetchedSessions: sessions.length,
    storedSessions: merged.length,
    totals,
  };
}

async function acquireTraeIntlSyncLock(cacheRoot: string): Promise<() => Promise<void>> {
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await chmod(cacheRoot, 0o700).catch(() => undefined);
  const lockPath = join(cacheRoot, 'sync.lock');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${process.pid} ${Math.floor(Date.now() / 1000)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      return async () => {
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (!(await isStaleSyncLock(lockPath))) {
        throw new Error(`另一个 Trae 国际版同步正在运行（锁文件: ${lockPath}）`);
      }
      await unlink(lockPath).catch(() => undefined);
    }
  }

  throw new Error(`无法获取 Trae 国际版同步锁（${lockPath}）`);
}

async function isStaleSyncLock(lockPath: string): Promise<boolean> {
  try {
    const pid = Number((await readFile(lockPath, 'utf8')).trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      const code = isRecord(error) ? stringValue(error.code) : '';
      return code === 'ESRCH';
    }
  } catch {
    return true;
  }
}

function isFileExistsError(error: unknown): boolean {
  return isRecord(error) && stringValue(error.code) === 'EEXIST';
}

/** Keep the newest aggregate snapshot for every international session id. */
export function mergeTraeIntlSessions(
  existing: TraeIntlSession[],
  incoming: TraeIntlSession[],
): TraeIntlSession[] {
  const sessions = new Map<string, TraeIntlSession>();
  for (const session of [...existing, ...incoming]) {
    const id = stringValue(session.session_id);
    const usageTime = tokenValue(session.usage_time);
    if (!id || usageTime === 0) continue;
    const previous = sessions.get(id);
    const previousTime = tokenValue(previous?.usage_time);
    if (!previous || usageTime > previousTime || (usageTime === previousTime && sessionWeight(session) >= sessionWeight(previous))) {
      sessions.set(id, session);
    }
  }
  return [...sessions.values()].sort((a, b) => {
    const timeDiff = tokenValue(a.usage_time) - tokenValue(b.usage_time);
    return timeDiff || stringValue(a.session_id).localeCompare(stringValue(b.session_id));
  });
}

interface ResolvedCredentials {
  credentials: TraeIntlCredentials;
  source: TraeIntlCredentialVariant | 'environment';
}

async function resolveCredentials(
  requested: TraeIntlCredentialVariant | 'auto',
  fetchImpl: typeof fetch,
  cacheDir: string,
): Promise<ResolvedCredentials> {
  const environmentToken = process.env.AIUSAGE_TRAE_INTL_TOKEN?.trim();
  if (environmentToken) {
    return {
      source: 'environment',
      credentials: {
        variant: requested === 'solo' ? 'solo' : 'ide',
        token: stripAuthorizationPrefix(environmentToken),
        refreshToken: '',
        expiredAt: '',
        refreshExpiredAt: '',
        host: normalizeHost(process.env.AIUSAGE_TRAE_INTL_HOST || DEFAULT_HOST),
        clientId: process.env.AIUSAGE_TRAE_INTL_CLIENT_ID?.trim()
          || CLIENT_IDS[requested === 'solo' ? 'solo' : 'ide'],
      },
    };
  }

  const variants: TraeIntlCredentialVariant[] = requested === 'auto' ? ['ide', 'solo'] : [requested];
  const errors: string[] = [];
  for (const variant of variants) {
    const cachedCandidates = [
      ['AIUsage cache', await loadCredentials(variant, cacheDir)],
      ['tokscale cache', await loadTokscaleCredentials(variant)],
    ] as const;
    for (const [source, cached] of cachedCandidates) {
      if (!cached) continue;
      try {
        const credentials = await ensureUsableCredentials(cached, fetchImpl);
        await saveCredentials(credentials, cacheDir);
        return { credentials, source: variant };
      } catch (error) {
        errors.push(`${variant} ${source}: ${sanitizeError(error)}`);
      }
    }

    try {
      const credentials = await ensureUsableCredentials(await decryptDesktopCredentials(variant), fetchImpl);
      await saveCredentials(credentials, cacheDir);
      return { credentials, source: variant };
    } catch (error) {
      errors.push(`${variant}: ${sanitizeError(error)}`);
    }
  }

  throw new Error(`未能读取 Trae 国际版登录信息。请先登录 Trae IDE/Trae Solo 后重试。${errors.length ? ` (${errors.join('; ')})` : ''}`);
}

async function ensureUsableCredentials(
  credentials: TraeIntlCredentials,
  fetchImpl: typeof fetch,
): Promise<TraeIntlCredentials> {
  if (!isExpired(credentials.expiredAt, 300_000)) return credentials;
  if (!credentials.refreshToken) throw new Error('access token 已过期且没有 refresh token');
  if (isExpired(credentials.refreshExpiredAt, 86_400_000)) throw new Error('refresh token 已过期');
  return exchangeCredentials(credentials, fetchImpl);
}

async function decryptDesktopCredentials(variant: TraeIntlCredentialVariant): Promise<TraeIntlCredentials> {
  if (process.platform !== 'darwin') {
    throw new Error('自动读取 Trae 国际版登录信息目前仅支持 macOS；可通过 AIUSAGE_TRAE_INTL_TOKEN 提供访问令牌');
  }
  const appDir = variant === 'ide' ? 'Trae' : 'TRAE SOLO';
  const storagePath = join(homedir(), 'Library', 'Application Support', appDir, 'User', 'globalStorage', 'storage.json');
  if (!existsSync(storagePath)) throw new Error(`未找到 ${appDir} storage.json`);
  const storage = JSON.parse(await readFile(storagePath, 'utf8')) as Record<string, unknown>;
  const exact = storage['iCubeAuthInfo://icube.cloudide'];
  const candidates = Object.entries(storage)
    .filter(([key, value]) => key.startsWith('iCubeAuthInfo') && typeof value === 'string')
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  const encoded = typeof exact === 'string' ? exact : candidates[0];
  if (!encoded) throw new Error('storage.json 中没有 iCubeAuthInfo');
  const raw = JSON.parse(decodeTraeIntlAuthInfo(encoded)) as Record<string, unknown>;
  const token = stringValue(raw.token);
  if (!token) throw new Error('解密结果缺少 token');
  return {
    variant,
    token,
    refreshToken: stringValue(raw.refreshToken),
    expiredAt: stringValue(raw.expiredAt),
    refreshExpiredAt: stringValue(raw.refreshExpiredAt),
    host: normalizeHost(stringValue(raw.host) || DEFAULT_HOST),
    clientId: process.env.AIUSAGE_TRAE_INTL_CLIENT_ID?.trim() || CLIENT_IDS[variant],
    userId: stringValue(raw.userId) || undefined,
  };
}

/** Trae releases have stored auth info as either plain JSON or an encrypted blob. */
export function decodeTraeIntlAuthInfo(encoded: string): string {
  const value = encoded.trim();
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) return value;
    } catch {
      throw new Error('Trae 国际版明文凭证 JSON 无效');
    }
  }
  return decryptTraeIntlAuthBlob(value);
}

export function decryptTraeIntlAuthBlob(encoded: string): string {
  const blob = Buffer.from(encoded.trim(), 'base64');
  const magic = Buffer.from([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]);
  if (blob.length < magic.length + 32 + 16 || !blob.subarray(0, magic.length).equals(magic)) {
    throw new Error('Trae 国际版凭证格式无效');
  }
  const salt = blob.subarray(magic.length, magic.length + 32);
  const ciphertext = blob.subarray(magic.length + 32);
  if (ciphertext.length % 16 !== 0) throw new Error('Trae 国际版凭证密文长度无效');

  const jg = [82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251, 124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203, 84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78, 8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37];
  const kg = [31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95, 96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239, 160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97, 23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125];
  const password = Buffer.from(jg.map((value, index) => value ^ kg[index]));
  const saltHash = createHash('sha512').update(salt).digest();
  const derived = createHash('sha512').update(Buffer.concat([saltHash, password])).digest();
  const decipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length < 64) throw new Error('Trae 国际版凭证明文长度无效');
  const expectedHash = plaintext.subarray(0, 64);
  const data = plaintext.subarray(64);
  const actualHash = createHash('sha512').update(data).digest();
  if (!timingSafeEqual(expectedHash, actualHash)) throw new Error('Trae 国际版凭证完整性校验失败');
  return data.toString('utf8');
}

async function exchangeCredentials(credentials: TraeIntlCredentials, fetchImpl: typeof fetch): Promise<TraeIntlCredentials> {
  if (!credentials.refreshToken) throw new Error('Trae 国际版 refresh token 不可用');
  if (credentials.refreshExpiredAt && isExpired(credentials.refreshExpiredAt, 86_400_000)) {
    throw new Error('Trae 国际版 refresh token 已过期，请重新登录客户端');
  }
  const response = await requestJson<Record<string, unknown>>(
    `${normalizeHost(credentials.host)}${EXCHANGE_TOKEN_PATH}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cloudide-token': credentials.token,
      },
      body: JSON.stringify({
        ClientID: credentials.clientId,
        RefreshToken: credentials.refreshToken,
        ClientSecret: '-',
        UserID: '',
      }),
    },
    fetchImpl,
    15_000,
  );
  const result = isRecord(response.Result) ? response.Result : {};
  const token = stringValue(result.Token);
  if (!token) throw new Error('Trae 国际版刷新接口没有返回 Token');
  return {
    ...credentials,
    token,
    refreshToken: stringValue(result.RefreshToken) || credentials.refreshToken,
    expiredAt: epochMsToIso(result.TokenExpireAt),
    refreshExpiredAt: epochMsToIso(result.RefreshExpireAt),
  };
}

async function fetchUsagePages(
  host: string,
  token: string,
  startTime: number,
  endTime: number,
  fetchImpl: typeof fetch,
): Promise<TraeIntlSession[]> {
  const all: TraeIntlSession[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const response = await requestJson<Record<string, unknown>>(
      `${normalizeHost(host)}${USAGE_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Cloud-IDE-JWT ${token}`,
        },
        body: JSON.stringify({
          start_time: startTime,
          end_time: endTime,
          page_size: PAGE_SIZE,
          page_num: page,
          usage_type: [5, 6],
        }),
      },
      fetchImpl,
      30_000,
    );
    const batch = Array.isArray(response.user_usage_group_by_sessions)
      ? response.user_usage_group_by_sessions.filter(isRecord) as TraeIntlSession[]
      : [];
    all.push(...batch);
    const total = positiveInteger(response.total);
    if (batch.length === 0 || (total != null && all.length >= total)) break;
    await delay(PAGE_DELAY_MS);
  }
  return all;
}

class TraeIntlHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new TraeIntlHttpError(response.status, `Trae 国际版接口返回 ${response.status}: ${sanitizeResponse(text)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Trae 国际版接口返回了无效 JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function loadCredentials(
  variant: TraeIntlCredentialVariant,
  cacheDir: string,
): Promise<TraeIntlCredentials | null> {
  return readCredentialFile(join(dirname(cacheDir), `credentials-${variant}.json`), variant);
}

async function loadTokscaleCredentials(variant: TraeIntlCredentialVariant): Promise<TraeIntlCredentials | null> {
  const root = dirname(resolveTokscaleTraeCacheDir());
  return readCredentialFile(join(root, `credentials-${variant}.json`), variant);
}

async function readCredentialFile(path: string, fallbackVariant: TraeIntlCredentialVariant): Promise<TraeIntlCredentials | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const token = stringValue(raw.token);
    if (!token) return null;
    const serializedVariant = stringValue(raw.variant).toLowerCase();
    return {
      variant: serializedVariant === 'solo' ? 'solo' : serializedVariant === 'ide' ? 'ide' : fallbackVariant,
      token,
      refreshToken: stringValue(raw.refreshToken) || stringValue(raw.refresh_token),
      expiredAt: stringValue(raw.expiredAt) || stringValue(raw.expired_at),
      refreshExpiredAt: stringValue(raw.refreshExpiredAt) || stringValue(raw.refresh_expired_at),
      host: normalizeHost(stringValue(raw.host) || DEFAULT_HOST),
      clientId: stringValue(raw.clientId) || stringValue(raw.client_id) || CLIENT_IDS[fallbackVariant],
      userId: stringValue(raw.userId) || stringValue(raw.user_id) || undefined,
    };
  } catch {
    return null;
  }
}

async function saveCredentials(credentials: TraeIntlCredentials, cacheDir: string): Promise<void> {
  const path = join(dirname(cacheDir), `credentials-${credentials.variant}.json`);
  await writePrivateJson(path, credentials);
}

async function readSessionArray(path: string): Promise<TraeIntlSession[]> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return Array.isArray(value) ? value.filter(isRecord) as TraeIntlSession[] : [];
  } catch {
    return [];
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
  const tempPath = join(dir, `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const handle = await open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  await rename(tempPath, path);
  await chmod(path, 0o600).catch(() => undefined);
}

function normalizeSinceDays(value: number | undefined): number {
  if (value == null) return DEFAULT_SINCE_DAYS;
  if (!Number.isInteger(value) || value <= 0 || value > 3650) {
    throw new Error('--since 必须是 1 到 3650 之间的整数天数');
  }
  return value;
}

function normalizeHost(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Trae 国际版 API host 无效');
  }
  if (url.protocol !== 'https:') throw new Error('Trae 国际版 API host 必须使用 HTTPS');
  return url.origin;
}

function stripAuthorizationPrefix(value: string): string {
  return value.replace(/^(?:Cloud-IDE-JWT|Bearer)\s+/i, '').trim();
}

function isExpired(value: string, marginMs: number): boolean {
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || Date.now() >= timestamp - marginMs;
}

function epochMsToIso(value: unknown): string {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : '';
}

function tokenValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function positiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function sessionWeight(session: TraeIntlSession): number {
  const extra = session.extra_info ?? {};
  return tokenValue(extra.input_token) + tokenValue(extra.output_token)
    + tokenValue(extra.cache_read_token) + tokenValue(extra.cache_write_token);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeResponse(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/("(?:token|refreshToken|RefreshToken|Token)"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2')
    .replace(/eyJ[A-Za-z0-9_.-]+/g, '[token]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[redacted]')
    .slice(0, 300);
}

function sanitizeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (message && !parts.includes(message)) parts.push(message);
    if (isRecord(current) && stringValue(current.code)) parts.push(stringValue(current.code));
    current = isRecord(current) ? current.cause : undefined;
  }
  return sanitizeResponse(parts.join(': '));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
