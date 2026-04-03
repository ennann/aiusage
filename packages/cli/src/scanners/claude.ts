import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import { normalizeModelName } from './utils.js';

interface ClaudeRecord {
  timestamp?: string;
  requestId?: string;
  uuid?: string;
  type?: string;
  cwd?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
  };
}

interface DeduplicatedUsage {
  model: string;
  project: string;
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export async function scanClaude(
  targetDate: string,
  claudeDir?: string,
  projectAliases?: Record<string, string>,
): Promise<IngestBreakdown[]> {
  const groupedByDate = await scanClaudeDates([targetDate], claudeDir, projectAliases);
  return groupedByDate.get(targetDate) ?? [];
}

export async function scanClaudeDates(
  targetDates: string[],
  claudeDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const targetDateSet = new Set(targetDates);
  const groupedByDate = new Map<string, Map<string, IngestBreakdown>>();
  for (const targetDate of targetDateSet) groupedByDate.set(targetDate, new Map());

  const baseDir = claudeDir ?? join(homedir(), '.claude', 'projects');

  let projectDirs: string[];
  try {
    projectDirs = await readdir(baseDir);
  } catch {
    return new Map([...targetDateSet].map((targetDate) => [targetDate, []]));
  }

  const deduped = new Map<string, DeduplicatedUsage>();

  for (const projDir of projectDirs) {
    const projectPath = join(baseDir, projDir);
    const project = resolveProject(projectPath, projectAliases);
    const dirPath = join(baseDir, projDir);

    const jsonlFiles: string[] = [];
    try {
      await walkForJsonl(dirPath, jsonlFiles);
    } catch {
      continue;
    }

    for (const filePath of jsonlFiles) {
      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let record: ClaudeRecord;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }

        const ts = parseTimestamp(record.timestamp);
        if (!ts) continue;
        const usageDate = toDateKey(ts);
        if (!targetDateSet.has(usageDate)) continue;

        const message = record.message;
        if (!message?.usage) continue;

        const requestId = record.requestId ?? message.id ?? record.uuid;
        if (!requestId) continue;

        const usage = message.usage;
        const model = normalizeModelName(message.model ?? 'unknown');
        const recordProject = record.cwd ? resolveProject(record.cwd, projectAliases) : project;

        const cacheCreation = usage.cache_creation;
        let cache5m = cacheCreation?.ephemeral_5m_input_tokens ?? 0;
        const cache1h = cacheCreation?.ephemeral_1h_input_tokens ?? 0;
        // 无明细时退化到总量
        if (cache5m === 0 && cache1h === 0 && (usage.cache_creation_input_tokens ?? 0) > 0) {
          cache5m = usage.cache_creation_input_tokens!;
        }

        const dedupeKey = `${usageDate}|${requestId}`;
        const existing = deduped.get(dedupeKey);
        if (existing) {
          // 分别取 max（流式场景下同一 requestId 可能多次出现）
          existing.model = model;
          existing.inputTokens = Math.max(existing.inputTokens, usage.input_tokens ?? 0);
          existing.cacheWrite5mTokens = Math.max(existing.cacheWrite5mTokens, cache5m);
          existing.cacheWrite1hTokens = Math.max(existing.cacheWrite1hTokens, cache1h);
          existing.cachedInputTokens = Math.max(existing.cachedInputTokens, usage.cache_read_input_tokens ?? 0);
          existing.outputTokens = Math.max(existing.outputTokens, usage.output_tokens ?? 0);
        } else {
          deduped.set(dedupeKey, {
            model,
            project: recordProject,
            inputTokens: usage.input_tokens ?? 0,
            cacheWrite5mTokens: cache5m,
            cacheWrite1hTokens: cache1h,
            cachedInputTokens: usage.cache_read_input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          });
        }
      }
    }
  }

  // 按 日期 + model + project 聚合
  for (const [dedupeKey, usage] of deduped.entries()) {
    const [usageDate] = dedupeKey.split('|', 1);
    const grouped = groupedByDate.get(usageDate);
    if (!grouped) continue;

    const cacheWriteTokens = usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
    const key = `${usage.model}|${usage.project}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.eventCount += 1;
      existing.inputTokens += usage.inputTokens;
      existing.cachedInputTokens += usage.cachedInputTokens;
      existing.cacheWriteTokens += cacheWriteTokens;
      existing.cacheWrite5mTokens = (existing.cacheWrite5mTokens ?? 0) + usage.cacheWrite5mTokens;
      existing.cacheWrite1hTokens = (existing.cacheWrite1hTokens ?? 0) + usage.cacheWrite1hTokens;
      existing.outputTokens += usage.outputTokens;
    } else {
      grouped.set(key, {
        provider: 'anthropic',
        product: 'claude-code',
        channel: 'cli',
        model: usage.model,
        project: usage.project,
        eventCount: 1,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens,
        cacheWrite5mTokens: usage.cacheWrite5mTokens,
        cacheWrite1hTokens: usage.cacheWrite1hTokens,
        outputTokens: usage.outputTokens,
        reasoningOutputTokens: 0,
      });
    }
  }

  return new Map(
    [...groupedByDate.entries()].map(([usageDate, grouped]) => [usageDate, [...grouped.values()]]),
  );
}

function parseTimestamp(value?: string): Date | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractProjectName(dirName: string): string {
  // 目录名格式: -Users-Ethan-Projects-AIUsage → AIUsage
  const parts = dirName.split('-').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

function extractProjectFromCwd(cwd: string): string {
  // /Users/Ethan/Projects/AIUsage → AIUsage
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

function resolveProject(rawPath: string, aliases?: Record<string, string>): string {
  const project = extractProjectFromCwd(rawPath);
  return aliases?.[rawPath] ?? aliases?.[project] ?? project;
}

async function walkForJsonl(dir: string, result: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForJsonl(fullPath, result);
    } else if (entry.name.endsWith('.jsonl')) {
      result.push(fullPath);
    }
  }
}
