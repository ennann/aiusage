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
 * Kimi Code scanner.
 *
 * 日志目录: ~/.kimi/sessions/{workDirHash}/{sessionId}/wire.jsonl
 * - 任何含 payload.model 的行更新 currentModel
 * - type === 'StatusUpdate' → payload.token_usage 提取 token
 * - 按 payload.message_id 去重
 * - 项目名从 ~/.kimi/kimi.json → workspaces[hash].path 获取
 */

interface KimiLine {
  type?: string;
  timestamp?: string | number;
  payload?: {
    model?: string;
    message_id?: string;
    token_usage?: {
      input_other?: number;
      output?: number;
      input_cache_read?: number;
    };
  };
}

interface KimiConfig {
  workspaces?: Record<string, { path?: string }>;
}

export async function scanKimiDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const kimiHome = baseDir ?? join(homedir(), '.kimi');
  const sessionsDir = join(kimiHome, 'sessions');

  const files = await walkFiles(sessionsDir, '.jsonl');
  if (files.length === 0) return emptyResult(dates);

  // 加载 kimi.json 获取 workspace → path 映射
  const workspaceMap = await loadWorkspaceMap(kimiHome);

  const grouped = initDateMap(dates);
  const seen = new Set<string>();

  for (const filePath of files) {
    // 路径: sessions/{workDirHash}/{sessionId}/wire.jsonl
    const sessionDir = dirname(filePath);
    const hashDir = dirname(sessionDir);
    const workDirHash = basename(hashDir);

    const projectFields = resolveKimiProject(workDirHash, workspaceMap, projectAliases);

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let currentModel = 'unknown';

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let obj: KimiLine;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      // 跟踪最新 model
      if (obj.payload?.model) {
        currentModel = obj.payload.model;
      }

      if (obj.type !== 'StatusUpdate') continue;

      const usage = obj.payload?.token_usage;
      if (!usage) continue;

      const ts = parseTs(obj.timestamp);
      if (!ts) continue;
      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      // message_id 去重
      const msgId = obj.payload?.message_id;
      if (msgId) {
        if (seen.has(msgId)) continue;
        seen.add(msgId);
      }

      const input = usage.input_other ?? 0;
      const cached = usage.input_cache_read ?? 0;
      const output = usage.output ?? 0;

      accumulate(
        dayMap,
        `${currentModel}|${projectFields.project}`,
        {
          provider: 'moonshot',
          product: 'kimi-code',
          channel: 'cli',
          model: currentModel,
          project: projectFields.project,
          projectDisplay: projectFields.projectDisplay,
          projectAlias: projectFields.projectAlias,
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

function resolveKimiProject(
  hash: string,
  workspaceMap: Map<string, string>,
  aliases?: Record<string, string>,
): ProjectFields {
  const wsPath = workspaceMap.get(hash);
  if (wsPath) return resolveProjectFields(wsPath, aliases);
  return resolveProjectFields(hash, aliases);
}

async function loadWorkspaceMap(kimiHome: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const raw = await readFile(join(kimiHome, 'kimi.json'), 'utf-8');
    const config: KimiConfig = JSON.parse(raw);
    if (config.workspaces) {
      for (const [hash, info] of Object.entries(config.workspaces)) {
        if (info.path) map.set(hash, info.path);
      }
    }
  } catch {
    // 配置不存在或解析失败，忽略
  }
  return map;
}
