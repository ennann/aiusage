import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
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
 * Droid scanner.
 *
 * 数据目录: ~/.factory/sessions/
 * 文件格式: *.jsonl + 同目录 {sessionId}.settings.json
 *
 * JSONL 仅取首行时间戳确定日期；
 * Token 用量从 settings.json → tokenUsage 提取。
 */

interface DroidSettings {
  model?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    thinkingTokens?: number;
  };
}

interface DroidLine {
  timestamp?: string | number;
}

function extractProjectFromSlug(dirPath: string): string {
  const slug = basename(dirPath);
  const parts = slug.split('-').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

export async function scanDroidDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? join(homedir(), '.factory', 'sessions');

  const files = await walkFiles(dir, '.jsonl');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const jsonlPath of files) {
    // 读 JSONL 首行取日期
    let content: string;
    try {
      content = await readFile(jsonlPath, 'utf-8');
    } catch {
      continue;
    }

    const firstLine = content.split('\n').find((l) => l.trim());
    if (!firstLine) continue;

    let firstObj: DroidLine;
    try {
      firstObj = JSON.parse(firstLine);
    } catch {
      continue;
    }

    const ts = parseTs(firstObj.timestamp);
    if (!ts) continue;
    const dk = dateKey(ts);
    const dayMap = grouped.get(dk);
    if (!dayMap) continue;

    // 构造同目录 settings.json 路径
    const sessionDir = dirname(jsonlPath);
    const jsonlName = basename(jsonlPath, '.jsonl');
    const settingsPath = join(sessionDir, `${jsonlName}.settings.json`);

    let settingsRaw: string;
    try {
      settingsRaw = await readFile(settingsPath, 'utf-8');
    } catch {
      continue;
    }

    let settings: DroidSettings;
    try {
      settings = JSON.parse(settingsRaw);
    } catch {
      continue;
    }

    const usage = settings.tokenUsage;
    if (!usage) continue;

    const rawInput = usage.inputTokens ?? 0;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const rawOutput = usage.outputTokens ?? 0;
    const thinking = usage.thinkingTokens ?? 0;

    const input = Math.max(rawInput - cacheRead, 0);
    const output = Math.max(rawOutput - thinking, 0);

    const model = settings.model ?? 'unknown';
    const rawProject = extractProjectFromSlug(sessionDir);
    const project = projectAliases?.[rawProject] ?? rawProject;

    accumulate(
      dayMap,
      `${model}|${project}`,
      {
        provider: 'droid',
        product: 'droid',
        channel: 'cli',
        model,
        project,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input, cached: cacheRead, cacheWrite: 0, output, reasoning: thinking },
    );
  }

  return finalize(grouped);
}
