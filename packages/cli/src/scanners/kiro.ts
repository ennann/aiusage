import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  dateKey,
  parseTs,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
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
const KIRO_OVERAGE_CREDIT_RATE_USD = 0.04;
const KIRO_DEFAULT_CREDIT_COST_ENABLED = true;
const KIRO_TOKEN_MODEL_ALIASES: Record<string, string> = {
  qdev: 'claude-opus-4-6',
  agent: 'claude-opus-4-6',
};

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

  if (files.length === 0) return emptyResult(targetDateSet);

  const groupedByDate = initDateMap(targetDateSet);
  const seenExecutionIds = new Set<string>();

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
    const dayMap = groupedByDate.get(usageDate);
    if (!dayMap) continue;

    const model = getModelName(data);
    const project = 'unknown';
    const estimatedCostUsd = shouldEstimateKiroCreditCost ? extractKiroCreditsFromRecord(data) : 0;

    accumulate(
      dayMap,
      `${model}|${project}`,
      {
        provider: 'kiro',
        product: 'kiro',
        channel: 'cli',
        model,
        project,
        projectDisplay: 'unknown',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    );

    if (estimatedCostUsd > 0) {
      const usageDateMap = tokenUsage.get(usageDate) ?? new Map<string, KiroTokenTotals>();
      const usageTotals = usageDateMap.get(model);
      if (usageTotals) {
        usageTotals.costUSD = (usageTotals.costUSD ?? 0) + estimatedCostUsd;
      } else {
        usageDateMap.set(model, { input: 0, output: 0, costUSD: estimatedCostUsd });
      }
      tokenUsage.set(usageDate, usageDateMap);
    }
  }

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
  return normalizeModelName(getModelNameFromData(data));
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

function extractKiroCreditsFromRecord(data: KiroSessionRecord): number {
  const meteringEntries = data.session_state?.conversation_metadata?.user_turn_metadatas ?? [];
  if (!Array.isArray(meteringEntries) || meteringEntries.length === 0) return 0;

  const totalCredits = meteringEntries.reduce((sum, turnMeta) => {
    const usageEntries = turnMeta.metering_usage;
    if (!Array.isArray(usageEntries) || usageEntries.length === 0) return sum;

    const turnCredits = usageEntries.reduce((innerSum, usage) => {
      if (typeof usage?.unit !== 'string' || usage.unit.toLowerCase() !== 'credit') return innerSum;
      const value = parseCreditValue(usage.value);
      return innerSum + value;
    }, 0);

    return sum + turnCredits;
  }, 0);

  if (totalCredits <= 0) return 0;
  return totalCredits * KIRO_OVERAGE_CREDIT_RATE_USD;
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
