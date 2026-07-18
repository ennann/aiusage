import { readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  resolveProjectFields,
  walkFiles,
  fileModifiedTs,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
} from './utils.js';

/**
 * Qwen Code scanner (Gemini CLI fork).
 *
 * 当前目录: ~/.qwen/projects/{projectId}/chats/*.jsonl
 * 兼容旧目录: ~/.qwen/tmp/{projectId}/chats/*.jsonl
 * 仅解析 assistant usage；优先按 uuid 去重，无 uuid 时使用会话内稳定序号。
 */

interface QwenRecord {
  type?: string;
  timestamp?: string | number;
  uuid?: string;
  sessionId?: string;
  model?: string;
  cwd?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

export async function scanQwenDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dirs = baseDir
    ? [baseDir]
    : [join(homedir(), '.qwen', 'projects'), join(homedir(), '.qwen', 'tmp')];
  const files = [...new Set((await Promise.all(dirs.map(dir => walkFiles(dir, '.jsonl')))).flat())];
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const seen = new Set<string>();

  for (const filePath of files) {
    // 从 projects/{projectId}/chats 或 tmp/{projectId}/chats 提取 projectId。
    const chatsDir = dirname(filePath);
    const projectDir = dirname(chatsDir);
    const projectId = basename(projectDir);
    const pathSessionId = basename(filePath, '.jsonl');
    const fallbackTs = await fileModifiedTs(filePath);
    let assistantIndex = 0;

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let obj: QwenRecord;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      if (obj.type !== 'assistant') continue;

      const u = obj.usageMetadata;
      if (!u) continue;

      const messageKey = obj.uuid ?? `${obj.sessionId ?? pathSessionId}:${assistantIndex}`;
      assistantIndex += 1;
      if (seen.has(messageKey)) continue;
      seen.add(messageKey);

      const ts = parseTs(obj.timestamp) ?? fallbackTs;
      if (!ts) continue;
      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      const model = obj.model ?? 'unknown';
      const fields = obj.cwd
        ? resolveProjectFields(obj.cwd, projectAliases)
        : resolveProjectFields(projectId, projectAliases);

      const cached = Math.max(u.cachedContentTokenCount ?? 0, 0);
      const prompt = Math.max(u.promptTokenCount ?? 0, 0);
      const input = Math.max(prompt - Math.min(cached, prompt), 0);
      const thoughts = Math.max(u.thoughtsTokenCount ?? 0, 0);
      // candidatesTokenCount 与 thoughtsTokenCount 是并列字段，不互相包含。
      const output = Math.max(u.candidatesTokenCount ?? 0, 0);
      if (input + cached + output + thoughts === 0) continue;

      accumulate(
        dayMap,
        `${model}|${fields.project}`,
        {
          provider: 'alibaba',
          product: 'qwen-code',
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
        { input, cached, cacheWrite: 0, output, reasoning: thoughts },
      );
    }
  }

  return finalize(grouped);
}
