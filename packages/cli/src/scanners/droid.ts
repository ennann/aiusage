import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
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
 * Droid scanner.
 *
 * 数据目录: ~/.factory/sessions/
 * 文件格式: {sessionId}.settings.json（JSONL transcript 仅用于缺失模型时兜底）
 * 直接扫描 settings，避免 transcript 缺失或损坏时丢掉已落盘的 token 汇总。
 */

interface DroidSettings {
  model?: string;
  providerLock?: string;
  providerLockTimestamp?: string | number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    thinkingTokens?: number;
  };
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

  const files = await walkFiles(dir, '.settings.json');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const settingsPath of files) {
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

    const input = Math.max(usage.inputTokens ?? 0, 0);
    const cacheRead = Math.max(usage.cacheReadTokens ?? 0, 0);
    const cacheWrite = Math.max(usage.cacheCreationTokens ?? 0, 0);
    const output = Math.max(usage.outputTokens ?? 0, 0);
    const thinking = Math.max(usage.thinkingTokens ?? 0, 0);
    if (input + cacheRead + cacheWrite + output + thinking === 0) continue;

    const sessionDir = dirname(settingsPath);
    const transcriptPath = settingsPath.replace(/\.settings\.json$/, '.jsonl');
    const transcriptModel = settings.model ? undefined : await extractModelFromTranscript(transcriptPath);
    const model = normalizeDroidModel(settings.model ?? transcriptModel ?? `${settings.providerLock ?? 'droid'}-unknown`);
    const provider = settings.providerLock?.trim().toLowerCase()
      || inferProviderFromModel(model, 'droid');
    const ts = parseTs(settings.providerLockTimestamp) ?? await fileModifiedTs(settingsPath);
    if (!ts) continue;
    const dk = dateKey(ts);
    const dayMap = grouped.get(dk);
    if (!dayMap) continue;

    const rawProject = extractProjectFromSlug(sessionDir);
    const alias = projectAliases?.[rawProject];
    const project = alias ?? rawProject;

    accumulate(
      dayMap,
      `${model}|${project}`,
      {
        provider,
        product: 'droid',
        channel: 'cli',
        model,
        project,
        projectDisplay: rawProject,
        projectAlias: alias,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input, cached: cacheRead, cacheWrite, output, reasoning: thinking },
    );
  }

  return finalize(grouped);
}

export function normalizeDroidModel(model: string): string {
  return model
    .replace(/^custom:/i, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\./g, '-')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-+$/, '')
    .toLowerCase();
}

async function extractModelFromTranscript(filePath: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
  const match = content.match(/Model:\s*([^\\\["\n]+)/i);
  return match?.[1]?.trim() || undefined;
}
