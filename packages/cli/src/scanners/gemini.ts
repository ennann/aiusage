import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
  walkFiles,
  fileModifiedTs,
  normalizeModelName,
  resolveProjectFields,
} from './utils.js';

/**
 * Gemini CLI scanner.
 *
 * 支持 legacy/modern JSON、当前 session-*.jsonl、headless stream JSONL，
 * 以及 a2a 追加式 `$set.messages` 记录。损坏行会被跳过，缺失时间戳用 mtime 兜底。
 */

interface GeminiLogEntry {
  type?: string;
  timestamp?: string | number;
}

interface TokenValues {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

interface GeminiUsageEvent {
  model: string;
  timestamp: Date;
  tokens: TokenValues;
  dedupKey?: string;
}

export async function scanGeminiDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? join(homedir(), '.gemini', 'tmp');
  const [jsonFiles, jsonlFiles] = await Promise.all([
    walkFiles(dir, '.json'),
    walkFiles(dir, '.jsonl'),
  ]);
  const files = [...new Set([...jsonFiles, ...jsonlFiles])];
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const tokenBackedDates = new Set<string>();
  const seen = new Set<string>();

  for (const filePath of files) {
    if (basename(filePath) === 'logs.json') continue;
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }
    const fallbackTs = await fileModifiedTs(filePath);
    if (!fallbackTs) continue;
    const events = extname(filePath) === '.jsonl'
      ? parseGeminiJsonl(content, basename(filePath, '.jsonl'), fallbackTs)
      : parseGeminiJson(content, basename(filePath, '.json'), fallbackTs);
    const fields = projectFieldsFromFile(filePath, dir, projectAliases);

    for (const event of events) {
      if (event.dedupKey) {
        if (seen.has(event.dedupKey)) continue;
        seen.add(event.dedupKey);
      }
      const dk = dateKey(event.timestamp);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;
      tokenBackedDates.add(dk);
      const model = normalizeModelName(event.model || 'unknown');
      accumulate(
        dayMap,
        `${model}|${fields.project}`,
        {
          provider: 'google',
          product: 'gemini-cli',
          channel: 'cli',
          model,
          project: fields.project,
          projectDisplay: fields.projectDisplay,
          projectAlias: fields.projectAlias,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        event.tokens,
      );
    }
  }

  for (const filePath of jsonFiles.filter(file => basename(file) === 'logs.json')) {
    await collectGeminiLogEvents(filePath, grouped, tokenBackedDates);
  }
  return finalize(grouped);
}

function parseGeminiJson(content: string, fallbackId: string, fallbackTs: Date): GeminiUsageEvent[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isObject(value)) return [];
  return parseGeminiValue(value, fallbackId, fallbackTs);
}

function parseGeminiJsonl(content: string, fallbackId: string, fallbackTs: Date): GeminiUsageEvent[] {
  let sessionId = fallbackId;
  let currentModel: string | undefined;
  const keyed = new Map<string, GeminiUsageEvent>();
  const anonymous: GeminiUsageEvent[] = [];

  const add = (event: GeminiUsageEvent): void => {
    if (event.dedupKey) keyed.set(event.dedupKey, event);
    else anonymous.push(event);
  };

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isObject(parsed)) continue;
      value = parsed;
    } catch {
      continue;
    }

    sessionId = stringValue(value.session_id) ?? stringValue(value.sessionId) ?? sessionId;
    currentModel = stringValue(value.model) ?? currentModel;
    if (value.type === 'init') continue;

    const set = isObject(value.$set) ? value.$set : undefined;
    if (set) {
      currentModel = stringValue(set.model) ?? currentModel;
      for (const message of arrayValue(set.messages)) {
        const event = parseGeminiMessage(message, currentModel, sessionId, fallbackTs, true);
        if (event) add(event);
      }
    }

    for (const message of arrayValue(value.messages)) {
      const event = parseGeminiMessage(message, currentModel, sessionId, fallbackTs, true);
      if (event) add(event);
    }

    const direct = parseDirectGeminiEvent(value, currentModel, sessionId, fallbackTs);
    if (direct) {
      currentModel = direct.model;
      add(direct);
      continue;
    }

    const stats = isObject(value.stats)
      ? value.stats
      : isObject(value.result) && isObject(value.result.stats) ? value.result.stats : undefined;
    if (stats) {
      for (const event of parseGeminiStats(stats, currentModel, sessionId, timestampFrom(value) ?? fallbackTs)) add(event);
    }
  }
  return [...keyed.values(), ...anonymous];
}

function parseGeminiValue(
  value: Record<string, unknown>,
  fallbackId: string,
  fallbackTs: Date,
): GeminiUsageEvent[] {
  const data = isObject(value.data) ? value.data : undefined;
  const sessionId = stringValue(value.sessionId)
    ?? stringValue(value.session_id)
    ?? fallbackId;
  const fallbackModel = stringValue(value.model) ?? stringValue(data?.model);
  const sessionTs = timestampFrom(value)
    ?? timestampFrom(data)
    ?? parseTs(value.startTime as string | number | undefined)
    ?? fallbackTs;
  const messages = [
    ...arrayValue(value.messages),
    ...arrayValue(value.history),
    ...arrayValue(data?.messages),
    ...arrayValue(data?.history),
  ];
  const keyed = new Map<string, GeminiUsageEvent>();
  const anonymous: GeminiUsageEvent[] = [];
  for (const message of messages) {
    const event = parseGeminiMessage(message, fallbackModel, sessionId, sessionTs, false);
    if (!event) continue;
    if (event.dedupKey) keyed.set(event.dedupKey, event);
    else anonymous.push(event);
  }
  if (keyed.size + anonymous.length > 0) return [...keyed.values(), ...anonymous];

  const direct = parseDirectGeminiEvent(value, fallbackModel, sessionId, sessionTs);
  if (direct) return [direct];
  const stats = isObject(value.stats)
    ? value.stats
    : isObject(value.result) && isObject(value.result.stats) ? value.result.stats : undefined;
  return stats ? parseGeminiStats(stats, fallbackModel, sessionId, sessionTs) : [];
}

function parseGeminiMessage(
  message: Record<string, unknown>,
  fallbackModel: string | undefined,
  sessionId: string,
  fallbackTs: Date,
  usageMetadataIsInclusive: boolean,
): GeminiUsageEvent | undefined {
  const nested = isObject(message.message) ? message.message : undefined;
  const source = nested ?? message;
  const usageMetadata = isObject(source.usageMetadata)
    ? source.usageMetadata
    : isObject(source.usage) ? source.usage : undefined;
  const tokens = isObject(source.tokens) ? source.tokens : undefined;
  const tokenValues = usageMetadata
    ? extractTokenValues(usageMetadata, usageMetadataIsInclusive || hasUsageMetadataKeys(usageMetadata))
    : tokens ? extractTokenValues(tokens, false) : undefined;
  if (!tokenValues || tokenTotal(tokenValues) === 0) return undefined;

  const model = stringValue(source.model) ?? stringValue(message.model) ?? fallbackModel ?? 'unknown';
  const timestamp = timestampFrom(message) ?? timestampFrom(source) ?? fallbackTs;
  const id = stringValue(message.id) ?? stringValue(source.id) ?? stringValue(message.messageId);
  return {
    model,
    timestamp,
    tokens: tokenValues,
    dedupKey: id ? `gemini:${sessionId}:${id}` : undefined,
  };
}

function parseDirectGeminiEvent(
  value: Record<string, unknown>,
  modelHint: string | undefined,
  sessionId: string,
  fallbackTs: Date,
): GeminiUsageEvent | undefined {
  const tokens = isObject(value.tokens) ? value.tokens : undefined;
  if (!tokens || (value.type !== 'gemini' && !value.model && !modelHint)) return undefined;
  const tokenValues = extractTokenValues(
    tokens,
    hasAny(tokens, ['prompt', 'prompt_tokens', 'input_tokens', 'promptTokenCount']),
  );
  if (tokenTotal(tokenValues) === 0) return undefined;
  const id = stringValue(value.id);
  return {
    model: stringValue(value.model) ?? modelHint ?? 'unknown',
    timestamp: timestampFrom(value) ?? fallbackTs,
    tokens: tokenValues,
    dedupKey: id ? `gemini:${sessionId}:${id}` : undefined,
  };
}

function parseGeminiStats(
  stats: Record<string, unknown>,
  modelHint: string | undefined,
  sessionId: string,
  timestamp: Date,
): GeminiUsageEvent[] {
  const models = isObject(stats.models) ? stats.models : undefined;
  const entries = models ? Object.entries(models) : [[modelHint ?? 'unknown', stats] as const];
  return entries.flatMap(([model, raw], index) => {
    if (!isObject(raw)) return [];
    const wrapped = isObject(raw.tokens);
    const source = wrapped ? raw.tokens as Record<string, unknown> : raw;
    const inclusive = hasAny(source, ['prompt', 'prompt_tokens', 'input_tokens']) || wrapped;
    const tokens = extractTokenValues(source, inclusive);
    if (tokenTotal(tokens) === 0) return [];
    return [{ model, timestamp, tokens, dedupKey: `gemini:${sessionId}:stats:${model}:${index}:${timestamp.getTime()}` }];
  });
}

function extractTokenValues(value: Record<string, unknown>, inputIncludesCache: boolean): TokenValues {
  const rawInput = firstNumber(value, ['input', 'prompt', 'input_tokens', 'prompt_tokens', 'promptTokenCount']);
  const cached = firstNumber(value, ['cached', 'cached_tokens', 'cachedContentTokenCount']);
  const output = firstNumber(value, ['output', 'candidates', 'output_tokens', 'completion_tokens', 'candidates_tokens', 'candidatesTokenCount']);
  const reasoning = firstNumber(value, ['thoughts', 'reasoning', 'thoughts_tokens', 'reasoning_tokens', 'thoughtsTokenCount']);
  const tool = firstNumber(value, ['tool', 'tool_tokens']);
  const total = optionalNumber(value, ['total', 'total_tokens', 'totalTokenCount']);

  let input = rawInput;
  if (inputIncludesCache) {
    input = Math.max(rawInput - Math.min(rawInput, cached), 0);
  } else if (total != null && cached > 0) {
    const inclusiveTotal = rawInput + output + reasoning + tool;
    if (total === inclusiveTotal) input = Math.max(rawInput - Math.min(rawInput, cached), 0);
  }
  return { input: input + tool, cached, cacheWrite: 0, output, reasoning };
}

async function collectGeminiLogEvents(
  filePath: string,
  grouped: Map<string, Map<string, IngestBreakdown>>,
  tokenBackedDates: Set<string>,
): Promise<void> {
  let rows: GeminiLogEntry[];
  try {
    rows = JSON.parse(await readFile(filePath, 'utf-8')) as GeminiLogEntry[];
  } catch {
    return;
  }
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (row.type && row.type !== 'user') continue;
    const ts = parseTs(row.timestamp);
    if (!ts) continue;
    const dk = dateKey(ts);
    if (tokenBackedDates.has(dk)) continue;
    const dayMap = grouped.get(dk);
    if (!dayMap) continue;
    accumulate(
      dayMap,
      'unknown|unknown',
      {
        provider: 'google', product: 'gemini-cli', channel: 'cli', model: 'unknown',
        project: 'unknown', projectDisplay: 'unknown', inputTokens: 0, cachedInputTokens: 0,
        cacheWriteTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
      },
      { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    );
  }
}

function projectFieldsFromFile(
  filePath: string,
  baseDir: string,
  aliases?: Record<string, string>,
) {
  const first = relative(baseDir, filePath).split(sep).filter(Boolean)[0];
  return first && first !== basename(filePath)
    ? resolveProjectFields(first, aliases)
    : { project: 'unknown', projectDisplay: 'unknown' };
}

function timestampFrom(value: Record<string, unknown> | undefined): Date | null {
  if (!value) return null;
  return parseTs((value.timestamp ?? value.createTime ?? value.created_at ?? value.lastUpdated) as string | number | undefined);
}

function firstNumber(value: Record<string, unknown>, keys: string[]): number {
  return Math.max(optionalNumber(value, keys) ?? 0, 0);
}

function optionalNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = value[key];
    const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function hasUsageMetadataKeys(value: Record<string, unknown>): boolean {
  return hasAny(value, ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount']);
}

function hasAny(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.some(key => value[key] != null);
}

function tokenTotal(tokens: TokenValues): number {
  return tokens.input + tokens.cached + tokens.cacheWrite + tokens.output + tokens.reasoning;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
