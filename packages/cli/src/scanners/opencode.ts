import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  resolveProjectFields,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
  inferProviderFromModel,
} from './utils.js';

/**
 * OpenCode scanner.
 *
 * OpenCode 1.2+ 读取 ~/.local/share/opencode/opencode.db；同时保留旧版
 * storage/message/*.json。SQLite 通过系统 sqlite3 只读访问，不存在时安全回退旧 JSON。
 */

interface OpenCodeMessage {
  id?: string;
  sessionID?: string;
  role?: string;
  modelID?: string;
  providerID?: string;
  time?: { created?: string | number; completed?: string | number };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
    reasoning?: number;
  };
  path?: { root?: string } | string;
}

interface OpenCodeSqliteRow {
  id?: string;
  session_id?: string;
  data?: string;
  workspace_root?: string | null;
}

interface ParsedOpenCodeRecord {
  id?: string;
  fingerprint: string;
  timestamp: Date;
  model: string;
  provider: string;
  projectRoot?: string;
  tokens: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number };
}

export async function scanOpencodeDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dataDir = baseDir ?? join(homedir(), '.local', 'share', 'opencode');
  const legacyDir = baseDir ?? join(dataDir, 'storage', 'message');
  const dbPath = join(dataDir, 'opencode.db');
  const grouped = initDateMap(dates);
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();

  const sqliteRows = await queryOpenCodeSqlite(dbPath);
  const sqliteRecords = parseOpenCodeSqliteRows(sqliteRows);
  for (const record of sqliteRecords) {
    addOpenCodeRecord(record, grouped, seenIds, seenFingerprints, projectAliases);
  }

  const files = await walkFiles(legacyDir, '.json');
  for (const filePath of files) {
    let message: OpenCodeMessage;
    try {
      message = JSON.parse(await readFile(filePath, 'utf-8')) as OpenCodeMessage;
    } catch {
      continue;
    }
    const record = parseOpenCodeMessage(message, basename(filePath, '.json'));
    if (record) addOpenCodeRecord(record, grouped, seenIds, seenFingerprints, projectAliases);
  }

  if (sqliteRows.length === 0 && files.length === 0) return emptyResult(dates);
  return finalize(grouped);
}

/** 供 `report --range all` 在扫描前发现 SQLite 与旧 JSON 中的实际日期。 */
export async function discoverOpenCodeUsageDates(baseDir?: string): Promise<Set<string>> {
  const dataDir = baseDir ?? join(homedir(), '.local', 'share', 'opencode');
  const legacyDir = baseDir ?? join(dataDir, 'storage', 'message');
  const result = new Set<string>();
  for (const record of parseOpenCodeSqliteRows(await queryOpenCodeSqlite(join(dataDir, 'opencode.db')))) {
    result.add(dateKey(record.timestamp));
  }
  for (const filePath of await walkFiles(legacyDir, '.json')) {
    try {
      const record = parseOpenCodeMessage(
        JSON.parse(await readFile(filePath, 'utf-8')) as OpenCodeMessage,
        basename(filePath, '.json'),
      );
      if (record) result.add(dateKey(record.timestamp));
    } catch {
      // 单个损坏文件不影响其他会话日期发现。
    }
  }
  return result;
}

export function parseOpenCodeSqliteRows(rows: OpenCodeSqliteRow[]): ParsedOpenCodeRecord[] {
  return rows.flatMap(row => {
    if (!row.data) return [];
    let message: OpenCodeMessage;
    try {
      message = JSON.parse(row.data) as OpenCodeMessage;
    } catch {
      return [];
    }
    message.sessionID ??= row.session_id;
    const record = parseOpenCodeMessage(message, row.id);
    if (!record) return [];
    record.projectRoot = row.workspace_root || record.projectRoot;
    return [record];
  });
}

async function queryOpenCodeSqlite(dbPath: string): Promise<OpenCodeSqliteRow[]> {
  const modern = `
    SELECT m.id, m.session_id, m.data, NULLIF(s.directory, '') AS workspace_root
    FROM message m
    LEFT JOIN session s ON s.id = m.session_id
    WHERE json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(m.data, '$.tokens') IS NOT NULL
    ORDER BY m.id, m.session_id`;
  const legacy = `
    SELECT m.id, m.session_id, m.data, NULL AS workspace_root
    FROM message m
    WHERE json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(m.data, '$.tokens') IS NOT NULL
    ORDER BY m.id, m.session_id`;

  for (const query of [modern, legacy]) {
    try {
      const stdout = await runSqlite(['-readonly', '-json', dbPath, query]);
      const rows = JSON.parse(stdout || '[]') as unknown;
      if (Array.isArray(rows)) return rows.filter(isSqliteRow);
    } catch {
      // 数据库、session 表或 sqlite3 不存在时尝试下一种格式，最终回退旧 JSON。
    }
  }
  return [];
}

function runSqlite(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'sqlite3',
      args,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    );
  });
}

function parseOpenCodeMessage(
  message: OpenCodeMessage,
  fallbackId?: string,
): ParsedOpenCodeRecord | undefined {
  if (message.role !== 'assistant' || !message.tokens) return undefined;
  const timestamp = parseTs(message.time?.created);
  if (!timestamp) return undefined;
  const model = message.modelID ?? 'unknown';
  const provider = message.providerID?.trim().toLowerCase()
    || inferProviderFromModel(model, 'opencode');
  const tokens = {
    input: clamp(message.tokens.input),
    cached: clamp(message.tokens.cache?.read),
    cacheWrite: clamp(message.tokens.cache?.write),
    output: clamp(message.tokens.output),
    reasoning: clamp(message.tokens.reasoning),
  };
  if (Object.values(tokens).every(value => value === 0)) return undefined;
  const projectRoot = typeof message.path === 'string' ? message.path : message.path?.root;
  const id = message.id ?? fallbackId;
  return {
    id,
    timestamp,
    model,
    provider,
    projectRoot,
    tokens,
    fingerprint: [
      timestamp.getTime(), model, provider, tokens.input, tokens.cached,
      tokens.cacheWrite, tokens.output, tokens.reasoning,
    ].join('|'),
  };
}

function addOpenCodeRecord(
  record: ParsedOpenCodeRecord,
  grouped: ReturnType<typeof initDateMap>,
  seenIds: Set<string>,
  seenFingerprints: Set<string>,
  aliases?: Record<string, string>,
): void {
  if (record.id && seenIds.has(record.id)) return;
  if (seenFingerprints.has(record.fingerprint)) return;
  if (record.id) seenIds.add(record.id);
  seenFingerprints.add(record.fingerprint);

  const dayMap = grouped.get(dateKey(record.timestamp));
  if (!dayMap) return;
  const fields = record.projectRoot
    ? resolveProjectFields(record.projectRoot, aliases)
    : { project: 'unknown', projectDisplay: 'unknown' };
  accumulate(
    dayMap,
    `${record.provider}|${record.model}|${fields.project}`,
    {
      provider: record.provider,
      product: 'opencode',
      channel: 'cli',
      model: record.model,
      project: fields.project,
      projectDisplay: fields.projectDisplay,
      projectAlias: fields.projectAlias,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    record.tokens,
  );
}

function isSqliteRow(value: unknown): value is OpenCodeSqliteRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number | undefined): number {
  return Math.max(Number.isFinite(value) ? value! : 0, 0);
}
