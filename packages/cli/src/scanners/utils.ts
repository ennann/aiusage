import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IngestBreakdown } from '@aiusage/shared';

export function parseTs(value?: string | number): Date | null {
  if (value == null) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function projectFromPath(raw: string, aliases?: Record<string, string>): string {
  const parts = raw.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || 'unknown';
  return aliases?.[raw] ?? aliases?.[name] ?? name;
}

export async function walkFiles(dir: string, ext: string): Promise<string[]> {
  const result: string[] = [];
  await walk(dir, ext, result);
  return result;
}

async function walk(dir: string, ext: string, out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
}

export type DateGrouped = Map<string, Map<string, IngestBreakdown>>;

export function initDateMap(dates: Set<string>): DateGrouped {
  const m: DateGrouped = new Map();
  for (const d of dates) m.set(d, new Map());
  return m;
}

export function accumulate(
  grouped: Map<string, IngestBreakdown>,
  key: string,
  base: Omit<IngestBreakdown, 'eventCount'>,
  tokens: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number },
): void {
  const existing = grouped.get(key);
  if (existing) {
    existing.eventCount += 1;
    existing.inputTokens += tokens.input;
    existing.cachedInputTokens += tokens.cached;
    existing.cacheWriteTokens += tokens.cacheWrite;
    existing.outputTokens += tokens.output;
    existing.reasoningOutputTokens += tokens.reasoning;
  } else {
    grouped.set(key, {
      ...base,
      eventCount: 1,
      inputTokens: tokens.input,
      cachedInputTokens: tokens.cached,
      cacheWriteTokens: tokens.cacheWrite,
      outputTokens: tokens.output,
      reasoningOutputTokens: tokens.reasoning,
    });
  }
}

export function finalize(groupedByDate: DateGrouped): Map<string, IngestBreakdown[]> {
  return new Map(
    [...groupedByDate.entries()].map(([d, m]) => [d, [...m.values()]]),
  );
}

export function emptyResult(dates: Set<string>): Map<string, IngestBreakdown[]> {
  return new Map([...dates].map(d => [d, []]));
}

// 归一化模型名，去掉日期后缀（如 claude-3-5-sonnet-20241022 → claude-3-5-sonnet）
export function normalizeModelName(name: string): string {
  return name.replace(/-\d{8}$/, '');
}

// Pool-based 并发控制，避免同时打开过多文件句柄
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = nextIndex++;
        if (i >= items.length) return;
        await worker(items[i], i);
      }
    }),
  );
}
