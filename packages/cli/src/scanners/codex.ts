import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import { normalizeModelName } from './utils.js';

interface CodexRecord {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: string;
    cwd?: string;
    info?: {
      last_token_usage?: TokenUsage;
      total_token_usage?: TokenUsage;
    };
  };
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export async function scanCodex(
  targetDate: string,
  codexDir?: string,
  projectAliases?: Record<string, string>,
): Promise<IngestBreakdown[]> {
  const groupedByDate = await scanCodexDates([targetDate], codexDir, projectAliases);
  return groupedByDate.get(targetDate) ?? [];
}

export async function scanCodexDates(
  targetDates: string[],
  codexDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const targetDateSet = new Set(targetDates);
  const groupedByDate = new Map<string, Map<string, IngestBreakdown>>();
  for (const targetDate of targetDateSet) groupedByDate.set(targetDate, new Map());

  const baseDir = codexDir ?? join(homedir(), '.codex');

  const sessionFiles = await collectSessionFiles(baseDir);
  if (sessionFiles.length === 0) {
    return new Map([...targetDateSet].map((targetDate) => [targetDate, []]));
  }

  for (const filePath of sessionFiles) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    let currentModel = 'unknown';
    let currentProject = 'unknown';
    let lastTotalSignature = '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let record: CodexRecord;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type === 'turn_context') {
        currentModel = normalizeModelName(record.payload?.model ?? currentModel);
        if (record.payload?.cwd) {
          currentProject = extractProject(record.payload.cwd, projectAliases);
        }
        continue;
      }

      if (record.type !== 'event_msg') continue;
      if (record.payload?.type !== 'token_count') continue;

      const info = record.payload?.info;
      if (!info?.last_token_usage || !info?.total_token_usage) continue;

      const ts = parseTimestamp(record.timestamp);
      if (!ts) continue;
      const usageDate = toDateKey(ts);
      if (!targetDateSet.has(usageDate)) continue;

      // 按 total_token_usage 签名去重
      const total = info.total_token_usage;
      const signature = `${total.input_tokens ?? 0}|${total.cached_input_tokens ?? 0}|${total.output_tokens ?? 0}|${total.reasoning_output_tokens ?? 0}|${total.total_tokens ?? 0}`;
      if (signature === lastTotalSignature) continue;
      lastTotalSignature = signature;

      const last = info.last_token_usage;
      const grouped = groupedByDate.get(usageDate);
      if (!grouped) continue;
      const key = `${currentModel}|${currentProject}`;

      const existing = grouped.get(key);
      if (existing) {
        existing.eventCount += 1;
        existing.inputTokens += last.input_tokens ?? 0;
        existing.cachedInputTokens += last.cached_input_tokens ?? 0;
        existing.outputTokens += last.output_tokens ?? 0;
        existing.reasoningOutputTokens += last.reasoning_output_tokens ?? 0;
      } else {
        grouped.set(key, {
          provider: 'openai',
          product: 'codex',
          channel: 'cli',
          model: currentModel,
          project: currentProject,
          eventCount: 1,
          inputTokens: last.input_tokens ?? 0,
          cachedInputTokens: last.cached_input_tokens ?? 0,
          cacheWriteTokens: 0,
          outputTokens: last.output_tokens ?? 0,
          reasoningOutputTokens: last.reasoning_output_tokens ?? 0,
        });
      }
    }
  }

  return new Map(
    [...groupedByDate.entries()].map(([usageDate, grouped]) => [usageDate, [...grouped.values()]]),
  );
}

async function collectSessionFiles(baseDir: string): Promise<string[]> {
  const paths: string[] = [];

  // archived_sessions/*.jsonl
  const archivedDir = join(baseDir, 'archived_sessions');
  try {
    const files = await readdir(archivedDir);
    for (const f of files) {
      if (f.endsWith('.jsonl')) paths.push(join(archivedDir, f));
    }
  } catch { /* ignore */ }

  // sessions/**/*.jsonl (递归)
  const sessionsDir = join(baseDir, 'sessions');
  await walkDir(sessionsDir, paths);

  return paths;
}

async function walkDir(dir: string, result: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, result);
    } else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      result.push(fullPath);
    }
  }
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

function extractProject(cwd: string, aliases?: Record<string, string>): string {
  const parts = cwd.split('/').filter(Boolean);
  const project = parts[parts.length - 1] || 'unknown';
  return aliases?.[cwd] ?? aliases?.[project] ?? project;
}
