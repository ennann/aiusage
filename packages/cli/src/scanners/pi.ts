import { readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  projectFromPath,
  resolveProjectFields,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
  type ProjectFields,
} from './utils.js';

/**
 * Pi Coding Agent scanner.
 *
 * 日志目录: ~/.pi/agent/sessions/{encoded-cwd}/{timestamp}_{sessionId}.jsonl
 * 支持环境变量 PI_CODING_AGENT_DIR 覆盖基础目录
 *
 * JSONL 行格式:
 *   - type "session": 会话头，含 id、cwd
 *   - type "message": 含 message.role、message.usage、message.model
 *
 * assistant 消息的 usage: { input, output, cacheRead, cacheWrite, totalTokens }
 * 按 obj.id 去重
 */

interface PiLine {
  id?: string;
  type?: string;
  timestamp?: string | number;
  cwd?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
    };
  };
}

export async function scanPiDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const sessionsDir = baseDir ?? getSessionsDir();

  const files = await walkFiles(sessionsDir, '.jsonl');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const seen = new Set<string>();

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    // 从路径提取默认 project: sessions/{encoded-cwd}/{file}.jsonl
    const parentDir = dirname(filePath);
    const encodedCwd = basename(parentDir);
    let sessionProjectFields: ProjectFields = { project: extractProjectFromEncoded(encodedCwd), projectDisplay: extractProjectFromEncoded(encodedCwd) };

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let obj: PiLine;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      // session header 提供 cwd
      if (obj.type === 'session' && obj.cwd) {
        sessionProjectFields = resolveProjectFields(obj.cwd, projectAliases);
        continue;
      }

      if (obj.type !== 'message') continue;

      const msg = obj.message;
      if (!msg) continue;
      if (msg.role !== 'assistant') continue;

      const usage = msg.usage;
      if (!usage) continue;
      if (usage.input == null && usage.output == null) continue;

      const ts = parseTs(obj.timestamp);
      if (!ts) continue;
      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      // id 去重
      if (obj.id) {
        if (seen.has(obj.id)) continue;
        seen.add(obj.id);
      }

      const model = msg.model ?? 'unknown';
      const input = usage.input ?? 0;
      const cached = usage.cacheRead ?? 0;
      const output = usage.output ?? 0;

      accumulate(
        dayMap,
        `${model}|${sessionProjectFields.project}`,
        {
          provider: 'inflection',
          product: 'pi',
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
        { input, cached, cacheWrite: 0, output, reasoning: 0 },
      );
    }
  }

  return finalize(grouped);
}

function getSessionsDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) return join(envDir, 'sessions');
  return join(homedir(), '.pi', 'agent', 'sessions');
}

function extractProjectFromEncoded(encoded: string): string {
  const parts = encoded.split('-').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'unknown';
}
