import { readFile } from 'node:fs/promises';
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
} from './utils.js';

/**
 * Qwen Code scanner (Gemini CLI fork).
 *
 * 日志目录: ~/.qwen/tmp/{projectId}/chats/*.jsonl
 * 行格式: { type, timestamp, uuid, model, cwd, usageMetadata }
 * 仅解析 type === 'assistant'，按 uuid 去重
 */

interface QwenRecord {
  type?: string;
  timestamp?: string | number;
  uuid?: string;
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
  const dir = baseDir ?? join(homedir(), '.qwen', 'tmp');

  const files = await walkFiles(dir, '.jsonl');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const seen = new Set<string>();

  for (const filePath of files) {
    // 从路径提取 projectId: .qwen/tmp/{projectId}/chats/xxx.jsonl
    const chatsDir = dirname(filePath);
    const projectDir = dirname(chatsDir);
    const projectId = basename(projectDir);

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

      const ts = parseTs(obj.timestamp);
      if (!ts) continue;
      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      // uuid 去重
      if (obj.uuid) {
        if (seen.has(obj.uuid)) continue;
        seen.add(obj.uuid);
      }

      const u = obj.usageMetadata;
      if (!u) continue;

      const model = obj.model ?? 'unknown';
      const fields = obj.cwd
        ? resolveProjectFields(obj.cwd, projectAliases)
        : resolveProjectFields(projectId, projectAliases);

      const cached = u.cachedContentTokenCount ?? 0;
      const input = Math.max((u.promptTokenCount ?? 0) - cached, 0);
      const thoughts = u.thoughtsTokenCount ?? 0;
      const output = Math.max((u.candidatesTokenCount ?? 0) - thoughts, 0);

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
