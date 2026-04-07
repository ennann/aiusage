import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
} from './utils.js';

/**
 * Amp (by Sourcegraph) scanner.
 *
 * 数据目录: ~/.local/share/amp/threads/ (亦检查 $AMP_DATA_DIR / $XDG_DATA_HOME)
 * 文件格式: T-*.json (完整 JSON，非 JSONL)
 *
 * 优先从 thread.usageLedger.events 提取用量;
 * 无 ledger 时回退到 thread.messages[].usage。
 */

interface AmpMessage {
  timestamp?: string | number;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

interface AmpLedgerEvent {
  timestamp?: string | number;
  model?: string;
  tokens?: {
    input?: number;
    output?: number;
  };
  toMessageId?: string;
}

interface AmpThread {
  created?: string | number;
  messages?: Record<string, AmpMessage> | AmpMessage[];
  usageLedger?: {
    events?: AmpLedgerEvent[];
  };
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
  const dir = resolveAmpDir(baseDir);

  const files = await walkFiles(dir, '.json');
  const threadFiles = files.filter((f) => {
    const name = f.split('/').pop() ?? '';
    return name.startsWith('T-') && name.endsWith('.json');
  });
  if (threadFiles.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of threadFiles) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let thread: AmpThread;
    try {
      thread = JSON.parse(raw);
    } catch {
      continue;
    }

    const ledgerEvents = thread.usageLedger?.events;
    const useLedger = Array.isArray(ledgerEvents) && ledgerEvents.length > 0;

    if (useLedger) {
      processLedger(thread, ledgerEvents!, dates, grouped);
    } else {
      processMessages(thread, dates, grouped);
    }
  }

  return finalize(grouped);
}

function getMessageByKey(
  messages: Record<string, AmpMessage> | AmpMessage[] | undefined,
  key: string,
): AmpMessage | undefined {
  if (!messages) return undefined;
  if (Array.isArray(messages)) {
    const idx = parseInt(key, 10);
    return isNaN(idx) ? undefined : messages[idx];
  }
  return messages[key];
}

function processLedger(
  thread: AmpThread,
  events: AmpLedgerEvent[],
  dates: Set<string>,
  grouped: ReturnType<typeof initDateMap>,
): void {
  for (const event of events) {
    const ts = parseTs(event.timestamp);
    if (!ts) continue;
    const dk = dateKey(ts);
    const dayMap = grouped.get(dk);
    if (!dayMap) continue;

    const model = event.model ?? 'unknown';
    const input = event.tokens?.input ?? 0;
    const output = event.tokens?.output ?? 0;

    let cached = 0;
    if (event.toMessageId) {
      const msg = getMessageByKey(thread.messages, event.toMessageId);
      cached = msg?.usage?.cacheReadInputTokens ?? 0;
    }

    accumulate(
      dayMap,
      `${model}|unknown`,
      {
        provider: 'sourcegraph',
        product: 'amp',
        channel: 'cli',
        model,
        project: 'unknown',
        projectDisplay: 'unknown',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input, cached, cacheWrite: 0, output, reasoning: 0 },
    );
  }
}

function processMessages(
  thread: AmpThread,
  dates: Set<string>,
  grouped: ReturnType<typeof initDateMap>,
): void {
  const msgs = thread.messages;
  if (!msgs) return;

  const entries: AmpMessage[] = Array.isArray(msgs) ? msgs : Object.values(msgs);

  for (const msg of entries) {
    const usage = msg.usage;
    if (!usage) continue;

    const ts = parseTs(msg.timestamp ?? thread.created);
    if (!ts) continue;
    const dk = dateKey(ts);
    const dayMap = grouped.get(dk);
    if (!dayMap) continue;

    const model = msg.model ?? 'unknown';
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cached = usage.cacheReadInputTokens ?? 0;

    accumulate(
      dayMap,
      `${model}|unknown`,
      {
        provider: 'sourcegraph',
        product: 'amp',
        channel: 'cli',
        model,
        project: 'unknown',
        projectDisplay: 'unknown',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input, cached, cacheWrite: 0, output, reasoning: 0 },
    );
  }
}
