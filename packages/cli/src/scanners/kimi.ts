import { readFile, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
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
  type ProjectFields,
} from './utils.js';

/**
 * Kimi CLI / Kimi Code scanner.
 *
 * Legacy Kimi CLI:
 *   ~/.kimi/sessions/{workspaceHash}/{sessionId}/wire.jsonl
 *   Token data comes from nested StatusUpdate messages.
 *
 * Kimi Code:
 *   $KIMI_CODE_HOME/sessions/{workspace}/{sessionId}/agents/{agent}/wire.jsonl
 *   Token data comes from turn-scoped usage.record lines.
 *
 * Wire-format behavior is aligned with the MIT-licensed tokscale parser:
 * https://github.com/junhoyeo/tokscale/blob/main/crates/tokscale-core/src/sessions/kimi.rs
 */

interface TokenUsage {
  input_other?: number;
  inputOther?: number;
  output?: number;
  input_cache_read?: number;
  inputCacheRead?: number;
  input_cache_creation?: number;
  inputCacheCreation?: number;
}

interface LegacyPayload {
  model?: string;
  message_id?: string;
  token_usage?: TokenUsage;
}

interface LegacyKimiLine {
  type?: string;
  timestamp?: string | number;
  payload?: LegacyPayload;
  message?: {
    type?: string;
    payload?: LegacyPayload;
  };
}

interface KimiCodeLine {
  type?: string;
  model?: string;
  usage?: TokenUsage;
  usageScope?: string;
  time?: string | number;
  created_at?: string | number;
}

interface KimiConfig {
  model?: string;
  workspaces?: Record<string, { path?: string }>;
}

interface KimiCodeSessionIndexLine {
  sessionId?: string;
  sessionDir?: string;
  workDir?: string;
}

interface ParsedUsage {
  timestamp: Date;
  model: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  messageId?: string;
}

const DEFAULT_MODEL = 'kimi-for-coding';

export function resolveKimiCodeHome(home = homedir()): string {
  return process.env.KIMI_CODE_HOME?.trim() || join(home, '.kimi-code');
}

export async function scanKimiDates(
  targetDates: string[],
  legacyBaseDir?: string,
  projectAliases?: Record<string, string>,
  kimiCodeBaseDir?: string,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const legacyHome = legacyBaseDir ?? join(homedir(), '.kimi');
  const codeHome = kimiCodeBaseDir ?? (legacyBaseDir ? undefined : resolveKimiCodeHome());

  const [legacyFiles, codeFiles] = await Promise.all([
    findWireFiles(join(legacyHome, 'sessions')),
    codeHome ? findWireFiles(join(codeHome, 'sessions')) : Promise.resolve([]),
  ]);
  if (legacyFiles.length === 0 && codeFiles.length === 0) return emptyResult(dates);

  const [legacyWorkspaceMap, legacyModel, codeSessionIndex] = await Promise.all([
    loadLegacyWorkspaceMap(legacyHome),
    loadLegacyModel(legacyHome),
    codeHome ? loadKimiCodeSessionIndex(codeHome) : Promise.resolve(new Map<string, string>()),
  ]);

  const grouped = initDateMap(dates);
  const sessionSets = new Map<string, Set<string>>();
  const codeProjectCache = new Map<string, ProjectFields>();

  for (const filePath of legacyFiles) {
    const sessionDir = dirname(filePath);
    const workspaceHash = basename(dirname(sessionDir));
    const sessionId = basename(sessionDir);
    const rawProject = legacyWorkspaceMap.get(workspaceHash) ?? workspaceHash;
    const projectFields = resolveProjectFields(rawProject, projectAliases);
    const usages = await parseLegacyFile(filePath, legacyModel);

    for (const usage of usages) {
      addUsage(grouped, sessionSets, dates, usage, projectFields, sessionId);
    }
  }

  for (const filePath of codeFiles) {
    const pathInfo = getKimiCodePathInfo(filePath);
    if (!pathInfo) continue;

    let projectFields = codeProjectCache.get(pathInfo.sessionDir);
    if (!projectFields) {
      const rawProject = await resolveKimiCodeProjectPath(pathInfo, codeSessionIndex);
      projectFields = resolveProjectFields(rawProject, projectAliases);
      codeProjectCache.set(pathInfo.sessionDir, projectFields);
    }

    const usages = await parseKimiCodeFile(filePath);
    for (const usage of usages) {
      addUsage(grouped, sessionSets, dates, usage, projectFields, pathInfo.sessionId);
    }
  }

  const result = finalize(grouped);
  for (const [usageDate, breakdowns] of result) {
    for (const breakdown of breakdowns) {
      const key = `${usageDate}|${breakdown.model}|${breakdown.project}`;
      breakdown.sessionCount = sessionSets.get(key)?.size ?? 0;
    }
  }
  return result;
}

async function findWireFiles(sessionsDir: string): Promise<string[]> {
  return (await walkFiles(sessionsDir, '.jsonl'))
    .filter(filePath => basename(filePath) === 'wire.jsonl');
}

async function parseLegacyFile(filePath: string, fallbackModel: string): Promise<ParsedUsage[]> {
  const content = await safeRead(filePath);
  if (content == null) return [];

  const fallbackTimestamp = await fileModifiedDate(filePath);
  const usages: ParsedUsage[] = [];
  const keyedIndices = new Map<string, number>();
  let currentModel = fallbackModel;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let record: LegacyKimiLine;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = record.message?.payload ?? record.payload;
    if (payload?.model) currentModel = normalizeModel(payload.model);

    const eventType = record.message?.type ?? record.type;
    if (eventType !== 'StatusUpdate' || !payload?.token_usage) continue;

    const tokens = normalizeUsage(payload.token_usage);
    if (tokens.input + tokens.cached + tokens.cacheWrite + tokens.output === 0) continue;

    const timestamp = parseTs(record.timestamp) ?? fallbackTimestamp;
    if (!timestamp) continue;

    const usage: ParsedUsage = {
      timestamp,
      model: currentModel,
      ...tokens,
      messageId: payload.message_id,
    };
    pushOrReplaceProgressiveUsage(usages, keyedIndices, usage);
  }

  return usages;
}

async function parseKimiCodeFile(filePath: string): Promise<ParsedUsage[]> {
  const content = await safeRead(filePath);
  if (content == null) return [];

  const fallbackTimestamp = await fileModifiedDate(filePath);
  const usages: ParsedUsage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let record: KimiCodeLine;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type !== 'usage.record' || record.usageScope !== 'turn' || !record.usage) continue;

    const tokens = normalizeUsage(record.usage);
    if (tokens.input + tokens.cached + tokens.cacheWrite + tokens.output === 0) continue;

    const timestamp = parseTs(record.time ?? record.created_at) ?? fallbackTimestamp;
    if (!timestamp) continue;

    usages.push({
      timestamp,
      model: normalizeModel(record.model ?? DEFAULT_MODEL),
      ...tokens,
    });
  }

  return usages;
}

function addUsage(
  grouped: ReturnType<typeof initDateMap>,
  sessionSets: Map<string, Set<string>>,
  dates: Set<string>,
  usage: ParsedUsage,
  projectFields: ProjectFields,
  sessionId: string,
): void {
  const usageDate = dateKey(usage.timestamp);
  if (!dates.has(usageDate)) return;
  const dayMap = grouped.get(usageDate);
  if (!dayMap) return;

  const breakdownKey = `${usage.model}|${projectFields.project}`;
  accumulate(
    dayMap,
    breakdownKey,
    {
      provider: 'moonshot',
      product: 'kimi-code',
      channel: 'cli',
      model: usage.model,
      project: projectFields.project,
      projectDisplay: projectFields.projectDisplay,
      projectAlias: projectFields.projectAlias,
      sessionCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    {
      input: usage.input,
      cached: usage.cached,
      cacheWrite: usage.cacheWrite,
      output: usage.output,
      reasoning: 0,
    },
  );

  const sessionKey = `${usageDate}|${breakdownKey}`;
  let sessions = sessionSets.get(sessionKey);
  if (!sessions) {
    sessions = new Set<string>();
    sessionSets.set(sessionKey, sessions);
  }
  sessions.add(sessionId);
}

function normalizeUsage(usage: TokenUsage): Pick<ParsedUsage, 'input' | 'cached' | 'cacheWrite' | 'output'> {
  return {
    input: normalizeTokenCount(usage.inputOther ?? usage.input_other),
    cached: normalizeTokenCount(usage.inputCacheRead ?? usage.input_cache_read),
    cacheWrite: normalizeTokenCount(usage.inputCacheCreation ?? usage.input_cache_creation),
    output: normalizeTokenCount(usage.output),
  };
}

function normalizeTokenCount(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeModel(model: string): string {
  const trimmed = model.trim();
  return (trimmed.replace(/^kimi-code\//, '') || DEFAULT_MODEL);
}

function pushOrReplaceProgressiveUsage(
  usages: ParsedUsage[],
  keyedIndices: Map<string, number>,
  candidate: ParsedUsage,
): void {
  const messageId = candidate.messageId?.trim();
  if (!messageId) {
    usages.push(candidate);
    return;
  }

  const existingIndex = keyedIndices.get(messageId);
  if (existingIndex == null) {
    keyedIndices.set(messageId, usages.length);
    usages.push(candidate);
    return;
  }

  const existing = usages[existingIndex];
  const existingTotal = totalUsage(existing);
  const candidateTotal = totalUsage(candidate);
  if (
    candidateTotal > existingTotal ||
    (candidateTotal === existingTotal && candidate.timestamp >= existing.timestamp)
  ) {
    usages[existingIndex] = candidate;
  }
}

function totalUsage(usage: ParsedUsage): number {
  return usage.input + usage.cached + usage.cacheWrite + usage.output;
}

interface KimiCodePathInfo {
  sessionDir: string;
  sessionId: string;
  workspaceKey: string;
}

function getKimiCodePathInfo(filePath: string): KimiCodePathInfo | null {
  const agentDir = dirname(filePath);
  const agentsDir = dirname(agentDir);
  if (basename(agentsDir) !== 'agents') return null;
  const sessionDir = dirname(agentsDir);
  return {
    sessionDir,
    sessionId: basename(sessionDir),
    workspaceKey: basename(dirname(sessionDir)),
  };
}

async function resolveKimiCodeProjectPath(
  pathInfo: KimiCodePathInfo,
  sessionIndex: Map<string, string>,
): Promise<string> {
  try {
    const raw = await readFile(join(pathInfo.sessionDir, 'state.json'), 'utf-8');
    const state = JSON.parse(raw) as { workDir?: string };
    if (state.workDir?.trim()) return state.workDir;
  } catch {
    // Fall through to the session index and workspace key.
  }

  const indexed = sessionIndex.get(pathInfo.sessionId);
  if (indexed) return indexed;
  return workspaceLabel(pathInfo.workspaceKey);
}

function workspaceLabel(workspaceKey: string): string {
  const match = workspaceKey.match(/^wd_(.+)_[0-9a-f]{12}$/i);
  return match?.[1] || workspaceKey;
}

async function loadKimiCodeSessionIndex(kimiCodeHome: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const content = await safeRead(join(kimiCodeHome, 'session_index.jsonl'));
  if (content == null) return map;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as KimiCodeSessionIndexLine;
      if (record.sessionId?.trim() && record.workDir?.trim()) {
        map.set(record.sessionId, record.workDir);
      }
    } catch {
      continue;
    }
  }
  return map;
}

async function loadLegacyWorkspaceMap(kimiHome: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const raw = await readFile(join(kimiHome, 'kimi.json'), 'utf-8');
    const config = JSON.parse(raw) as KimiConfig;
    for (const [hash, info] of Object.entries(config.workspaces ?? {})) {
      if (info.path?.trim()) map.set(hash, info.path);
    }
  } catch {
    // Legacy config is optional.
  }
  return map;
}

async function loadLegacyModel(kimiHome: string): Promise<string> {
  for (const name of ['config.json', 'kimi.json']) {
    try {
      const raw = await readFile(join(kimiHome, name), 'utf-8');
      const config = JSON.parse(raw) as KimiConfig;
      if (config.model?.trim()) return normalizeModel(config.model);
    } catch {
      continue;
    }
  }
  return DEFAULT_MODEL;
}

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function fileModifiedDate(filePath: string): Promise<Date | null> {
  try {
    return (await stat(filePath)).mtime;
  } catch {
    return null;
  }
}
