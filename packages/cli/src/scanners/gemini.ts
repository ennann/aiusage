import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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
  normalizeModelName,
} from './utils.js';

/**
 * Gemini CLI scanner.
 *
 * 日志目录: ~/.gemini/tmp/{projectId}/chats/session-*.json
 * 每个 JSON 文件包含 data.messages[] 或 data.history[]
 * 两种 token 格式: msg.tokens / msg.usage(usageMetadata)
 */

interface GeminiTokens {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface GeminiMessage {
  model?: string;
  timestamp?: string | number;
  createTime?: string | number;
  tokens?: GeminiTokens;
  usage?: GeminiUsageMetadata;
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiSession {
  model?: string;
  createTime?: string | number;
  data?: {
    model?: string;
    createTime?: string | number;
    messages?: GeminiMessage[];
    history?: GeminiMessage[];
  };
}

export async function scanGeminiDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? join(homedir(), '.gemini', 'tmp');

  const files = await walkFiles(dir, '.json');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let session: GeminiSession;
    try {
      session = JSON.parse(content);
    } catch {
      continue;
    }

    const messages = session.messages ?? session.history ?? session.data?.messages ?? session.data?.history ?? [];
    const fallbackModel = session.model ?? session.data?.model ?? 'unknown';
    const fallbackTs = session.createTime ?? session.startTime ?? session.data?.createTime;

    for (const msg of messages) {
      const tokens = extractTokens(msg);
      if (!tokens) continue;

      const model = normalizeModelName(msg.model ?? fallbackModel);
      const ts = parseTs(msg.timestamp) ?? parseTs(msg.createTime) ?? parseTs(fallbackTs);
      if (!ts) continue;

      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      accumulate(
        dayMap,
        `${model}|unknown`,
        {
          provider: 'google',
          product: 'gemini-cli',
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
        tokens,
      );
    }
  }

  return finalize(grouped);
}

function extractTokens(
  msg: GeminiMessage,
): { input: number; cached: number; cacheWrite: number; output: number; reasoning: number } | null {
  // 格式 1: msg.tokens
  if (msg.tokens) {
    const t = msg.tokens;
    const cached = t.cached ?? 0;
    const input = Math.max((t.input ?? 0) - cached, 0);
    const thoughts = t.thoughts ?? 0;
    const output = Math.max((t.output ?? 0) - thoughts, 0);
    return { input, cached, cacheWrite: 0, output, reasoning: thoughts };
  }

  // 格式 2: msg.usage 或 msg.usageMetadata
  const u = msg.usage ?? msg.usageMetadata;
  if (u) {
    const cached = u.cachedContentTokenCount ?? 0;
    const input = Math.max((u.promptTokenCount ?? 0) - cached, 0);
    const thoughts = u.thoughtsTokenCount ?? 0;
    const output = Math.max((u.candidatesTokenCount ?? 0) - thoughts, 0);
    return { input, cached, cacheWrite: 0, output, reasoning: thoughts };
  }

  return null;
}
