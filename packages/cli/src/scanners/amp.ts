import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  walkFiles,
  fileModifiedTs,
  inferProviderFromModel,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
} from './utils.js';

/**
 * Amp (Sourcegraph) scanner.
 *
 * 同时解析 usageLedger 和 assistant message usage。两者会按 messageId、
 * 再按模型与 token 指纹对账，既保留部分 ledger 之外的消息，也避免完整 ledger 双计。
 */

type AmpId = string | number;

interface AmpMessageUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

interface AmpMessage {
  role?: string;
  messageId?: AmpId;
  timestamp?: string | number;
  model?: string;
  usage?: AmpMessageUsage;
}

interface AmpLedgerEvent {
  timestamp?: string | number;
  model?: string;
  tokens?: {
    input?: number;
    output?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  toMessageId?: AmpId;
}

interface AmpThread {
  id?: string;
  created?: string | number;
  messages?: Record<string, AmpMessage> | AmpMessage[];
  usageLedger?: { events?: AmpLedgerEvent[] };
}

interface AmpTokens {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

interface AmpRecord {
  model: string;
  timestamp: Date;
  hasExplicitTimestamp: boolean;
  messageId?: string;
  ledgerToMessageId?: string;
  tokens: AmpTokens;
}

function resolveAmpDir(baseDir?: string): string {
  if (baseDir) return baseDir;
  const ampDataDir = process.env['AMP_DATA_DIR'];
  if (ampDataDir) return join(ampDataDir, 'threads');
  const xdgDataHome = process.env['XDG_DATA_HOME'];
  if (xdgDataHome) return join(xdgDataHome, 'amp', 'threads');
  return join(homedir(), '.local', 'share', 'amp', 'threads');
}

export async function scanAmpDates(
  targetDates: string[],
  baseDir?: string,
  _projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const files = (await walkFiles(resolveAmpDir(baseDir), '.json')).filter(file =>
    basename(file).startsWith('T-'),
  );
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of files) {
    let thread: AmpThread;
    try {
      thread = JSON.parse(await readFile(filePath, 'utf-8')) as AmpThread;
    } catch {
      continue;
    }

    const fileTs = await fileModifiedTs(filePath);
    const threadTs = parseTs(thread.created) ?? fileTs;
    if (!threadTs) continue;

    const ledger = buildLedgerRecords(thread.usageLedger?.events ?? [], threadTs);
    const messages = buildMessageRecords(thread.messages, threadTs);
    const records = reconcileAmpRecords(ledger, messages);

    for (const record of records) {
      const dayMap = grouped.get(dateKey(record.timestamp));
      if (!dayMap) continue;
      const { input, cached, cacheWrite, output, reasoning } = record.tokens;
      if (input + cached + cacheWrite + output + reasoning === 0) continue;
      const provider = inferProviderFromModel(record.model, 'anthropic');

      accumulate(
        dayMap,
        `${provider}|${record.model}|unknown`,
        {
          provider,
          product: 'amp',
          channel: 'cli',
          model: record.model,
          project: 'unknown',
          projectDisplay: 'unknown',
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        record.tokens,
      );
    }
  }

  return finalize(grouped);
}

function buildLedgerRecords(events: AmpLedgerEvent[], fallbackTs: Date): AmpRecord[] {
  return events.map(event => {
    const explicitTs = parseTs(event.timestamp);
    return {
      model: event.model ?? 'unknown',
      timestamp: explicitTs ?? fallbackTs,
      hasExplicitTimestamp: Boolean(explicitTs),
      ledgerToMessageId: normalizeId(event.toMessageId),
      tokens: {
        input: clamp(event.tokens?.input),
        output: clamp(event.tokens?.output),
        cached: clamp(event.tokens?.cacheReadInputTokens),
        cacheWrite: clamp(event.tokens?.cacheCreationInputTokens),
        reasoning: 0,
      },
    };
  });
}

function buildMessageRecords(
  messages: Record<string, AmpMessage> | AmpMessage[] | undefined,
  fallbackTs: Date,
): AmpRecord[] {
  if (!messages) return [];
  const entries = Array.isArray(messages)
    ? messages.map((message, index) => [String(index), message] as const)
    : Object.entries(messages);

  return entries.flatMap(([key, message], index) => {
    if (message.role && message.role !== 'assistant') return [];
    const usage = message.usage;
    if (!usage) return [];
    const numericId = typeof message.messageId === 'number' ? message.messageId : undefined;
    const timestamp = parseTs(message.timestamp)
      ?? new Date(fallbackTs.getTime() + Math.max(numericId ?? index, 0) * 1_000);
    return [{
      model: usage.model ?? message.model ?? 'unknown',
      timestamp,
      hasExplicitTimestamp: Boolean(parseTs(message.timestamp)),
      messageId: normalizeId(message.messageId ?? key),
      tokens: {
        input: clamp(usage.inputTokens),
        output: clamp(usage.outputTokens),
        cached: clamp(usage.cacheReadInputTokens),
        cacheWrite: clamp(usage.cacheCreationInputTokens),
        reasoning: 0,
      },
    }];
  });
}

function reconcileAmpRecords(ledger: AmpRecord[], messages: AmpRecord[]): AmpRecord[] {
  if (ledger.length === 0) return messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const consumed = new Set<number>();
  const merged = [...ledger];
  const unmatched: AmpRecord[] = [];

  for (const message of messages) {
    const index = findLedgerMatch(merged, consumed, message);
    if (index < 0) {
      unmatched.push(message);
      continue;
    }
    consumed.add(index);
    const item = merged[index]!;
    merged[index] = {
      ...item,
      model: item.model === 'unknown' ? message.model : item.model,
      timestamp: item.hasExplicitTimestamp ? item.timestamp : message.timestamp,
      messageId: message.messageId,
      tokens: {
        input: item.tokens.input || message.tokens.input,
        output: item.tokens.output || message.tokens.output,
        cached: item.tokens.cached || message.tokens.cached,
        cacheWrite: item.tokens.cacheWrite || message.tokens.cacheWrite,
        reasoning: 0,
      },
    };
  }

  return [...merged, ...unmatched].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function findLedgerMatch(ledger: AmpRecord[], consumed: Set<number>, message: AmpRecord): number {
  if (message.messageId) {
    const byId = ledger.findIndex((record, index) =>
      !consumed.has(index) && record.ledgerToMessageId === message.messageId,
    );
    if (byId >= 0) return byId;
  }
  return ledger.findIndex((record, index) =>
    !consumed.has(index)
      && record.model === message.model
      && tokenFingerprint(record.tokens) === tokenFingerprint(message.tokens),
  );
}

function tokenFingerprint(tokens: AmpTokens): string {
  return [tokens.input, tokens.cached, tokens.cacheWrite, tokens.output, tokens.reasoning].join(':');
}

function normalizeId(value: AmpId | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  return String(value);
}

function clamp(value: number | undefined): number {
  return Math.max(Number.isFinite(value) ? value! : 0, 0);
}
