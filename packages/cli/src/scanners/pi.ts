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
  fileModifiedTs,
  inferProviderFromModel,
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
 * 同时兼容 Oh My Pi: ~/.omp/agent/sessions/
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
  name?: string;
  message?: {
    role?: string;
    model?: string;
    provider?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
  };
}

export async function scanPiDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const sessionDirs = baseDir ? [baseDir] : getSessionDirs();
  const files = [...new Set((await Promise.all(sessionDirs.map(dir => walkFiles(dir, '.jsonl')))).flat())];
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
    let sessionId = basename(filePath, '.jsonl');
    let messageIndex = 0;
    const fallbackTs = await fileModifiedTs(filePath);

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
        sessionId = obj.id ?? sessionId;
        sessionProjectFields = resolveProjectFields(obj.cwd, projectAliases);
        continue;
      }
      if (obj.type === 'session') {
        sessionId = obj.id ?? sessionId;
        continue;
      }

      if (obj.type !== 'message') continue;

      const msg = obj.message;
      if (!msg) continue;
      if (msg.role !== 'assistant') continue;

      const usage = msg.usage;
      if (!usage) continue;
      if (usage.input == null && usage.output == null) continue;

      const ts = parseTs(obj.timestamp) ?? fallbackTs;
      if (!ts) continue;
      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      const messageKey = `${sessionId}:${obj.id ?? messageIndex}`;
      messageIndex += 1;
      if (seen.has(messageKey)) continue;
      seen.add(messageKey);

      const model = msg.model ?? 'unknown';
      const provider = msg.provider?.trim() || inferProviderFromModel(model, 'inflection');
      const input = Math.max(usage.input ?? 0, 0);
      const cached = Math.max(usage.cacheRead ?? 0, 0);
      const cacheWrite = Math.max(usage.cacheWrite ?? 0, 0);
      const output = Math.max(usage.output ?? 0, 0);
      if (input + cached + cacheWrite + output === 0) continue;

      accumulate(
        dayMap,
        `${model}|${sessionProjectFields.project}`,
        {
          provider,
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
        { input, cached, cacheWrite, output, reasoning: 0 },
      );
    }
  }

  return finalize(grouped);
}

function getSessionDirs(): string[] {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  const piDir = envDir
    ? join(envDir, 'sessions')
    : join(homedir(), '.pi', 'agent', 'sessions');
  return [piDir, join(homedir(), '.omp', 'agent', 'sessions')];
}

function extractProjectFromEncoded(encoded: string): string {
  const parts = encoded.split('-').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'unknown';
}
