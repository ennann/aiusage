import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
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
 * - OpenCode 1.2+ v1: opencode*.db / message
 * - OpenCode v2: opencode*.db / session_message
 * - Legacy/unmigrated: JSON messages below storage/message
 *
 * Node 22.13+ uses the built-in read-only SQLite API. Older supported Node
 * versions fall back to the system sqlite3 executable.
 */

interface OpenCodeMessage {
  id?: string;
  sessionID?: string;
  role?: string;
  modelID?: string;
  providerID?: string;
  model?: {
    id?: string;
    providerID?: string;
  };
  cost?: number;
  agent?: string;
  mode?: string;
  time?: { created?: string | number; completed?: string | number };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
    reasoning?: number;
  };
  path?: { root?: string } | string;
}

export interface OpenCodeSqliteRow {
  id?: string;
  session_id?: string;
  data?: string;
  workspace_root?: string | null;
}

export interface ParsedOpenCodeRecord {
  /** Embedded OpenCode message id. Row/file fallback ids are intentionally separate. */
  id?: string;
  fallbackId?: string;
  sessionId?: string;
  fingerprint: string;
  timestamp: Date;
  model: string;
  provider: string;
  projectRoot?: string;
  tokens: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number };
  costUSD: number;
  agent?: string;
}

export interface OpenCodeSourceOptions {
  /** Override the XDG OpenCode data directory. Primarily useful for tests/imports. */
  dataDir?: string;
  /** Override the legacy JSON message directory. */
  legacyDir?: string;
  /** Additional opencode*.db files, including OPENCODE_DB outside the XDG root. */
  dbPaths?: readonly string[];
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface OpenCodeScanOptions extends OpenCodeSourceOptions {
  projectAliases?: Record<string, string>;
}

export interface ResolvedOpenCodeSources {
  dataDir: string;
  legacyDir: string;
  dbPaths: string[];
}

interface NodeSqliteDatabase {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => NodeSqliteDatabase;
}

export type OpenCodeSqliteRuntime = 'node' | 'external' | 'unavailable';

interface DedupEntry {
  record: ParsedOpenCodeRecord;
  hasProjectConflict: boolean;
}

let nodeSqliteModulePromise: Promise<NodeSqliteModule | null> | undefined;
let sqliteRuntimePromise: Promise<OpenCodeSqliteRuntime> | undefined;

export async function scanOpencodeDates(
  targetDates: string[],
  options: OpenCodeScanOptions = {},
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const { records, sourceCount } = await loadOpenCodeRecords(options);
  if (sourceCount === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const sessionsByBreakdown = new Map<string, Set<string>>();
  for (const record of records) {
    addOpenCodeRecord(record, grouped, sessionsByBreakdown, options.projectAliases);
  }

  for (const [compoundKey, sessions] of sessionsByBreakdown) {
    const separator = compoundKey.indexOf('\0');
    const usageDate = compoundKey.slice(0, separator);
    const breakdownKey = compoundKey.slice(separator + 1);
    const breakdown = grouped.get(usageDate)?.get(breakdownKey);
    if (breakdown && sessions.size > 0) breakdown.sessionCount = sessions.size;
  }

  return finalize(grouped);
}

/** Discover actual dates from every supported SQLite database and legacy JSON file. */
export async function discoverOpenCodeUsageDates(
  options: OpenCodeSourceOptions = {},
): Promise<Set<string>> {
  const result = new Set<string>();
  const { records } = await loadOpenCodeRecords(options);
  for (const record of records) result.add(dateKey(record.timestamp));
  return result;
}

export function resolveOpenCodeDataDir(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  return join(xdgDataHome || join(home, '.local', 'share'), 'opencode');
}

export async function resolveOpenCodeSources(
  options: OpenCodeSourceOptions = {},
): Promise<ResolvedOpenCodeSources> {
  const home = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? resolveOpenCodeDataDir(home, env);
  const legacyDir = options.legacyDir ?? join(dataDir, 'storage', 'message');
  const configuredPaths = [...(options.dbPaths ?? [])];
  if (env.OPENCODE_DB?.trim()) configuredPaths.push(env.OPENCODE_DB.trim());
  const dbPaths = await discoverOpenCodeDatabases(dataDir, configuredPaths, home);
  return { dataDir, legacyDir, dbPaths };
}

/** Discover opencode.db and every opencode-<channel>.db, excluding sidecars. */
export async function discoverOpenCodeDatabases(
  dataDir: string,
  extraPaths: readonly string[] = [],
  home = homedir(),
): Promise<string[]> {
  const candidates: string[] = [];
  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (isOpenCodeDatabaseFilename(entry.name)) candidates.push(join(dataDir, entry.name));
    }
  } catch {
    // Missing/stale roots are normal.
  }

  for (const rawPath of extraPaths) {
    const path = expandConfiguredPath(rawPath, home);
    if (path && isOpenCodeDatabaseFilename(basename(path))) candidates.push(path);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const path of candidates.sort((a, b) => a.localeCompare(b))) {
    try {
      if (!(await stat(path)).isFile()) continue;
      const canonical = await realpath(path).catch(() => path);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      result.push(path);
    } catch {
      // Stale config entries never abort a scan.
    }
  }
  return result;
}

export function isOpenCodeDatabaseFilename(name: string): boolean {
  return /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/.test(name);
}

/** Report whether this Node installation can read OpenCode SQLite databases. */
export async function detectOpenCodeSqliteRuntime(): Promise<OpenCodeSqliteRuntime> {
  sqliteRuntimePromise ??= (async () => {
    if (await loadNodeSqlite()) return 'node';
    try {
      await runExternalSqlite(['-version']);
      return 'external';
    } catch {
      return 'unavailable';
    }
  })();
  return sqliteRuntimePromise;
}

export function parseOpenCodeSqliteRows(
  rows: OpenCodeSqliteRow[],
  options: { assistantGuaranteed?: boolean } = {},
): ParsedOpenCodeRecord[] {
  return rows.flatMap(row => {
    if (!row.data) return [];
    let message: OpenCodeMessage;
    try {
      message = JSON.parse(row.data) as OpenCodeMessage;
    } catch {
      return [];
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
    const record = parseOpenCodeMessage(
      message,
      row.id,
      row.session_id,
      options.assistantGuaranteed === true,
    );
    if (!record) return [];
    record.sessionId = cleanString(row.session_id) || record.sessionId;
    record.projectRoot = normalizeOpenCodeProjectRoot(row.workspace_root) || record.projectRoot;
    return [record];
  });
}

/**
 * Match tokscale's fork-aware rule: same embedded id always deduplicates;
 * otherwise identical fingerprints merge unless both records have distinct ids.
 */
export function deduplicateOpenCodeRecords(records: ParsedOpenCodeRecord[]): ParsedOpenCodeRecord[] {
  const entries: DedupEntry[] = [];
  const idIndices = new Map<string, number>();
  const fingerprintIndices = new Map<string, number[]>();

  for (const rawRecord of records) {
    const record: ParsedOpenCodeRecord = {
      ...rawRecord,
      tokens: { ...rawRecord.tokens },
    };

    if (record.id) {
      const existingIndex = idIndices.get(record.id);
      if (existingIndex !== undefined) {
        mergeDuplicateProject(entries[existingIndex], record.projectRoot);
        addFingerprintIndex(fingerprintIndices, record.fingerprint, existingIndex);
        continue;
      }
    }

    const candidates = fingerprintIndices.get(record.fingerprint) ?? [];
    const duplicateIndex = candidates.find(index => {
      const existingId = entries[index].record.id;
      return !existingId || !record.id || existingId === record.id;
    });

    if (duplicateIndex !== undefined) {
      const entry = entries[duplicateIndex];
      if (record.id && !entry.record.id) {
        entry.record.id = record.id;
        idIndices.set(record.id, duplicateIndex);
      }
      mergeDuplicateProject(entry, record.projectRoot);
      continue;
    }

    const index = entries.length;
    entries.push({ record, hasProjectConflict: false });
    if (record.id) idIndices.set(record.id, index);
    addFingerprintIndex(fingerprintIndices, record.fingerprint, index);
  }

  return entries.map(entry => entry.record);
}

async function loadOpenCodeRecords(
  options: OpenCodeSourceOptions,
): Promise<{ records: ParsedOpenCodeRecord[]; sourceCount: number }> {
  const sources = await resolveOpenCodeSources(options);
  const sqliteRecords: ParsedOpenCodeRecord[] = [];

  for (const dbPath of sources.dbPaths) {
    const { v2Rows, v1Rows } = await queryOpenCodeDatabase(dbPath);
    sqliteRecords.push(...deduplicateOpenCodeRecords([
      ...parseOpenCodeSqliteRows(v2Rows, { assistantGuaranteed: true }),
      ...parseOpenCodeSqliteRows(v1Rows),
    ]));
  }

  const files = await walkFiles(sources.legacyDir, '.json');
  const legacyRecords: ParsedOpenCodeRecord[] = [];
  for (const filePath of files) {
    try {
      const message = JSON.parse(await readFile(filePath, 'utf-8')) as OpenCodeMessage;
      const record = parseOpenCodeMessage(
        message,
        basename(filePath, '.json'),
        message.sessionID ?? basename(dirname(filePath)),
        false,
      );
      if (record) legacyRecords.push(record);
    } catch {
      // A malformed file never blocks other sessions.
    }
  }

  // v2 is canonical during OpenCode's dual-write migration, then v1, then JSON.
  return {
    records: deduplicateOpenCodeSources([...sqliteRecords, ...legacyRecords]),
    sourceCount: sources.dbPaths.length + files.length,
  };
}

async function queryOpenCodeDatabase(
  dbPath: string,
): Promise<{ v2Rows: OpenCodeSqliteRow[]; v1Rows: OpenCodeSqliteRow[] }> {
  const v2Rows = await queryFirstSupported(dbPath, [
    `SELECT sm.id, sm.session_id, sm.data, NULLIF(s.directory, '') AS workspace_root
     FROM session_message sm
     LEFT JOIN session s ON s.id = sm.session_id
     WHERE sm.type = 'assistant'
       AND CASE WHEN json_valid(sm.data)
         THEN json_extract(sm.data, '$.tokens') IS NOT NULL ELSE 0 END
     ORDER BY sm.id, sm.session_id`,
    `SELECT sm.id, sm.session_id, sm.data, NULL AS workspace_root
     FROM session_message sm
     WHERE sm.type = 'assistant'
       AND CASE WHEN json_valid(sm.data)
         THEN json_extract(sm.data, '$.tokens') IS NOT NULL ELSE 0 END
     ORDER BY sm.id, sm.session_id`,
  ]);

  const v1Rows = await queryFirstSupported(dbPath, [
    `SELECT m.id, m.session_id, m.data, NULLIF(s.directory, '') AS workspace_root
     FROM message m
     LEFT JOIN session s ON s.id = m.session_id
     WHERE CASE WHEN json_valid(m.data) THEN
       json_extract(m.data, '$.role') = 'assistant'
       AND json_extract(m.data, '$.tokens') IS NOT NULL ELSE 0 END
     ORDER BY m.id, m.session_id`,
    `SELECT m.id, m.session_id, m.data, NULL AS workspace_root
     FROM message m
     WHERE CASE WHEN json_valid(m.data) THEN
       json_extract(m.data, '$.role') = 'assistant'
       AND json_extract(m.data, '$.tokens') IS NOT NULL ELSE 0 END
     ORDER BY m.id, m.session_id`,
  ]);

  return { v2Rows, v1Rows };
}

async function queryFirstSupported(dbPath: string, queries: string[]): Promise<OpenCodeSqliteRow[]> {
  for (const query of queries) {
    try {
      return await runSqliteQuery(dbPath, query);
    } catch {
      // Try the schema variant without the optional session join.
    }
  }
  return [];
}

async function runSqliteQuery(dbPath: string, query: string): Promise<OpenCodeSqliteRow[]> {
  const nodeSqlite = await loadNodeSqlite();
  if (nodeSqlite) {
    const db = new nodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(query).all().filter(isSqliteRow);
    } finally {
      db.close();
    }
  }

  const stdout = await runExternalSqlite(['-readonly', '-json', dbPath, query]);
  const rows = JSON.parse(stdout || '[]') as unknown;
  return Array.isArray(rows) ? rows.filter(isSqliteRow) : [];
}

async function loadNodeSqlite(): Promise<NodeSqliteModule | null> {
  nodeSqliteModulePromise ??= (async () => {
    try {
      // Keep Node 18 compatibility: this module exists only in newer Node releases.
      const specifier = 'node:sqlite';
      const module = await import(specifier) as unknown as Partial<NodeSqliteModule>;
      return typeof module.DatabaseSync === 'function' ? module as NodeSqliteModule : null;
    } catch {
      return null;
    }
  })();
  return nodeSqliteModulePromise;
}

function runExternalSqlite(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'sqlite3',
      args,
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    );
  });
}

function parseOpenCodeMessage(
  message: OpenCodeMessage,
  fallbackId?: string,
  fallbackSessionId?: string,
  assistantGuaranteed = false,
): ParsedOpenCodeRecord | undefined {
  if (message.role != null && message.role !== 'assistant') return undefined;
  if (!assistantGuaranteed && message.role !== 'assistant') return undefined;
  if (!message.tokens) return undefined;

  const timestamp = parseTs(message.time?.created);
  if (!timestamp) return undefined;
  const model = cleanString(message.modelID) || cleanString(message.model?.id);
  if (!model) return undefined;
  const rawProvider = cleanString(message.providerID) || cleanString(message.model?.providerID);
  const provider = canonicalizeOpenCodeProvider(rawProvider)
    || inferProviderFromModel(model, 'opencode');
  const tokens = {
    input: clamp(message.tokens.input),
    cached: clamp(message.tokens.cache?.read),
    cacheWrite: clamp(message.tokens.cache?.write),
    output: clamp(message.tokens.output),
    reasoning: clamp(message.tokens.reasoning),
  };

  const completed = parseTs(message.time?.completed)?.getTime() ?? '';
  const costUSD = clampCost(message.cost);
  if (Object.values(tokens).every(value => value === 0) && costUSD === 0) return undefined;
  const agent = (cleanString(message.mode) || cleanString(message.agent))?.toLowerCase();
  const projectRoot = normalizeOpenCodeProjectRoot(
    typeof message.path === 'string' ? message.path : message.path?.root,
  );
  const id = cleanString(message.id);
  const sessionId = cleanString(message.sessionID) || cleanString(fallbackSessionId);
  return {
    id,
    fallbackId,
    sessionId,
    timestamp,
    model,
    provider,
    projectRoot,
    tokens,
    costUSD,
    agent,
    fingerprint: JSON.stringify([
      timestamp.getTime(), completed, model, provider, tokens.input, tokens.cached,
      tokens.cacheWrite, tokens.output, tokens.reasoning, costUSD, agent ?? '',
    ]),
  };
}

function addOpenCodeRecord(
  record: ParsedOpenCodeRecord,
  grouped: ReturnType<typeof initDateMap>,
  sessionsByBreakdown: Map<string, Set<string>>,
  aliases?: Record<string, string>,
): void {
  const usageDate = dateKey(record.timestamp);
  const dayMap = grouped.get(usageDate);
  if (!dayMap) return;
  const fields = record.projectRoot
    ? resolveProjectFields(record.projectRoot, aliases)
    : { project: 'unknown', projectDisplay: 'unknown' };
  const breakdownKey = `${record.provider}|${record.model}|${fields.project}`;
  accumulate(
    dayMap,
    breakdownKey,
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

  const breakdown = dayMap.get(breakdownKey)!;
  if (record.costUSD > 0) breakdown.costUSD = (breakdown.costUSD ?? 0) + record.costUSD;
  if (record.sessionId) {
    const sessionKey = `${usageDate}\0${breakdownKey}`;
    const sessions = sessionsByBreakdown.get(sessionKey) ?? new Set<string>();
    sessions.add(record.sessionId);
    sessionsByBreakdown.set(sessionKey, sessions);
  }
}

function mergeDuplicateProject(entry: DedupEntry, incomingRoot?: string): void {
  if (entry.hasProjectConflict || !incomingRoot) return;
  const existingRoot = entry.record.projectRoot;
  if (!existingRoot) {
    entry.record.projectRoot = incomingRoot;
  } else if (existingRoot !== incomingRoot) {
    entry.hasProjectConflict = true;
    entry.record.projectRoot = undefined;
  }
}

function addFingerprintIndex(map: Map<string, number[]>, fingerprint: string, index: number): void {
  const indices = map.get(fingerprint) ?? [];
  if (!indices.includes(index)) indices.push(index);
  map.set(fingerprint, indices);
}

/** Match tokscale's cross-database/legacy precedence by stable message identity. */
function deduplicateOpenCodeSources(records: ParsedOpenCodeRecord[]): ParsedOpenCodeRecord[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = record.id || record.fallbackId;
    return !key || seen.add(key);
  });
}

function canonicalizeOpenCodeProvider(raw?: string): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().replace(/\/+$/, '').toLowerCase().replaceAll('-', '_');
  if (!normalized || normalized === 'unknown' || (normalized.startsWith('<') && normalized.endsWith('>'))) {
    return undefined;
  }
  const first = normalized.split('/')[0].split('.')[0];
  const aliases: Record<string, string> = {
    x_ai: 'xai',
    z_ai: 'zai',
    moonshotai: 'moonshot',
    meta: 'meta_llama',
    azure: 'azure_ai',
    vertex: 'anthropic',
    vertex_ai: 'anthropic',
    together: 'together_ai',
    fireworks: 'fireworks_ai',
    gemini: 'google',
    openai_codex: 'openai',
    minimaxai: 'minimax',
    minimax_ai: 'minimax',
    mistral: 'mistralai',
  };
  return aliases[first] ?? first;
}

function expandConfiguredPath(rawPath: string, home: string): string | undefined {
  const value = rawPath.trim();
  if (!value) return undefined;
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2));
  return isAbsolute(value) ? value : resolve(value);
}

function normalizeOpenCodeProjectRoot(raw?: unknown): string | undefined {
  const trimmed = cleanString(raw);
  if (!trimmed) return undefined;
  const preserveUncPrefix = trimmed.startsWith('\\\\') || trimmed.startsWith('//');
  let normalized = trimmed.replaceAll('\\', '/');
  if (preserveUncPrefix) {
    normalized = `//${normalized.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  } else {
    normalized = normalized.replace(/\/{2,}/g, '/');
  }
  const minimumLength = preserveUncPrefix ? 2 : 1;
  if (normalized.length > minimumLength) normalized = normalized.replace(/\/+$/, '');
  return normalized || undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

function isSqliteRow(value: unknown): value is OpenCodeSqliteRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number | undefined): number {
  return Math.max(Number.isFinite(value) ? value! : 0, 0);
}

function clampCost(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? value! : 0;
}
