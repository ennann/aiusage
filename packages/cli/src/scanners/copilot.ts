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
  type ProjectFields,
} from './utils.js';

/**
 * GitHub Copilot CLI scanner.
 *
 * 日志目录: ~/.copilot/session-state/{sessionDir}/events.jsonl
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
          outputTokens?: number;
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
  const dir = baseDir ?? join(homedir(), '.copilot', 'session-state');

  const files = await walkFiles(dir, '.jsonl');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let sessionProjectFields: ProjectFields = { project: 'unknown', projectDisplay: 'unknown' };

    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: CopilotEvent;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

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

        const rawInput = usage.inputTokens ?? 0;
        const cacheRead = usage.cacheReadTokens ?? 0;
        const output = usage.outputTokens ?? 0;
        const input = Math.max(rawInput - cacheRead, 0);

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
          { input, cached: cacheRead, cacheWrite: 0, output, reasoning: 0 },
        );
      }
    }
  }

  return finalize(grouped);
}
