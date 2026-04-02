import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
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
 * OpenClaw scanner.
 *
 * 数据目录: ~/.openclaw/agents/ (亦检查遗留目录 ~/.clawdbot, ~/.moltbot, ~/.moldbot)
 * 文件结构: agents/{agentId}/sessions/*.jsonl
 *
 * 仅处理 type === 'message' && message.role === 'assistant' 的行。
 * Token 字段有多种命名方式，须逐一兼容。
 */

interface OpenClawUsage {
  input?: number;
  inputTokens?: number;
  input_tokens?: number;
  promptTokens?: number;
  prompt_tokens?: number;
  output?: number;
  outputTokens?: number;
  output_tokens?: number;
  completionTokens?: number;
  completion_tokens?: number;
  cacheRead?: number;
  cache_read?: number;
  cache_read_input_tokens?: number;
}

interface OpenClawMessage {
  role?: string;
  model?: string;
  timestamp?: string | number;
  usage?: OpenClawUsage;
}

interface OpenClawLine {
  type?: string;
  model?: string;
  timestamp?: string | number;
  message?: OpenClawMessage;
}

function resolveInput(u: OpenClawUsage): number {
  return u.input ?? u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens ?? 0;
}

function resolveOutput(u: OpenClawUsage): number {
  return u.output ?? u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens ?? 0;
}

function resolveCached(u: OpenClawUsage): number {
  return u.cacheRead ?? u.cache_read ?? u.cache_read_input_tokens ?? 0;
}

function agentNameFromPath(filePath: string): string {
  // .../agents/{agentId}/sessions/xxx.jsonl → agentId
  const sessionsDir = dirname(filePath);
  const agentDir = dirname(sessionsDir);
  return basename(agentDir) || 'unknown';
}

function collectBaseDirs(baseDir?: string): string[] {
  if (baseDir) return [baseDir];
  const home = homedir();
  return [
    `${home}/.openclaw/agents`,
    `${home}/.clawdbot`,
    `${home}/.moltbot`,
    `${home}/.moldbot`,
  ];
}

export async function scanOpenclawDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dirs = collectBaseDirs(baseDir);

  let allFiles: string[] = [];
  for (const d of dirs) {
    const found = await walkFiles(d, '.jsonl');
    allFiles = allFiles.concat(found);
  }
  if (allFiles.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const agentName = agentNameFromPath(filePath);
    const project = projectAliases?.[agentName] ?? agentName;

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;

      let obj: OpenClawLine;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      if (obj.type !== 'message') continue;
      const msg = obj.message;
      if (!msg || msg.role !== 'assistant') continue;

      const usage = msg.usage;
      if (!usage) continue;

      const ts = parseTs(obj.timestamp ?? msg.timestamp);
      if (!ts) continue;
      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      const model = msg.model ?? obj.model ?? 'unknown';
      const input = resolveInput(usage);
      const output = resolveOutput(usage);
      const cached = resolveCached(usage);

      accumulate(
        dayMap,
        `${model}|${project}`,
        {
          provider: 'openclaw',
          product: 'openclaw',
          channel: 'cli',
          model,
          project,
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
