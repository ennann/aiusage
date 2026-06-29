import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  dateKey,
  parseTs,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  runWithConcurrency,
} from './utils.js';

/**
 * Kiro scanner.
 *
 * 数据目录:
 * - ~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/*.chat
 * - ~/.kiro/sessions/cli/*.json
 */

interface KiroMetadata {
  modelId?: string;
  modelProvider?: string;
  startTime?: string | number;
  endTime?: string | number;
}

interface KiroSelectedModelRecord {
  selectedModel?: string;
}

interface KiroModelInfo {
  model_name?: string;
  model_id?: string;
}

interface KiroSessionState {
  rts_model_state?: {
    model_info?: KiroModelInfo;
  };
  conversation_metadata?: {
    user_turn_metadatas?: Array<{
      end_timestamp?: string | number;
      start_timestamp?: string | number;
      timestamp?: string | number;
      metering_usage?: Array<{
        value?: number | string;
        unit?: string;
      }>;
    }>;
  };
}

interface KiroSessionRecord extends KiroSelectedModelRecord {
  session_id?: string;
  created_at?: string | number;
  updated_at?: string | number;
  session_state?: KiroSessionState;
  metadata?: KiroMetadata;
}

interface KiroChatRecord extends KiroSelectedModelRecord {
  actionId?: string;
  executionId?: string;
  metadata?: KiroMetadata;
  chat?: unknown[];
}

interface KiroTokenRecord {
  model?: unknown;
  provider?: unknown;
  promptTokens?: unknown;
  generatedTokens?: unknown;
  tokens_prompt?: unknown;
  tokens_generated?: unknown;
  timestamp?: unknown;
}

interface KiroSqliteTokenRow {
  model?: unknown;
  provider?: unknown;
  tokens_prompt?: unknown;
  tokens_generated?: unknown;
  timestamp?: unknown;
}

type KiroRecord = KiroChatRecord | KiroSessionRecord;

interface KiroTokenTotals {
  input: number;
  output: number;
  costUSD?: number;
}

type KiroTokenUsageMap = Map<string, Map<string, KiroTokenTotals>>;

const KIRO_TOKEN_SOURCE = 'tokens_generated.jsonl';
const KIRO_SQLITE_SOURCE = 'devdata.sqlite';
const KIRO_CLI_DB_SOURCE = 'data.sqlite3';
const KIRO_OVERAGE_CREDIT_RATE_USD = 0.04;
const KIRO_DEFAULT_CREDIT_COST_ENABLED = true;
const KIRO_TOKEN_MODEL_ALIASES: Record<string, string> = {
  qdev: 'claude-opus-4-6',
  agent: 'claude-opus-4-6',
};

// Kiro 会话偶尔缺失模型信息（无 rts_model_state / metadata），
// 这类会话默认归类为当前默认模型，避免出现无法计费的 unknown。
const KIRO_DEFAULT_MODEL = 'claude-opus-4-8';

export async function scanKiroDates(
  targetDates: string[],
  baseDir?: string,
  _projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const targetDateSet = new Set(targetDates);
  const dirs = resolveKiroDirs(baseDir);
  const shouldEstimateKiroCreditCost = isKiroCreditCostEnabled();
  const tokenUsage = await readKiroTokenUsage(dirs, targetDateSet);

  const files = (
    await Promise.all(
      dirs.flatMap((dir) => [walkFiles(dir, '.chat'), walkFiles(dir, '.json')]),
    )
  ).flat();

  const groupedByDate = initDateMap(targetDateSet);
  const seenExecutionIds = new Set<string>();
  // 跨存储去重：记录已计入费用的会话/对话 id，避免新存储重复计费
  const creditedConvIds = new Set<string>();

  for (const filePath of files) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let data: KiroRecord;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }

    const dedupeKey = resolveExecutionKey(data, filePath);
    if (seenExecutionIds.has(dedupeKey)) continue;
    seenExecutionIds.add(dedupeKey);

    const eventTs = await getEventDate(data, filePath);
    if (!eventTs) continue;
    const usageDate = dateKey(eventTs);
    const model = getModelName(data);

    // 费用按每个 turn 的 end_timestamp 归日，正确拆分跨天的长会话；
    // 无 turn 时间戳时回退到会话日期。
    const creditsByDate = shouldEstimateKiroCreditCost
      ? extractKiroCreditsByDate(data, usageDate)
      : new Map<string, number>();

    if (creditsByDate.size > 0) {
      let counted = false;
      for (const [date, credits] of creditsByDate) {
        const dm = groupedByDate.get(date);
        if (!dm) continue; // turn 日期不在目标窗口内
        accumulate(dm, `${model}|unknown`, kiroBreakdownBase(model), KIRO_ZERO_TOKENS);
        if (credits > 0) addCreditCost(tokenUsage, date, model, credits * KIRO_OVERAGE_CREDIT_RATE_USD);
        counted = true;
      }
      if (counted) {
        const sessionId = 'session_id' in data && typeof data.session_id === 'string' ? data.session_id.trim() : '';
        if (sessionId) creditedConvIds.add(sessionId);
        continue;
      }
    }

    // 无可计费 turn（空壳会话 / 费用停用 / 相关日期不在窗口）：在会话日期记一次事件
    const dayMap = groupedByDate.get(usageDate);
    if (!dayMap) continue;
    accumulate(dayMap, `${model}|unknown`, kiroBreakdownBase(model), KIRO_ZERO_TOKENS);
  }

  // 读取新版 Kiro 存储（CLI sqlite conversations_v2 + agent messages.jsonl），按 conversation id 去重
  await applyKiroCreditStores(
    groupedByDate,
    tokenUsage,
    creditedConvIds,
    shouldEstimateKiroCreditCost,
    targetDateSet,
    baseDir,
  );

  applyKiroTokenUsage(groupedByDate, tokenUsage);
  return finalize(groupedByDate);
}

function isKiroCreditCostEnabled(): boolean {
  const raw = process.env.KIRO_USE_CREDIT_COST?.trim()?.toLowerCase();
  if (raw) {
    return ['1', 'true', 'on', 'yes', 'enabled'].includes(raw);
  }
  return KIRO_DEFAULT_CREDIT_COST_ENABLED;
}

function resolveKiroDirs(baseDir?: string): string[] {
  if (baseDir) return [baseDir];

  const envDir = process.env.KIRO_CHAT_DIR?.trim();
  if (envDir) return [envDir];

  return [
    join(
      homedir(),
      'Library',
      'Application Support',
      'Kiro',
      'User',
      'globalStorage',
      'kiro.kiroagent',
    ),
    join(
      homedir(),
      'Library',
      'Application Support',
      'Code',
      'User',
      'globalStorage',
      'kiro.kiroagent',
    ),
    join(homedir(), '.kiro', 'sessions', 'cli'),
  ];
}

// ── 新版 Kiro 存储（credit 费用）──────────────────────────────
// 旧版只读取 ~/.kiro/sessions/cli/*.json 的 metering_usage。新版 Kiro 把用量写到：
//   1) ~/Library/Application Support/kiro-cli/data.sqlite3 的 conversations_v2(usage_info)
//   2) ~/.kiro/sessions/<workspace>/sess_*/messages.jsonl 的 usage_summary(promptTurnSummaries)
// 这里读取这两类存储，并按 conversation id 跨存储去重，避免重复计费。

const KIRO_ZERO_TOKENS = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 };

interface KiroCreditContribution {
  convId: string;
  model: string;
  perDate: Map<string, number>; // date -> 原始 credits（尚未乘费率）
}

interface KiroConvRow {
  conversation_id?: unknown;
  value?: unknown;
  updated_at?: unknown;
}

interface KiroMessageLine {
  timestamp?: string | number;
  payload?: { type?: string; timestamp?: string | number; promptTurnSummaries?: unknown };
}

function kiroBreakdownBase(model: string): Omit<IngestBreakdown, 'eventCount'> {
  return {
    provider: 'kiro',
    product: 'kiro',
    channel: 'cli',
    model,
    project: 'unknown',
    projectDisplay: 'unknown',
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function addCreditCost(tokenUsage: KiroTokenUsageMap, date: string, model: string, costUsd: number): void {
  const dayMap = tokenUsage.get(date) ?? new Map<string, KiroTokenTotals>();
  const totals = dayMap.get(model);
  if (totals) {
    totals.costUSD = (totals.costUSD ?? 0) + costUsd;
  } else {
    dayMap.set(model, { input: 0, output: 0, costUSD: costUsd });
  }
  tokenUsage.set(date, dayMap);
}

function resolveKiroModel(raw?: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return 'unknown';
  return normalizeModelName(value);
}

// 递归累加任意 JSON 中 unit === 'credit' 的用量（value 或 usage 字段）
function sumCreditUnits(root: unknown): number {
  let total = 0;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (typeof obj.unit === 'string' && obj.unit.toLowerCase() === 'credit') {
        const value = parseCreditValue(obj.value ?? obj.usage);
        if (value > 0) total += value;
      }
      for (const key of Object.keys(obj)) stack.push(obj[key]);
    }
  }
  return total;
}

function dateWindowMs(dates: Set<string>): { startMs: number; endMs: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const d of dates) {
    const start = new Date(`${d}T00:00:00`).getTime();
    const end = new Date(`${d}T23:59:59.999`).getTime();
    if (Number.isFinite(start) && start < min) min = start;
    if (Number.isFinite(end) && end > max) max = end;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { startMs: 0, endMs: Date.now() + 86_400_000 };
  }
  // 两端各放宽一天，避免时区边界漏读；最终按 dateKey 精确过滤
  return { startMs: min - 86_400_000, endMs: max + 86_400_000 };
}

function resolveKiroSessionRoots(baseDir?: string): string[] {
  const envDir = process.env.KIRO_SESSIONS_DIR?.trim();
  if (envDir) return [envDir];
  if (baseDir) return [baseDir];
  return [join(homedir(), '.kiro', 'sessions')];
}

function resolveKiroCliDbPaths(baseDir?: string): string[] {
  const envPath = process.env.KIRO_CLI_DB_PATH?.trim();
  if (envPath) return [envPath];
  if (baseDir) return [join(baseDir, KIRO_CLI_DB_SOURCE)];
  return [join(homedir(), 'Library', 'Application Support', 'kiro-cli', KIRO_CLI_DB_SOURCE)];
}

async function applyKiroCreditStores(
  groupedByDate: ReturnType<typeof initDateMap>,
  tokenUsage: KiroTokenUsageMap,
  creditedConvIds: Set<string>,
  shouldEstimate: boolean,
  targetDateSet: Set<string>,
  baseDir?: string,
): Promise<void> {
  const contributions = [
    ...await readKiroAgentSessionContributions(resolveKiroSessionRoots(baseDir), targetDateSet),
    ...await readKiroCliDbContributions(resolveKiroCliDbPaths(baseDir), targetDateSet),
  ];

  for (const contribution of contributions) {
    if (!contribution.convId || creditedConvIds.has(contribution.convId)) continue;
    let counted = false;
    for (const [date, credits] of contribution.perDate) {
      const dayMap = groupedByDate.get(date);
      if (!dayMap) continue;
      accumulate(dayMap, `${contribution.model}|unknown`, kiroBreakdownBase(contribution.model), KIRO_ZERO_TOKENS);
      if (shouldEstimate && credits > 0) {
        addCreditCost(tokenUsage, date, contribution.model, credits * KIRO_OVERAGE_CREDIT_RATE_USD);
      }
      counted = true;
    }
    if (counted) creditedConvIds.add(contribution.convId);
  }
}

// ── agent 会话：~/.kiro/sessions/<workspace>/sess_*/messages.jsonl ──

async function readKiroAgentSessionContributions(
  roots: string[],
  targetDateSet: Set<string>,
): Promise<KiroCreditContribution[]> {
  const { startMs } = dateWindowMs(targetDateSet);
  const logs = (await Promise.all(roots.map((root) => findKiroMessageLogs(root)))).flat();
  const out: KiroCreditContribution[] = [];

  await runWithConcurrency(logs, 6, async (msgPath) => {
    try {
      const info = await stat(msgPath);
      if (info.mtimeMs < startMs) return; // 会话最后修改早于窗口，整段跳过
    } catch {
      return;
    }
    const sessDir = dirname(msgPath);
    const { model, convId } = await readSessionMeta(sessDir);
    const perDate = new Map<string, number>();
    await streamUsageSummaries(msgPath, (ts, credits) => {
      const date = dateKey(ts);
      if (!targetDateSet.has(date)) return;
      perDate.set(date, (perDate.get(date) ?? 0) + credits);
    });
    if (perDate.size > 0) out.push({ convId, model, perDate });
  });

  return out;
}

async function findKiroMessageLogs(root: string): Promise<string[]> {
  const out: string[] = [];
  let topEntries;
  try {
    topEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of topEntries) {
    if (!entry.isDirectory() || entry.name === 'cli' || entry.name === 'snapshots') continue;
    const dirPath = join(root, entry.name);
    const direct = join(dirPath, 'messages.jsonl');
    if (existsSync(direct)) out.push(direct);

    let subEntries;
    try {
      subEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub of subEntries) {
      if (!sub.isDirectory() || sub.name === 'snapshots') continue;
      const nested = join(dirPath, sub.name, 'messages.jsonl');
      if (existsSync(nested)) out.push(nested);
    }
  }
  return out;
}

async function readSessionMeta(sessDir: string): Promise<{ model: string; convId: string }> {
  let model = 'unknown';
  let convId = basename(sessDir).replace(/^sess_/, '');
  try {
    const raw = await readFile(join(sessDir, 'session.json'), 'utf-8');
    const meta = JSON.parse(raw) as { id?: unknown; modelId?: unknown; model_id?: unknown; model?: unknown };
    model = resolveKiroModel(meta.modelId ?? meta.model_id ?? meta.model);
    if (typeof meta.id === 'string' && meta.id.trim()) {
      convId = meta.id.trim().replace(/^sess_/, '');
    }
  } catch {
    // 缺少 session.json 时使用默认模型与目录名推导的 id
  }
  return { model, convId };
}

function streamUsageSummaries(
  msgPath: string,
  onTurn: (ts: Date, credits: number) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const rl = createInterface({ input: createReadStream(msgPath, { encoding: 'utf-8' }), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.includes('usage_summary')) return;
      let record: KiroMessageLine;
      try {
        record = JSON.parse(line) as KiroMessageLine;
      } catch {
        return;
      }
      const payload = record.payload;
      if (!payload || payload.type !== 'usage_summary') return;
      const ts = parseTs(record.timestamp ?? payload.timestamp);
      if (!ts) return;
      const credits = sumCreditUnits(payload.promptTurnSummaries ?? payload);
      if (credits > 0) onTurn(ts, credits);
    });
    rl.on('close', resolve);
    rl.on('error', () => resolve());
  });
}

// ── CLI 数据库：~/Library/Application Support/kiro-cli/data.sqlite3 (conversations_v2) ──

async function readKiroCliDbContributions(
  dbPaths: string[],
  targetDateSet: Set<string>,
): Promise<KiroCreditContribution[]> {
  const { startMs, endMs } = dateWindowMs(targetDateSet);
  const out: KiroCreditContribution[] = [];

  for (const dbPath of dbPaths) {
    if (!existsSync(dbPath)) continue;
    let rows: KiroConvRow[];
    try {
      rows = await readConversationsV2Rows(dbPath, startMs, endMs);
    } catch {
      continue; // 表不存在或无法读取时跳过该库
    }
    for (const row of rows) {
      const value = typeof row.value === 'string' ? row.value : '';
      if (!value) continue;
      let parsed: { model_info?: { model_id?: unknown; model_name?: unknown } };
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      const credits = sumCreditUnits(parsed);
      if (!(credits > 0)) continue;
      const updatedAt = Number(row.updated_at);
      if (!Number.isFinite(updatedAt)) continue;
      const date = dateKey(new Date(updatedAt));
      if (!targetDateSet.has(date)) continue;
      const model = resolveKiroModel(parsed.model_info?.model_id ?? parsed.model_info?.model_name);
      const convId = typeof row.conversation_id === 'string' && row.conversation_id.trim()
        ? row.conversation_id.trim()
        : `kiro-db:${date}:${credits}`;
      out.push({ convId, model, perDate: new Map([[date, credits]]) });
    }
  }

  return out;
}

async function readConversationsV2Rows(dbPath: string, startMs: number, endMs: number): Promise<KiroConvRow[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    return readConversationsV2FromDb(dbPath, startMs, endMs, DatabaseSync);
  } catch (error) {
    if (error instanceof Error && /database is locked/i.test(error.message)) {
      return withKiroDbSnapshot(dbPath, (snapshotPath) => readConversationsV2FromDb(snapshotPath, startMs, endMs));
    }
    throw error;
  }
}

function readConversationsV2FromDb(
  dbPath: string,
  startMs: number,
  endMs: number,
  dbApi?: typeof import('node:sqlite').DatabaseSync,
): KiroConvRow[] {
  if (!dbApi) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ DatabaseSync: dbApi } = require('node:sqlite') as typeof import('node:sqlite'));
  }

  const db = new dbApi(dbPath, { open: true });
  try {
    const stmt = db.prepare(
      'SELECT conversation_id, value, updated_at FROM conversations_v2 WHERE updated_at BETWEEN ? AND ?',
    );
    return (stmt.all(startMs, endMs) as unknown[]) as KiroConvRow[];
  } finally {
    db.close();
  }
}

function getModelNameFromData(data: KiroChatRecord | KiroSessionRecord): string {
  let modelId: string | undefined;
  if ('session_state' in data) {
    modelId = (
      data.session_state?.rts_model_state?.model_info?.model_id
      ?? data.session_state?.rts_model_state?.model_info?.model_name
    )?.trim();
  }

  if (modelId) return modelId;
  if (data.selectedModel?.trim()) return data.selectedModel;
  return getModelNameFromMetadata(data.metadata);
}

function getModelName(data: KiroRecord): string {
  const resolved = normalizeModelName(getModelNameFromData(data));
  return resolved === 'unknown' ? KIRO_DEFAULT_MODEL : resolved;
}

function getModelNameFromMetadata(metadata?: KiroMetadata): string {
  return normalizeModelName(
    metadata?.modelId?.trim() || metadata?.modelProvider?.trim() || 'unknown',
  );
}

function normalizeModelName(model: string): string {
  if (!model) return 'unknown';
  const normalized = model.toLowerCase().replace(/_/g, '-');
  const aliased = KIRO_TOKEN_MODEL_ALIASES[normalized] ?? normalized;
  if (!aliased.startsWith('claude-')) return aliased;

  let mapped = aliased.replace(/\./g, '-');
  mapped = mapped.replace(/-v\d+(?:-\d+)*$/, '');
  mapped = mapped.replace(/-\d{8}$/, '');
  return mapped;
}

function applyKiroTokenUsage(groupedByDate: ReturnType<typeof initDateMap>, tokenUsage: KiroTokenUsageMap): void {
  for (const [date, byModel] of tokenUsage) {
    const dayMap = groupedByDate.get(date);
    if (!dayMap) continue;

    for (const [model, usage] of byModel) {
      const key = `${model}|unknown`;
      const breakdown = dayMap.get(key);
      if (!breakdown) continue;
      breakdown.inputTokens += usage.input;
      breakdown.outputTokens += usage.output;
      if (usage.costUSD != null) {
        breakdown.costUSD = (breakdown.costUSD ?? 0) + usage.costUSD;
      }
    }
  }
}

async function readKiroTokenUsage(dirs: string[], targetDateSet: Set<string>): Promise<KiroTokenUsageMap> {
  const usage: KiroTokenUsageMap = new Map();
  await Promise.all(
    dirs.map(async (dir) => {
      const tokenPath = join(dir, 'dev_data', KIRO_TOKEN_SOURCE);
      try {
        const mtime = await readFileMtime(tokenPath);
        const content = await readFile(tokenPath, 'utf-8');
        await ingestKiroTokenLog(content, mtime, usage, targetDateSet);
      } catch {
        // no-op
      }

      const sqlitePath = join(dir, 'dev_data', KIRO_SQLITE_SOURCE);
      try {
        await ingestKiroTokenSqlite(sqlitePath, usage, targetDateSet);
      } catch {
        // no-op
      }
    }),
  );
  return usage;
}

async function ingestKiroTokenLog(
  content: string,
  mtime: Date | null,
  usage: KiroTokenUsageMap,
  targetDateSet: Set<string>,
): Promise<void> {
  const fallbackDate = mtime ? dateKey(mtime) : null;
  const fallback = fallbackDate;

  for (const line of content.split('\n')) {
    const rawLine = line.trim();
    if (!rawLine) continue;

    let record: KiroTokenRecord;
    try {
      record = JSON.parse(rawLine);
    } catch {
      continue;
    }

    if (typeof record.provider === 'string' && record.provider.toLowerCase() !== 'kiro') continue;
    const rawModel = typeof record.model === 'string' ? record.model : record.model == null ? '' : String(record.model);
    if (!rawModel.trim()) continue;
    const model = normalizeModelName(rawModel);
    if (model === 'unknown') continue;
    const promptTokens = parseTokenCount(record.promptTokens ?? record.tokens_prompt);
    const outputTokens = parseTokenCount(record.generatedTokens ?? record.tokens_generated);
    if (promptTokens <= 0 && outputTokens <= 0) continue;

    const ts = parseTs(
      (record as { timestamp?: string | number }).timestamp
      ?? (record as { createdAt?: string | number }).createdAt
      ?? (record as { created_at?: string | number }).created_at
    );
    const usageDate = ts ? dateKey(ts) : fallback;
    if (!usageDate || !targetDateSet.has(usageDate)) continue;

    const bucket = usage.get(usageDate) ?? new Map<string, KiroTokenTotals>();
    const existing = bucket.get(model) as KiroTokenTotals | undefined;
    if (existing) {
      existing.input += promptTokens;
      existing.output += outputTokens;
    } else {
      bucket.set(model, { input: promptTokens, output: outputTokens });
    }
    usage.set(usageDate, bucket);
  }
}

async function ingestKiroTokenSqlite(
  sqlitePath: string,
  usage: KiroTokenUsageMap,
  targetDateSet: Set<string>,
): Promise<void> {
  const mtime = await readFileMtime(sqlitePath);
  const rows = await readKiroTokenRows(sqlitePath);
  const fallbackDate = mtime ? dateKey(mtime) : null;

  for (const row of rows) {
    const rawModel = typeof row.model === 'string'
      ? row.model
      : row.model == null
        ? ''
        : String(row.model);
    if (!rawModel.trim()) continue;
    const model = normalizeModelName(rawModel);
    if (model === 'unknown') continue;

    const provider = typeof row.provider === 'string' ? row.provider.toLowerCase() : '';
    if (provider && provider !== 'kiro') continue;

    const inputTokens = parseTokenCount(row.tokens_prompt);
    const outputTokens = parseTokenCount(row.tokens_generated);
    if (inputTokens <= 0 && outputTokens <= 0) continue;

    const ts = parseTs(row.timestamp as string | number);
    const usageDate = ts ? dateKey(ts) : fallbackDate;
    if (!usageDate || !targetDateSet.has(usageDate)) continue;

    const bucket = usage.get(usageDate) ?? new Map<string, KiroTokenTotals>();
    const existing = bucket.get(model);
    if (existing) {
      existing.input += inputTokens;
      existing.output += outputTokens;
    } else {
      bucket.set(model, { input: inputTokens, output: outputTokens });
    }
    usage.set(usageDate, bucket);
  }
}

async function readKiroTokenRows(dbPath: string): Promise<KiroSqliteTokenRow[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const direct = readKiroTokenRowsFromDb(dbPath, DatabaseSync);
    return direct;
  } catch (error) {
    if (error instanceof Error && /database is locked/i.test(error.message)) {
      return withKiroDbSnapshot(dbPath, (snapshotPath) => readKiroTokenRowsFromDb(snapshotPath));
    }
    throw error;
  }
}

async function withKiroDbSnapshot<T>(dbPath: string, cb: (snapshotPath: string) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'aiusage-kiro-'));
  const snapshotPath = join(dir, KIRO_SQLITE_SOURCE);
  await copyFile(dbPath, snapshotPath);
  for (const suffix of ['-shm', '-wal']) {
    if (existsSync(`${dbPath}${suffix}`)) {
      await copyFile(`${dbPath}${suffix}`, `${snapshotPath}${suffix}`);
    }
  }

  try {
    return cb(snapshotPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readKiroTokenRowsFromDb(dbPath: string, dbApi?: typeof import('node:sqlite').DatabaseSync): KiroSqliteTokenRow[] {
  if (!dbApi) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ DatabaseSync: dbApi } = require('node:sqlite') as typeof import('node:sqlite'));
  }

  const db = new dbApi(dbPath, { open: true });
  try {
    const stmt = db.prepare('SELECT model, provider, tokens_prompt, tokens_generated, timestamp FROM tokens_generated');
    return (stmt.all() as unknown[]) as KiroSqliteTokenRow[];
  } finally {
    db.close();
  }
}

// 按每个 turn 的 end_timestamp 把 credit 归到对应日期（跨天会话正确拆分）。
// turn 无时间戳时回退到 fallbackDate（会话日期）。返回原始 credit 数（未乘费率）。
function extractKiroCreditsByDate(data: KiroSessionRecord, fallbackDate: string): Map<string, number> {
  const byDate = new Map<string, number>();
  const turns = data.session_state?.conversation_metadata?.user_turn_metadatas;
  if (!Array.isArray(turns) || turns.length === 0) return byDate;

  for (const turn of turns) {
    const usageEntries = turn?.metering_usage;
    if (!Array.isArray(usageEntries) || usageEntries.length === 0) continue;

    let credits = 0;
    for (const usage of usageEntries) {
      if (typeof usage?.unit === 'string' && usage.unit.toLowerCase() === 'credit') {
        credits += parseCreditValue(usage.value);
      }
    }
    if (credits <= 0) continue;

    const ts = parseTs(turn.end_timestamp ?? turn.start_timestamp ?? turn.timestamp);
    const date = ts ? dateKey(ts) : fallbackDate;
    byDate.set(date, (byDate.get(date) ?? 0) + credits);
  }
  return byDate;
}

function parseCreditValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function parseTokenCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }
  return 0;
}

function resolveExecutionKey(data: KiroChatRecord | KiroSessionRecord, filePath: string): string {
  const candidate = 'executionId' in data ? data.executionId : undefined;
  const chatKey = typeof candidate === 'string' ? candidate.trim() : '';
  if (chatKey) return chatKey;
  const actionCandidate = 'actionId' in data ? data.actionId : undefined;
  const actionKey = typeof actionCandidate === 'string' ? actionCandidate.trim() : '';
  if (actionKey) return actionKey;
  const sessionKey = 'session_id' in data ? data.session_id : undefined;
  const sessionId = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  if (sessionId) return sessionId;
  return `file:${hashPath(filePath)}`;
}

function getEventDate(data: KiroChatRecord | KiroSessionRecord, filePath: string): Promise<Date | null> {
  const ts = parseTs(
    data.metadata?.startTime
    ?? data.metadata?.endTime
    ?? ('created_at' in data ? data.created_at : undefined)
    ?? ('updated_at' in data ? data.updated_at : undefined),
  );
  if (ts) return Promise.resolve(ts);
  return readFileMtime(filePath);
}

function readFileMtime(filePath: string): Promise<Date | null> {
  return (async () => {
    try {
      return (await stat(filePath)).mtime;
    } catch {
      return null;
    }
  })();
}

function hashPath(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex');
}
