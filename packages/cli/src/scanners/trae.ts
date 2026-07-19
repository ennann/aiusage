import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { PRICING_VERSION, type IngestBreakdown } from '@aiusage/shared';
import {
  accumulate,
  dateKey,
  emptyResult,
  finalize,
  inferProviderFromModel,
  initDateMap,
  parseTs,
  resolveProjectFields,
  walkFiles,
} from './utils.js';

/**
 * Trae scanner.
 *
 * - Trae CN: reads the privacy-minimized cache written by `aiusage trae sync`.
 * - Trae international: reads AIUsage's account API cache and remains
 *   compatible with tokscale's `trae-cache/sessions/*.json`.
 *
 * The tokscale cache compatibility follows its MIT-licensed Trae parser:
 * https://github.com/junhoyeo/tokscale/blob/main/crates/tokscale-core/src/sessions/trae.rs
 */

export interface TraeCachedUsageEvent {
  messageId: string;
  timestamp: string | number;
  model?: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface TraeCachedSession {
  schemaVersion: 1;
  source: 'trae-cn-local-rpc';
  syncedAt: string;
  sessionId: string;
  project: string;
  events: TraeCachedUsageEvent[];
}

interface TokscaleTraeSession {
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
}

interface ParsedEvent {
  dedupKey: string;
  sessionId: string;
  timestamp: Date;
  product: 'trae-cn' | 'trae-intl';
  provider: string;
  model: string;
  project: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  costUSD?: number;
}

export interface TraeScanOptions {
  nativeCacheDir?: string;
  intlCacheDir?: string;
  tokscaleCacheDir?: string;
  projectAliases?: Record<string, string>;
}

export function resolveTraeNativeCacheDir(home = homedir()): string {
  const explicit = process.env.AIUSAGE_TRAE_CACHE_DIR?.trim();
  return explicit ? resolve(explicit) : join(home, '.aiusage', 'trae-cache', 'sessions');
}

export function resolveTokscaleTraeCacheDir(home = homedir()): string {
  const configDir = process.env.TOKSCALE_CONFIG_DIR?.trim();
  return configDir
    ? join(resolve(configDir), 'trae-cache', 'sessions')
    : join(home, '.config', 'tokscale', 'trae-cache', 'sessions');
}

export function resolveTraeIntlCacheDir(home = homedir()): string {
  const explicit = process.env.AIUSAGE_TRAE_INTL_CACHE_DIR?.trim();
  return explicit
    ? resolve(explicit)
    : join(home, '.aiusage', 'trae-cache', 'intl', 'sessions');
}

export async function scanTraeDates(
  targetDates: string[],
  options: TraeScanOptions = {},
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  if (dates.size === 0) return new Map();

  const nativeDir = options.nativeCacheDir ?? resolveTraeNativeCacheDir();
  const intlDir = options.intlCacheDir ?? resolveTraeIntlCacheDir();
  const tokscaleDir = options.tokscaleCacheDir ?? resolveTokscaleTraeCacheDir();
  const cacheSources = [...new Set([
    `${nativeDir}\0native`,
    `${intlDir}\0intl`,
    `${tokscaleDir}\0tokscale`,
  ])];
  const files = (await Promise.all(cacheSources.map(async source => {
    const [dir, kind] = source.split('\0') as [string, 'native' | 'intl' | 'tokscale'];
    return (await walkFiles(dir, '.json')).map(filePath => ({ filePath, kind }));
  }))).flat();

  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const selectedEvents = new Map<string, ParsedEvent>();
  const sessionSets = new Map<string, Set<string>>();

  for (const { filePath, kind } of files) {
    const value = await readJson(filePath);
    if (value == null) continue;

    const events = kind === 'native' ? parseNativeCache(value) : parseIntlCache(value);

    for (const event of events) {
      const existing = selectedEvents.get(event.dedupKey);
      if (!existing || shouldReplaceEvent(existing, event)) {
        selectedEvents.set(event.dedupKey, event);
      }
    }
  }

  for (const event of selectedEvents.values()) {
    const usageDate = dateKey(event.timestamp);
    if (!dates.has(usageDate)) continue;
    const day = grouped.get(usageDate);
    if (!day) continue;

    const projectFields = resolveProjectFields(event.project, options.projectAliases);
    const breakdownKey = `${event.product}|${event.provider}|${event.model}|${projectFields.project}`;
    accumulate(
      day,
      breakdownKey,
      {
        provider: event.provider,
        product: event.product,
        channel: 'ide',
        model: event.model,
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
      event,
    );

    if (event.costUSD && event.costUSD > 0) {
      const breakdown = day.get(breakdownKey);
      if (breakdown) {
        breakdown.costUSD = (breakdown.costUSD ?? 0) + event.costUSD;
        // International Trae returns the vendor's account-level charge.
        breakdown.pricingVersion = PRICING_VERSION;
      }
    }

    const sessionKey = `${usageDate}|${breakdownKey}`;
    let sessions = sessionSets.get(sessionKey);
    if (!sessions) {
      sessions = new Set<string>();
      sessionSets.set(sessionKey, sessions);
    }
    sessions.add(event.sessionId);
  }

  const result = finalize(grouped);
  for (const [usageDate, breakdowns] of result) {
    for (const breakdown of breakdowns) {
      const key = `${usageDate}|${breakdown.product}|${breakdown.provider}|${breakdown.model}|${breakdown.project}`;
      breakdown.sessionCount = sessionSets.get(key)?.size ?? 0;
    }
  }
  return result;
}

function parseNativeCache(value: unknown): ParsedEvent[] {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.source !== 'trae-cn-local-rpc') return [];
  const sessionId = stringValue(value.sessionId);
  const project = stringValue(value.project) || 'unknown';
  if (!sessionId || !Array.isArray(value.events)) return [];

  const events: ParsedEvent[] = [];
  for (const raw of value.events) {
    if (!isRecord(raw)) continue;
    const messageId = stringValue(raw.messageId);
    const timestamp = parseTs(raw.timestamp as string | number | undefined);
    if (!messageId || !timestamp) continue;

    const model = normalizeTraeModel(stringValue(raw.model));
    const tokens = {
      input: tokenValue(raw.inputTokens),
      cached: tokenValue(raw.cachedInputTokens),
      cacheWrite: tokenValue(raw.cacheWriteTokens),
      output: tokenValue(raw.outputTokens),
      reasoning: tokenValue(raw.reasoningOutputTokens),
    };
    if (tokenTotal(tokens) === 0) continue;

    events.push({
      dedupKey: `trae-cn:${messageId}`,
      sessionId,
      timestamp,
      product: 'trae-cn',
      provider: inferProviderFromModel(model, 'trae'),
      model,
      project,
      ...tokens,
    });
  }
  return events;
}

function parseIntlCache(value: unknown): ParsedEvent[] {
  if (!Array.isArray(value)) return [];
  const events: ParsedEvent[] = [];

  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const session = raw as TokscaleTraeSession;
    const sessionId = stringValue(session.session_id);
    const timestamp = parseTs(session.usage_time);
    if (!sessionId || !timestamp || !session.usage_time || session.usage_time <= 0) continue;

    const rawModel = stringValue(session.model_name);
    const mode = stringValue(session.mode);
    const model = rawModel
      ? normalizeTraeModel(rawModel)
      : mode
        ? `trae-${mode.toLowerCase()}`
        : 'trae-unknown';
    const extra = session.extra_info ?? {};
    const tokens = {
      input: tokenValue(extra.input_token),
      cached: tokenValue(extra.cache_read_token),
      cacheWrite: tokenValue(extra.cache_write_token),
      output: tokenValue(extra.output_token),
      reasoning: 0,
    };
    if (tokenTotal(tokens) === 0) continue;

    events.push({
      // The international API returns aggregate rows by session. Multiple
      // cache artifacts can contain newer snapshots of the same session.
      dedupKey: `trae-intl:${sessionId}`,
      sessionId,
      timestamp,
      product: 'trae-intl',
      provider: inferProviderFromModel(model, 'trae'),
      model,
      project: 'unknown',
      ...tokens,
      costUSD: positiveNumber(session.dollar_float),
    });
  }
  return events;
}

function shouldReplaceEvent(existing: ParsedEvent, incoming: ParsedEvent): boolean {
  if (incoming.timestamp.getTime() !== existing.timestamp.getTime()) {
    return incoming.timestamp > existing.timestamp;
  }
  const incomingTotal = tokenTotal(incoming);
  const existingTotal = tokenTotal(existing);
  if (incomingTotal !== existingTotal) return incomingTotal > existingTotal;
  return (incoming.costUSD ?? 0) > (existing.costUSD ?? 0);
}

export function normalizeTraeModel(name?: string): string {
  const value = name?.trim() ?? '';
  const aliases: Record<string, string> = {
    'GPT-5.4': 'gpt-5.4',
    'GPT-5.3-Codex': 'gpt-5.3-codex',
    'GPT-5.3 Codex': 'gpt-5.3-codex',
    'GPT-5.3': 'gpt-5.3',
    'GPT-5.2-Codex': 'gpt-5.2-codex',
    'GPT-5.2 Codex': 'gpt-5.2-codex',
    'GPT-5.2': 'gpt-5.2',
    'GPT-5.1-Codex': 'gpt-5.1-codex',
    'GPT-5.1 Codex': 'gpt-5.1-codex',
    'GPT-5.1': 'gpt-5.1',
    'Gemini 3.1 Pro': 'gemini-3.1-pro',
    'Gemini 3.1': 'gemini-3.1',
    'GLM 5.1': 'glm-5.1',
    'GLM-5.1': 'glm-5.1',
    'Claude Sonnet 4.6': 'claude-sonnet-4.6',
    'Claude-Sonnet-4.6': 'claude-sonnet-4.6',
    'Claude Sonnet 4.5': 'claude-sonnet-4.5',
    'Claude-Sonnet-4.5': 'claude-sonnet-4.5',
  };
  return aliases[value] ?? (value || 'trae-unknown');
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function tokenValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function tokenTotal(tokens: Pick<ParsedEvent, 'input' | 'cached' | 'cacheWrite' | 'output' | 'reasoning'>): number {
  return tokens.input + tokens.cached + tokens.cacheWrite + tokens.output + tokens.reasoning;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
