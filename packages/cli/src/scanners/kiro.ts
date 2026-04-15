import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  dateKey,
  parseTs,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
} from './utils.js';

/**
 * Kiro scanner.
 *
 * 数据目录: ~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/*.chat
 */

interface KiroMetadata {
  modelId?: string;
  modelProvider?: string;
  startTime?: string | number;
  endTime?: string | number;
}

interface KiroChatRecord {
  actionId?: string;
  executionId?: string;
  metadata?: KiroMetadata;
  chat?: unknown[];
}

export async function scanKiroDates(
  targetDates: string[],
  baseDir?: string,
  _projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const targetDateSet = new Set(targetDates);
  const dirs = resolveKiroDirs(baseDir);

  const files = (
    await Promise.all(
      dirs.map((dir) => walkFiles(dir, '.chat')),
    )
  ).flat();

  if (files.length === 0) return emptyResult(targetDateSet);

  const groupedByDate = initDateMap(targetDateSet);
  const seenExecutionIds = new Set<string>();

  for (const filePath of files) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let data: KiroChatRecord;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }

    const dedupeKey = resolveExecutionKey(data, filePath);
    if (seenExecutionIds.has(dedupeKey)) continue;
    seenExecutionIds.add(dedupeKey);

    const eventTs = await getEventDate(data, filePath);
    if (!eventTs) continue;
    const usageDate = dateKey(eventTs);
    const dayMap = groupedByDate.get(usageDate);
    if (!dayMap) continue;

    const model = getModelName(data.metadata);
    const project = 'unknown';

    accumulate(
      dayMap,
      `${model}|${project}`,
      {
        provider: 'kiro',
        product: 'kiro',
        channel: 'cli',
        model,
        project,
        projectDisplay: 'unknown',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    );
  }

  return finalize(groupedByDate);
}

function resolveKiroDirs(baseDir?: string): string[] {
  if (baseDir) return [baseDir];

  const envDir = process.env.KIRO_CHAT_DIR?.trim();
  if (envDir) return [envDir];

  return [
    join(
      homedir(),
      'Library',
      'Application Support',
      'Kiro',
      'User',
      'globalStorage',
      'kiro.kiroagent',
    ),
    join(
      homedir(),
      'Library',
      'Application Support',
      'Code',
      'User',
      'globalStorage',
      'kiro.kiroagent',
    ),
  ];
}

async function getEventDate(data: KiroChatRecord, filePath: string): Promise<Date | null> {
  const ts = parseTs(data.metadata?.startTime ?? data.metadata?.endTime);
  if (ts) return ts;
  return readFileMtime(filePath);
}

function getModelName(metadata?: KiroMetadata): string {
  return metadata?.modelId?.trim() || metadata?.modelProvider?.trim() || 'unknown';
}

function resolveExecutionKey(data: KiroChatRecord, filePath: string): string {
  const candidate = data.executionId ?? data.actionId;
  const key = typeof candidate === 'string' ? candidate.trim() : '';
  if (key) return key;
  return `file:${hashPath(filePath)}`;
}

function hashPath(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex');
}

async function readFileMtime(filePath: string): Promise<Date | null> {
  try {
    return (await stat(filePath)).mtime;
  } catch {
    return null;
  }
}
