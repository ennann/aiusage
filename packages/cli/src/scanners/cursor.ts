import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IngestBreakdown } from '@aiusage/shared';
import { normalizeModelName, dateKey } from './utils.js';

// ── 环境变量 ──

const CURSOR_CONFIG_DIR_ENV = 'CURSOR_CONFIG_DIR';
const CURSOR_STATE_DB_PATH_ENV = 'CURSOR_STATE_DB_PATH';
const CURSOR_WEB_BASE_URL_ENV = 'CURSOR_WEB_BASE_URL';
const CURSOR_STATE_DB_RELATIVE = join('User', 'globalStorage', 'state.vscdb');
const CURSOR_SESSION_COOKIE = 'WorkosCursorSessionToken';

// ── 路径解析 ──

function getDefaultDbPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Cursor', CURSOR_STATE_DB_RELATIVE);
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Cursor', CURSOR_STATE_DB_RELATIVE);
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(xdg, 'Cursor', CURSOR_STATE_DB_RELATIVE);
}

function findDbPath(): string | null {
  const explicit = process.env[CURSOR_STATE_DB_PATH_ENV]?.trim();
  if (explicit) {
    const p = resolve(explicit);
    return existsSync(p) ? p : null;
  }
  const dirs = process.env[CURSOR_CONFIG_DIR_ENV]?.trim();
  const candidates = dirs
    ? dirs.split(',').map(v => {
        const r = resolve(v.trim());
        return r.endsWith('.vscdb') ? r : join(r, CURSOR_STATE_DB_RELATIVE);
      })
    : [getDefaultDbPath()];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── SQLite 读取（使用 node:sqlite，Node 22+）──

interface AuthState {
  accessToken?: string;
}

function readAuthFromDb(dbPath: string): AuthState {
  // 动态 import node:sqlite 避免老版本 Node 报错
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(dbPath, { open: true });
  try {
    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ? LIMIT 1');
    const row = stmt.get('cursorAuth/accessToken') as { value?: string | Buffer } | undefined;
    const raw = row?.value;
    let token: string | undefined;
    if (typeof raw === 'string') token = raw.trim() || undefined;
    else if (Buffer.isBuffer(raw)) token = raw.toString('utf8').trim() || undefined;
    return { accessToken: token };
  } finally {
    db.close();
  }
}

async function withSnapshot<T>(dbPath: string, cb: (snap: string) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'aiusage-cursor-'));
  const snap = join(dir, 'state.vscdb');
  await copyFile(dbPath, snap);
  for (const suffix of ['-shm', '-wal']) {
    if (existsSync(`${dbPath}${suffix}`)) await copyFile(`${dbPath}${suffix}`, `${snap}${suffix}`);
  }
  try {
    return cb(snap);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readAuth(dbPath: string): Promise<AuthState> {
  try {
    return readAuthFromDb(dbPath);
  } catch (err) {
    if (err instanceof Error && /database is locked/i.test(err.message)) {
      return withSnapshot(dbPath, snap => readAuthFromDb(snap));
    }
    throw err;
  }
}

// ── JWT sub 解析 ──

function jwtSub(token: string): string | undefined {
  const part = token.split('.')[1];
  if (!part) return undefined;
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  try {
    return (JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { sub?: string }).sub?.trim();
  } catch {
    return undefined;
  }
}

// ── Cursor API ──

function getWebBaseUrl(): string {
  return (process.env[CURSOR_WEB_BASE_URL_ENV]?.trim() || 'https://cursor.com').replace(/\/+$/, '');
}

async function fetchCsv(accessToken: string): Promise<string> {
  const url = new URL('/api/dashboard/export-usage-events-csv?strategy=tokens', getWebBaseUrl());
  const sub = jwtSub(accessToken);
  const cookieValues = [accessToken, ...(sub ? [`${sub}::${accessToken}`] : [])];

  const attempts: Array<Record<string, string>> = [{ Authorization: `Bearer ${accessToken}` }];
  for (const cv of cookieValues) {
    attempts.push({ Cookie: `${CURSOR_SESSION_COOKIE}=${cv}` });
    attempts.push({ Authorization: `Bearer ${accessToken}`, Cookie: `${CURSOR_SESSION_COOKIE}=${cv}` });
  }

  const failures: string[] = [];
  for (const headers of attempts) {
    const res = await fetch(url, { headers: { Accept: 'text/csv,*/*;q=0.8', ...headers } });
    if (res.ok) return res.text();
    failures.push(`${res.status} ${res.statusText}`);
  }
  throw new Error(`Cursor API failed: ${failures.join(', ')}`);
}

// ── CSV 解析 ──

function parseCsvLine(line: string): string[] {
  const vals: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      vals.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  vals.push(cur);
  return vals;
}

function parseNum(v?: string): number {
  const n = Number((v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function parseDateStr(v?: string): string | null {
  const s = v?.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : dateKey(d);
}

// ── 主入口 ──

export async function isCursorAvailable(): Promise<boolean> {
  const dbPath = findDbPath();
  if (!dbPath) return false;
  try {
    const auth = await readAuth(dbPath);
    return Boolean(auth.accessToken);
  } catch {
    return false;
  }
}

export async function scanCursor(targetDate: string): Promise<IngestBreakdown[]> {
  return (await scanCursorDates([targetDate])).get(targetDate) ?? [];
}

export async function scanCursorDates(
  targetDates: string[],
): Promise<Map<string, IngestBreakdown[]>> {
  const dateSet = new Set(targetDates);
  const empty = new Map(targetDates.map(d => [d, [] as IngestBreakdown[]]));

  const dbPath = findDbPath();
  if (!dbPath) return empty;

  let auth: AuthState;
  try {
    auth = await readAuth(dbPath);
  } catch {
    return empty;
  }
  if (!auth.accessToken) return empty;

  let csvText: string;
  try {
    csvText = await fetchCsv(auth.accessToken);
  } catch {
    return empty;
  }

  // 按 date → model 聚合
  const grouped = new Map<string, Map<string, IngestBreakdown>>();
  for (const d of dateSet) grouped.set(d, new Map());

  let headers: string[] | null = null;
  for (const rawLine of csvText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    if (!headers) { headers = values; continue; }

    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });

    const date = parseDateStr(row['Date']);
    if (!date || !dateSet.has(date)) continue;

    const rawModel = row['Model']?.trim();
    if (!rawModel) continue;
    const model = normalizeModelName(rawModel);

    const total = parseNum(row['Total Tokens']) || parseNum(row['Tokens']);
    if (!total) continue;

    const inputWithCache = parseNum(row['Input (w/ Cache Write)']);
    const inputWithout = parseNum(row['Input (w/o Cache Write)']);
    const cacheRead = parseNum(row['Cache Read']);
    const output = parseNum(row['Output Tokens']);
    const inputTokens = inputWithCache + inputWithout + cacheRead;

    const dayMap = grouped.get(date)!;
    const existing = dayMap.get(model);
    if (existing) {
      existing.eventCount += 1;
      existing.inputTokens += inputTokens;
      existing.cachedInputTokens += cacheRead;
      existing.cacheWriteTokens += inputWithCache;
      existing.outputTokens += output;
    } else {
      dayMap.set(model, {
        provider: 'cursor',
        product: 'cursor',
        channel: 'ide',
        model,
        project: 'unknown',
        projectDisplay: 'unknown',
        eventCount: 1,
        inputTokens,
        cachedInputTokens: cacheRead,
        cacheWriteTokens: inputWithCache,
        outputTokens: output,
        reasoningOutputTokens: 0,
      });
    }
  }

  return new Map([...grouped.entries()].map(([d, m]) => [d, [...m.values()]]));
}
