import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
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
 * OpenCode scanner (JSON mode only, skip SQLite).
 *
 * 数据目录: ~/.local/share/opencode/storage/message/ses_* /*.json
 * 每个 JSON 文件一条消息记录。
 */

interface OpenCodeMessage {
  role?: string;
  modelID?: string;
  time?: {
    created?: string | number;
  };
  tokens?: {
    input?: number;
    output?: number;
    cache?: {
      read?: number;
    };
    reasoning?: number;
  };
  path?: {
    root?: string;
  };
}

export async function scanOpencodeDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? `${homedir()}/.local/share/opencode/storage/message`;

  const files = await walkFiles(dir, '.json');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of files) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let msg: OpenCodeMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      continue;
    }

    const tokens = msg.tokens;
    if (!tokens) continue;

    const input = tokens.input ?? 0;
    const output = tokens.output ?? 0;
    if (input === 0 && output === 0) continue;

    const ts = parseTs(msg.time?.created);
    if (!ts) continue;
    const dk = dateKey(ts);
    const dayMap = grouped.get(dk);
    if (!dayMap) continue;

    const model = msg.modelID ?? 'unknown';
    const cached = tokens.cache?.read ?? 0;
    const reasoning = tokens.reasoning ?? 0;

    const rootPath = msg.path?.root;
    const fields = rootPath
      ? resolveProjectFields(rootPath, projectAliases)
      : { project: 'unknown', projectDisplay: 'unknown' };

    accumulate(
      dayMap,
      `${model}|${fields.project}`,
      {
        provider: 'opencode',
        product: 'opencode',
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
      { input, cached, cacheWrite: 0, output, reasoning },
    );
  }

  return finalize(grouped);
}
