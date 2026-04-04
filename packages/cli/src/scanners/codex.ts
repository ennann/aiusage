import { readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import type { IngestBreakdown } from '@aiusage/shared';
import { normalizeModelName, runWithConcurrency } from './utils.js';

const FILE_CONCURRENCY = 16;
const MAX_LINE_BYTES = 64 * 1024 * 1024; // 64 MB

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

  // 并发流式处理文件
  await runWithConcurrency(sessionFiles, FILE_CONCURRENCY, async (filePath) => {
    await processCodexFile(filePath, targetDateSet, projectAliases, groupedByDate);
  });

  return new Map(
    [...groupedByDate.entries()].map(([usageDate, grouped]) => [usageDate, [...grouped.values()]]),
  );
}

/** 流式逐行读取单个 Codex JSONL 文件 */
async function processCodexFile(
  filePath: string,
  targetDateSet: Set<string>,
  projectAliases: Record<string, string> | undefined,
  groupedByDate: Map<string, Map<string, IngestBreakdown>>,
): Promise<void> {
  let fh;
  try {
    fh = await open(filePath, 'r');
  } catch {
    return;
  }

  try {
    const rl = createInterface({
      input: fh.createReadStream({ encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let currentModel = 'unknown';
    let currentProject = 'unknown';
    let lastTotalSignature = '';

    for await (const line of rl) {
      if (!line) continue;

      // 大行保护
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) continue;

      let record: CodexRecord;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type === 'turn_context') {
        const rawModel = record.payload?.model ?? currentModel;
        // 过滤合成消息
        if (rawModel !== '<synthetic>') {
          currentModel = normalizeModelName(rawModel);
        }
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
  } finally {
    await fh.close();
  }
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
