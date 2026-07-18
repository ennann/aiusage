import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
  resolveProjectFields,
  fileModifiedTs,
  inferProviderFromModel,
  type ProjectFields,
} from './utils.js';

/**
 * GitHub Copilot CLI scanner.
 *
 * 日志目录: ~/.copilot/session-state/{sessionDir}/events.jsonl、~/.copilot/otel/*.jsonl
 * 以及 COPILOT_OTEL_FILE_EXPORTER_PATH 指定文件。
 * - session.start / session.resume → data.context.gitRoot / cwd 提取 project
 * - session.shutdown → data.modelMetrics 提取 token 用量
 */

interface CopilotEvent {
  type?: string;
  timestamp?: string | number;
  data?: {
    context?: {
      gitRoot?: string;
      cwd?: string;
    };
    modelMetrics?: Record<
      string,
      {
        usage?: {
          inputTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
          outputTokens?: number;
          reasoningTokens?: number;
        };
      }
    >;
  };
}

export async function scanCopilotDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dirs = baseDir
    ? [baseDir]
    : [join(homedir(), '.copilot', 'session-state'), join(homedir(), '.copilot', 'otel')];
  const files = [...new Set((await Promise.all(dirs.map(dir => walkFiles(dir, '.jsonl')))).flat())];
  const explicitOtel = baseDir ? undefined : process.env.COPILOT_OTEL_FILE_EXPORTER_PATH?.trim();
  if (explicitOtel) files.push(explicitOtel);
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const seenOtel = new Set<string>();

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let sessionProjectFields: ProjectFields = { project: 'unknown', projectDisplay: 'unknown' };
    const records: Record<string, unknown>[] = [];

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isObject(parsed)) continue;
      records.push(parsed);
      const obj = parsed as CopilotEvent;

      // 从 session.start / session.resume 获取 project
      if (obj.type === 'session.start' || obj.type === 'session.resume') {
        const ctx = obj.data?.context;
        const raw = ctx?.gitRoot ?? ctx?.cwd;
        if (raw) sessionProjectFields = resolveProjectFields(raw, projectAliases);
      }

      // 仅从 session.shutdown 提取 token
      if (obj.type !== 'session.shutdown') continue;

      const ts = parseTs(obj.timestamp);
      if (!ts) continue;
      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      const metrics = obj.data?.modelMetrics;
      if (!metrics) continue;

      for (const [model, entry] of Object.entries(metrics)) {
        const usage = entry.usage;
        if (!usage) continue;

        const rawInput = clamp(usage.inputTokens);
        const cacheRead = clamp(usage.cacheReadTokens);
        const cacheWrite = clamp(usage.cacheWriteTokens);
        const output = clamp(usage.outputTokens);
        const reasoning = clamp(usage.reasoningTokens);
        const input = Math.max(rawInput - Math.min(cacheRead, rawInput), 0);

        accumulate(
          dayMap,
          `${model}|${sessionProjectFields.project}`,
          {
            provider: 'github',
            product: 'copilot-cli',
            channel: 'cli',
            model,
            project: sessionProjectFields.project,
            projectDisplay: sessionProjectFields.projectDisplay,
            projectAlias: sessionProjectFields.projectAlias,
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
          },
          { input, cached: cacheRead, cacheWrite, output, reasoning },
        );
      }
    }

    const fallbackTs = await fileModifiedTs(filePath);
    if (!fallbackTs) continue;
    for (const candidate of selectOtelCandidates(records, fallbackTs)) {
      if (seenOtel.has(candidate.dedupKey)) continue;
      seenOtel.add(candidate.dedupKey);
      const dayMap = grouped.get(dateKey(candidate.timestamp));
      if (!dayMap) continue;
      accumulate(
        dayMap,
        `${candidate.provider}|${candidate.model}|unknown`,
        {
          provider: candidate.provider,
          product: 'copilot-cli',
          channel: 'cli',
          model: candidate.model,
          project: 'unknown',
          projectDisplay: 'unknown',
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        candidate.tokens,
      );
    }
  }

  return finalize(grouped);
}

type OtelSource = 'chat' | 'inference' | 'agent-turn' | 'summary';

interface OtelCandidate {
  source: OtelSource;
  traceId?: string;
  responseId?: string;
  model: string;
  provider: string;
  timestamp: Date;
  dedupKey: string;
  tokens: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number };
}

function selectOtelCandidates(records: Record<string, unknown>[], fallbackTs: Date): OtelCandidate[] {
  const candidates = records.flatMap((record, index) => {
    const candidate = otelCandidate(record, index, fallbackTs);
    return candidate ? [candidate] : [];
  });
  const traces = (source: OtelSource) => new Set(candidates.filter(c => c.source === source).flatMap(c => c.traceId ? [c.traceId] : []));
  const responses = (source: OtelSource) => new Set(candidates.filter(c => c.source === source).flatMap(c => c.responseId ? [c.responseId] : []));
  const chatTraces = traces('chat');
  const inferenceTraces = traces('inference');
  const agentTraces = traces('agent-turn');
  const chatResponses = responses('chat');
  const inferenceResponses = responses('inference');
  const agentResponses = responses('agent-turn');

  return candidates.filter(candidate => {
    if (candidate.source === 'chat') return true;
    if (candidate.source === 'inference') {
      return !(candidate.traceId && chatTraces.has(candidate.traceId))
        && !(candidate.responseId && chatResponses.has(candidate.responseId));
    }
    if (candidate.source === 'agent-turn') {
      return !(candidate.traceId && (chatTraces.has(candidate.traceId) || inferenceTraces.has(candidate.traceId)))
        && !(candidate.responseId && (chatResponses.has(candidate.responseId) || inferenceResponses.has(candidate.responseId)));
    }
    return !(candidate.traceId && (
      chatTraces.has(candidate.traceId)
      || inferenceTraces.has(candidate.traceId)
      || agentTraces.has(candidate.traceId)
    )) && !(candidate.responseId && (
      chatResponses.has(candidate.responseId)
      || inferenceResponses.has(candidate.responseId)
      || agentResponses.has(candidate.responseId)
    ));
  });
}

function otelCandidate(
  record: Record<string, unknown>,
  index: number,
  fallbackTs: Date,
): OtelCandidate | undefined {
  const attributes = isObject(record.attributes) ? record.attributes : undefined;
  if (!attributes) return undefined;
  const source = otelSource(record, attributes);
  if (!source) return undefined;

  const rawInput = attrNumber(attributes, ['gen_ai.usage.input_tokens']);
  const cached = attrNumber(attributes, [
    'gen_ai.usage.cache_read.input_tokens', 'gen_ai.usage.cache_read_input_tokens',
  ]);
  const cacheWrite = attrNumber(attributes, [
    'gen_ai.usage.cache_write.input_tokens', 'gen_ai.usage.cache_creation.input_tokens',
    'gen_ai.usage.cache_write_input_tokens', 'gen_ai.usage.cache_creation_input_tokens',
  ]);
  const output = attrNumber(attributes, ['gen_ai.usage.output_tokens']);
  const reasoning = attrNumber(attributes, [
    'gen_ai.usage.reasoning.output_tokens', 'gen_ai.usage.reasoning_tokens',
  ]);
  const input = Math.max(rawInput - Math.min(cached, rawInput), 0);
  if (input + cached + cacheWrite + output + reasoning === 0) return undefined;

  const traceId = stringAttr(record, ['traceId'])
    ?? (isObject(record.spanContext) ? stringAttr(record.spanContext, ['traceId']) : undefined);
  const spanId = stringAttr(record, ['spanId'])
    ?? (isObject(record.spanContext) ? stringAttr(record.spanContext, ['spanId']) : undefined);
  const responseId = stringAttr(attributes, ['gen_ai.response.id']);
  const sessionId = stringAttr(attributes, [
    'gen_ai.conversation.id', 'session.id', 'github.copilot.session_id',
    'github.copilot.interaction_id', 'copilot_chat.session.id',
  ]) ?? traceId ?? 'unknown-session';
  const model = stringAttr(attributes, [
    'gen_ai.response.model', 'gen_ai.request.model', 'gen_ai.system', 'copilot_chat.model',
  ]) ?? 'unknown';
  const provider = inferProviderFromModel(model, 'github-copilot');
  const timestamp = otelRecordTimestamp(record) ?? fallbackTs;
  const dedupKey = responseId
    ? `copilot:${source}:response:${responseId}`
    : traceId && spanId
      ? `copilot:${source}:${traceId}:${spanId}`
      : `copilot:${source}:${sessionId}:${timestamp.getTime()}:${index}`;
  return {
    source, traceId, responseId, model, provider, timestamp, dedupKey,
    tokens: { input, cached, cacheWrite, output, reasoning },
  };
}

function otelSource(
  record: Record<string, unknown>,
  attributes: Record<string, unknown>,
): OtelSource | undefined {
  const name = typeof record.name === 'string' ? record.name : '';
  const body = typeof record.body === 'string' ? record.body : typeof record._body === 'string' ? record._body : '';
  const eventName = typeof attributes['event.name'] === 'string' ? attributes['event.name'] : '';
  const operation = typeof attributes['gen_ai.operation.name'] === 'string' ? attributes['gen_ai.operation.name'] : '';
  const span = record.type === 'span' || (record.type == null && Boolean(name) && (
    record.spanId != null || record.traceId != null || record.startTime != null || record.endTime != null
  ));
  if (span && (operation === 'chat' || name.startsWith('chat '))) return 'chat';
  if (!span && (eventName === 'gen_ai.client.inference.operation.details' || body.startsWith('GenAI inference:'))) return 'inference';
  if (!span && (eventName === 'copilot_chat.agent.turn' || body.startsWith('copilot_chat.agent.turn'))) return 'agent-turn';
  if (span && (operation === 'invoke_agent' || name.startsWith('invoke_agent'))) return 'summary';
  return undefined;
}

function otelTimestamp(value: unknown): Date | null {
  if (Array.isArray(value) && value.length >= 1) {
    const seconds = Number(value[0]);
    const nanos = Number(value[1] ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) return parseTs(seconds * 1_000 + nanos / 1_000_000);
  }
  if (typeof value === 'number' || typeof value === 'string') return otelScalarTimestamp(value);
  return null;
}

function otelRecordTimestamp(record: Record<string, unknown>): Date | null {
  const start = otelTimestamp(record.startTime);
  if (start) return start;
  const end = otelTimestamp(record.endTime);
  if (end) {
    const duration = otelDurationMs(record.duration);
    return duration ? new Date(end.getTime() - duration) : end;
  }
  return otelTimestamp(record.hrTime)
    ?? otelTimestamp(record._hrTime)
    ?? otelTimestamp(record.time)
    ?? otelTimestamp(record.timestamp)
    ?? otelTimestamp(record.observedTimestamp)
    ?? otelTimestamp(record.timeUnixNano);
}

function otelScalarTimestamp(value: string | number): Date | null {
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) return parseTs(value);
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const abs = Math.abs(raw);
  const millis = abs >= 1e17 ? raw / 1e6 : abs >= 1e14 ? raw / 1e3 : raw;
  return parseTs(millis);
}

function otelDurationMs(value: unknown): number | null {
  if (Array.isArray(value) && value.length > 0) {
    const seconds = Number(value[0]);
    const nanos = Number(value[1] ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) return seconds * 1_000 + nanos / 1_000_000;
  }
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw >= 1e6 ? raw / 1e6 : raw;
}

function attrNumber(attributes: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const raw = attributes[key];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function stringAttr(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number | undefined): number {
  return Math.max(Number.isFinite(value) ? value! : 0, 0);
}
