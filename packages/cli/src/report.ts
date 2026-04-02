import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IngestBreakdown } from '@aiusage/shared';
import { scanDates } from './scan.js';

export type ReportRange = '7d' | '1m' | '3m' | 'all';

interface Totals {
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface DailySummary extends Totals {
  usageDate: string;
}

interface SourceSummary extends Totals {
  source: string;
}

interface ModelSummary extends Totals {
  source: string;
  model: string;
}

export interface LocalReport {
  range: ReportRange;
  rangeLabel: string;
  startDate?: string;
  endDate?: string;
  requestedDays: number;
  daysWithData: number;
  totals: Totals;
  daily: DailySummary[];
  bySource: SourceSummary[];
  byModel: ModelSummary[];
  pricingWarnings: string[];
}

interface BuildReportOptions {
  projectAliases?: Record<string, string>;
}

export async function buildLocalReport(
  range: ReportRange,
  options: BuildReportOptions = {},
): Promise<LocalReport> {
  const requestedDates = range === 'all'
    ? await discoverAllDates()
    : buildPresetDates(range);

  const daily: DailySummary[] = [];
  const totals = createEmptyTotals();
  const bySource = new Map<string, Totals>();
  const byModel = new Map<string, Totals>();
  const pricingWarnings = new Set<string>();
  let daysWithData = 0;

  const results = await scanDates(requestedDates, { projectAliases: options.projectAliases });

  for (const result of results) {
    const usageDate = result.usageDate;
    const dayTotals = withTotalTokens(result.totals);
    const hasData = dayTotals.totalTokens > 0;

    if (hasData) {
      daysWithData += 1;

      for (const breakdown of result.breakdowns) {
        const breakdownTotals = toBreakdownTotals(breakdown, pricingWarnings);
        dayTotals.estimatedCostUsd += breakdownTotals.estimatedCostUsd;
        mergeTotals(totals, breakdownTotals);
        mergeTotals(getOrCreate(bySource, `${breakdown.provider}/${breakdown.product}`), breakdownTotals);
        mergeTotals(
          getOrCreate(byModel, `${breakdown.provider}/${breakdown.product}|${breakdown.model}`),
          breakdownTotals,
        );
      }
    }

    if (range !== 'all' || hasData) {
      daily.push({ usageDate, ...dayTotals });
    }
  }

  const sortedDates = requestedDates.slice().sort();
  return {
    range,
    rangeLabel: getRangeLabel(range),
    startDate: sortedDates[0],
    endDate: sortedDates[sortedDates.length - 1],
    requestedDays: requestedDates.length,
    daysWithData,
    totals,
    daily,
    bySource: [...bySource.entries()]
      .map(([source, summary]) => ({ source, ...summary }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalTokens - a.totalTokens),
    byModel: [...byModel.entries()]
      .map(([key, summary]) => {
        const [source, model] = key.split('|');
        return { source, model, ...summary };
      })
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalTokens - a.totalTokens),
    pricingWarnings: [...pricingWarnings].sort(),
  };
}

export function renderLocalReport(report: LocalReport): string {
  const lines: string[] = [];

  lines.push('📊 AIUsage 本地统计');
  lines.push(`范围       ${report.rangeLabel}`);
  lines.push(`时间       ${report.startDate ?? '-'} ~ ${report.endDate ?? '-'}`);
  lines.push(`请求天数   ${fmtInt(report.requestedDays)}`);
  lines.push(`有效天数   ${fmtInt(report.daysWithData)}`);
  lines.push('');

  if (report.requestedDays === 0 || report.daysWithData === 0) {
    lines.push('该范围暂无本地 token 数据。');
    return lines.join('\n');
  }

  lines.push('Summary');
  lines.push(renderTable(
    ['Metric', 'Value'],
    [
      ['Events', fmtInt(report.totals.eventCount)],
      ['Input', fmtToken(report.totals.inputTokens)],
      ['CacheRead', fmtToken(report.totals.cachedInputTokens)],
      ['CacheWrite', fmtToken(report.totals.cacheWriteTokens)],
      ['Output', fmtToken(report.totals.outputTokens)],
      ['Reasoning', fmtToken(report.totals.reasoningOutputTokens)],
      ['TotalTokens', fmtToken(report.totals.totalTokens)],
      ['CostUsd', fmtUsd(report.totals.estimatedCostUsd)],
    ],
    ['left', 'right'],
  ));

  lines.push('');
  lines.push('By Source');
  lines.push(renderTable(
    ['Source', 'Events', 'Input', 'CacheRead', 'CacheWrite', 'Output', 'Reasoning', 'Total', 'Cost'],
    report.bySource.map((item) => [
      item.source,
      fmtInt(item.eventCount),
      fmtToken(item.inputTokens),
      fmtToken(item.cachedInputTokens),
      fmtToken(item.cacheWriteTokens),
      fmtToken(item.outputTokens),
      fmtToken(item.reasoningOutputTokens),
      fmtToken(item.totalTokens),
      fmtUsd(item.estimatedCostUsd),
    ]),
    ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
  ));

  lines.push('');
  lines.push('By Day');
  lines.push(renderTable(
    ['Date', 'Events', 'Input', 'CacheRead', 'CacheWrite', 'Output', 'Reasoning', 'Total', 'Cost'],
    report.daily.map((item) => [
      item.usageDate,
      fmtInt(item.eventCount),
      fmtToken(item.inputTokens),
      fmtToken(item.cachedInputTokens),
      fmtToken(item.cacheWriteTokens),
      fmtToken(item.outputTokens),
      fmtToken(item.reasoningOutputTokens),
      fmtToken(item.totalTokens),
      fmtUsd(item.estimatedCostUsd),
    ]),
    ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
  ));

  lines.push('');
  lines.push('Top Models');
  lines.push(renderTable(
    ['Model', 'Source', 'Events', 'Total', 'Input', 'Output', 'Cost'],
    report.byModel.slice(0, 12).map((item) => [
      item.model,
      item.source,
      fmtInt(item.eventCount),
      fmtToken(item.totalTokens),
      fmtToken(item.inputTokens),
      fmtToken(item.outputTokens),
      fmtUsd(item.estimatedCostUsd),
    ]),
    ['left', 'left', 'right', 'right', 'right', 'right', 'right'],
  ));

  if (report.pricingWarnings.length > 0) {
    lines.push('');
    lines.push('Pricing Notes');
    for (const warning of report.pricingWarnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n');
}

export function parseReportRange(value: string | boolean | undefined): ReportRange {
  if (value === undefined || value === true) return '7d';
  if (value === '7d' || value === '1m' || value === '3m' || value === 'all') return value;
  throw new Error('--range 仅支持 7d、1m、3m、all');
}

function getRangeLabel(range: ReportRange): string {
  switch (range) {
    case '7d':
      return '最近 7 天';
    case '1m':
      return '最近 30 天';
    case '3m':
      return '最近 90 天';
    case 'all':
      return '全部历史';
  }
}

function buildPresetDates(range: Exclude<ReportRange, 'all'>): string[] {
  const days = range === '7d' ? 7 : range === '1m' ? 30 : 90;
  const today = getTodayLocalDate();
  const result: string[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    result.push(toDateKey(day));
  }

  return result;
}

async function discoverAllDates(): Promise<string[]> {
  const dates = new Set<string>();
  await Promise.all([discoverClaudeDates(dates), discoverCodexDates(dates)]);
  return [...dates].sort();
}

async function discoverClaudeDates(dates: Set<string>): Promise<void> {
  const baseDir = join(homedir(), '.claude', 'projects');

  let projectDirs: string[];
  try {
    projectDirs = await readdir(baseDir);
  } catch {
    return;
  }

  for (const projectDir of projectDirs) {
    const jsonlFiles: string[] = [];
    try {
      await walkForClaudeJsonl(join(baseDir, projectDir), jsonlFiles);
    } catch {
      continue;
    }

    for (const filePath of jsonlFiles) {
      const content = await safeReadUtf8(filePath);
      if (!content) continue;

      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let record: { timestamp?: string };
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        const ts = parseTimestamp(record.timestamp);
        if (ts) dates.add(toDateKey(ts));
      }
    }
  }
}

async function discoverCodexDates(dates: Set<string>): Promise<void> {
  const baseDir = join(homedir(), '.codex');
  const files = await collectCodexSessionFiles(baseDir);

  for (const filePath of files) {
    const content = await safeReadUtf8(filePath);
    if (!content) continue;

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let record: { type?: string; timestamp?: string; payload?: { type?: string } };
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type !== 'event_msg' || record.payload?.type !== 'token_count') continue;
      const ts = parseTimestamp(record.timestamp);
      if (ts) dates.add(toDateKey(ts));
    }
  }
}

async function collectCodexSessionFiles(baseDir: string): Promise<string[]> {
  const paths: string[] = [];

  try {
    const archivedFiles = await readdir(join(baseDir, 'archived_sessions'));
    for (const file of archivedFiles) {
      if (file.endsWith('.jsonl')) paths.push(join(baseDir, 'archived_sessions', file));
    }
  } catch {
    // ignore
  }

  await walkForCodexJsonl(join(baseDir, 'sessions'), paths);
  return paths;
}

async function walkForClaudeJsonl(dir: string, result: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForClaudeJsonl(fullPath, result);
    } else if (entry.name.endsWith('.jsonl')) {
      result.push(fullPath);
    }
  }
}

async function walkForCodexJsonl(dir: string, result: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForCodexJsonl(fullPath, result);
    } else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      result.push(fullPath);
    }
  }
}

async function safeReadUtf8(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function parseTimestamp(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getTodayLocalDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getOrCreate(map: Map<string, Totals>, key: string): Totals {
  const existing = map.get(key);
  if (existing) return existing;
  const next = createEmptyTotals();
  map.set(key, next);
  return next;
}

function withTotalTokens(totals: Omit<Totals, 'totalTokens' | 'estimatedCostUsd'>): Totals {
  return {
    ...totals,
    totalTokens:
      totals.inputTokens +
      totals.cachedInputTokens +
      totals.cacheWriteTokens +
      totals.outputTokens +
      totals.reasoningOutputTokens,
    estimatedCostUsd: 0,
  };
}

function createEmptyTotals(): Totals {
  return {
    eventCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
}

function mergeTotals(target: Totals, source: Totals): Totals {
  target.eventCount += source.eventCount;
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.totalTokens += source.totalTokens;
  target.estimatedCostUsd += source.estimatedCostUsd;
  return target;
}

function fmtInt(value: number): string {
  return value.toLocaleString('en-US');
}

function fmtToken(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return fmtInt(value);
  if (abs < 1_000_000) return formatCompact(value / 1_000, 'K');
  if (abs < 1_000_000_000) return formatCompact(value / 1_000_000, 'M');
  return formatCompact(value / 1_000_000_000, 'B');
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatCompact(value: number, suffix: 'K' | 'M' | 'B'): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : 2;
  const text = value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  return `${text}${suffix}`;
}

function renderTable(
  headers: string[],
  rows: string[][],
  aligns: Array<'left' | 'right'>,
): string {
  if (rows.length === 0) {
    return '(暂无数据)';
  }

  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => truncate(row[index] ?? '').length),
    ),
  );

  const formatRow = (row: string[]) =>
    row
      .map((value, index) => {
        const cell = truncate(value ?? '', 42);
        return aligns[index] === 'right'
          ? cell.padStart(widths[index], ' ')
          : cell.padEnd(widths[index], ' ');
      })
      .join('  ');

  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  return [formatRow(headers), divider, ...rows.map(formatRow)].join('\n');
}

function truncate(value: string, maxLength = 42): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const CLAUDE_PRICING: Record<string, { input: number; cache_write_5m: number; cache_write_1h: number; cache_read: number; output: number }> = {
  'claude-opus-4-6': { input: 5, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5, output: 25 },
  'claude-opus-4-5': { input: 5, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5, output: 25 },
  'claude-opus-4-1': { input: 15, cache_write_5m: 18.75, cache_write_1h: 30, cache_read: 1.5, output: 75 },
  'claude-opus-4': { input: 15, cache_write_5m: 18.75, cache_write_1h: 30, cache_read: 1.5, output: 75 },
  'claude-opus-3': { input: 15, cache_write_5m: 18.75, cache_write_1h: 30, cache_read: 1.5, output: 75 },
  'claude-sonnet-4-6': { input: 3, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3, output: 15 },
  'claude-sonnet-4-5': { input: 3, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3, output: 15 },
  'claude-sonnet-4': { input: 3, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3, output: 15 },
  'claude-sonnet-3.7': { input: 3, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1, output: 5 },
  'claude-haiku-3-5': { input: 0.8, cache_write_5m: 1, cache_write_1h: 1.6, cache_read: 0.08, output: 4 },
  'claude-haiku-3': { input: 0.25, cache_write_5m: 0.3, cache_write_1h: 0.5, cache_read: 0.03, output: 1.25 },
};

const OPENAI_PRICING: Record<string, { input: number; cached_input: number | null; output: number; estimated: boolean }> = {
  'gpt-5.4-pro': { input: 30, cached_input: null, output: 180, estimated: false },
  'gpt-5.4': { input: 2.5, cached_input: 0.25, output: 15, estimated: false },
  'gpt-5.4-mini': { input: 0.75, cached_input: 0.075, output: 4.5, estimated: false },
  'gpt-5.4-nano': { input: 0.2, cached_input: 0.02, output: 1.25, estimated: false },
  'gpt-5.2-pro': { input: 21, cached_input: null, output: 168, estimated: false },
  'gpt-5.2': { input: 1.75, cached_input: 0.175, output: 14, estimated: false },
  'gpt-5.1': { input: 1.25, cached_input: 0.125, output: 10, estimated: false },
  'gpt-5': { input: 1.25, cached_input: 0.125, output: 10, estimated: false },
  'gpt-5-pro': { input: 15, cached_input: null, output: 120, estimated: false },
  'gpt-5-mini': { input: 0.25, cached_input: 0.025, output: 2, estimated: false },
  'gpt-5-nano': { input: 0.05, cached_input: 0.005, output: 0.4, estimated: false },
  'gpt-5-codex': { input: 1.25, cached_input: 0.125, output: 10, estimated: false },
  'gpt-5.1-codex': { input: 1.25, cached_input: 0.125, output: 10, estimated: false },
  'gpt-5.1-codex-mini': { input: 0.25, cached_input: 0.025, output: 2, estimated: false },
  'gpt-5.1-codex-max': { input: 1.25, cached_input: 0.125, output: 10, estimated: false },
  'gpt-5.2-codex': { input: 1.75, cached_input: 0.175, output: 14, estimated: false },
  'gpt-5.3-codex': { input: 1.75, cached_input: 0.175, output: 14, estimated: false },
  'gpt-4.1': { input: 2, cached_input: 0.5, output: 8, estimated: false },
  'gpt-4.1-mini': { input: 0.4, cached_input: 0.1, output: 1.6, estimated: false },
  'gpt-4.1-nano': { input: 0.1, cached_input: 0.025, output: 0.4, estimated: false },
  'gpt-4o': { input: 2.5, cached_input: 1.25, output: 10, estimated: false },
  'gpt-4o-2024-05-13': { input: 5, cached_input: null, output: 15, estimated: false },
  'gpt-4o-mini': { input: 0.15, cached_input: 0.075, output: 0.6, estimated: false },
  'o1': { input: 15, cached_input: 7.5, output: 60, estimated: false },
  'o1-pro': { input: 150, cached_input: null, output: 600, estimated: false },
  'o3-pro': { input: 20, cached_input: null, output: 80, estimated: false },
  'o3': { input: 2, cached_input: 0.5, output: 8, estimated: false },
  'o4-mini': { input: 1.1, cached_input: 0.275, output: 4.4, estimated: false },
  'o3-mini': { input: 1.1, cached_input: 0.55, output: 4.4, estimated: false },
  'o1-mini': { input: 1.1, cached_input: 0.55, output: 4.4, estimated: false },
  'gpt-4-turbo-2024-04-09': { input: 10, cached_input: null, output: 30, estimated: false },
  'gpt-4-0125-preview': { input: 10, cached_input: null, output: 30, estimated: false },
  'gpt-4-1106-preview': { input: 10, cached_input: null, output: 30, estimated: false },
  'gpt-4-1106-vision-preview': { input: 10, cached_input: null, output: 30, estimated: false },
  'gpt-4-0613': { input: 30, cached_input: null, output: 60, estimated: false },
  'gpt-4-0314': { input: 30, cached_input: null, output: 60, estimated: false },
  'gpt-4-32k': { input: 60, cached_input: null, output: 120, estimated: false },
  'gpt-3.5-turbo': { input: 0.5, cached_input: null, output: 1.5, estimated: false },
  'gpt-3.5-turbo-0125': { input: 0.5, cached_input: null, output: 1.5, estimated: false },
  'gpt-3.5-turbo-1106': { input: 1, cached_input: null, output: 2, estimated: false },
  'gpt-3.5-turbo-0613': { input: 1.5, cached_input: null, output: 2, estimated: false },
  'gpt-3.5-0301': { input: 1.5, cached_input: null, output: 2, estimated: false },
  'gpt-3.5-turbo-instruct': { input: 1.5, cached_input: null, output: 2, estimated: false },
  'gpt-3.5-turbo-16k-0613': { input: 3, cached_input: null, output: 4, estimated: false },
  'davinci-002': { input: 2, cached_input: null, output: 2, estimated: false },
  'babbage-002': { input: 0.4, cached_input: null, output: 0.4, estimated: false },
  'o3-deep-research': { input: 10, cached_input: 2.5, output: 40, estimated: false },
  'o4-mini-deep-research': { input: 2, cached_input: 0.5, output: 8, estimated: false },
  'computer-use-preview': { input: 3, cached_input: null, output: 12, estimated: false },
  'text-embedding-3-small': { input: 0.02, cached_input: null, output: 0, estimated: false },
  'text-embedding-3-large': { input: 0.13, cached_input: null, output: 0, estimated: false },
  'text-embedding-ada-002': { input: 0.1, cached_input: null, output: 0, estimated: false },
  'codex-mini-latest': { input: 1.5, cached_input: 0.375, output: 6, estimated: false },
};

function toBreakdownTotals(breakdown: IngestBreakdown, warnings: Set<string>): Totals {
  const estimatedCostUsd = calculateBreakdownCost(breakdown, warnings);
  return {
    eventCount: breakdown.eventCount,
    inputTokens: breakdown.inputTokens,
    cachedInputTokens: breakdown.cachedInputTokens,
    cacheWriteTokens: breakdown.cacheWriteTokens,
    outputTokens: breakdown.outputTokens,
    reasoningOutputTokens: breakdown.reasoningOutputTokens,
    totalTokens:
      breakdown.inputTokens +
      breakdown.cachedInputTokens +
      breakdown.cacheWriteTokens +
      breakdown.outputTokens +
      breakdown.reasoningOutputTokens,
    estimatedCostUsd,
  };
}

function calculateBreakdownCost(breakdown: IngestBreakdown, warnings: Set<string>): number {
  if (breakdown.provider === 'anthropic' && breakdown.product === 'claude-code') {
    const resolved = resolveModel(breakdown.model, CLAUDE_PRICING);
    if (!resolved) {
      warnings.add(`Claude 模型 ${breakdown.model} 未配置公开单价，已跳过成本估算。`);
      return 0;
    }
    if (resolved.normalized) {
      warnings.add(`${breakdown.model} 已按 ${resolved.model} 的公开单价估算。`);
    }
    const pricing = CLAUDE_PRICING[resolved.model];
    return (
      (breakdown.inputTokens / 1_000_000) * pricing.input +
      (((breakdown.cacheWrite5mTokens ?? breakdown.cacheWriteTokens) || 0) / 1_000_000) * pricing.cache_write_5m +
      ((breakdown.cacheWrite1hTokens ?? 0) / 1_000_000) * pricing.cache_write_1h +
      (breakdown.cachedInputTokens / 1_000_000) * pricing.cache_read +
      (breakdown.outputTokens / 1_000_000) * pricing.output
    );
  }

  if (breakdown.provider === 'openai' && breakdown.product === 'codex') {
    const resolved = resolveModel(breakdown.model, OPENAI_PRICING);
    if (!resolved) {
      warnings.add(`Codex/OpenAI 模型 ${breakdown.model} 未配置公开单价，已跳过成本估算。`);
      return 0;
    }
    const pricing = OPENAI_PRICING[resolved.model];
    if (resolved.normalized) {
      warnings.add(`${breakdown.model} 已按 ${resolved.model} 的公开单价估算。`);
    } else if (pricing.estimated) {
      warnings.add(`${breakdown.model} 未在公开价目表单列，当前按 GPT-5 公开单价估算。`);
    }
    return (
      (breakdown.inputTokens / 1_000_000) * pricing.input +
      ((breakdown.cachedInputTokens / 1_000_000) * (pricing.cached_input ?? 0)) +
      (breakdown.outputTokens / 1_000_000) * pricing.output
    );
  }

  warnings.add(`${breakdown.provider}/${breakdown.product} 暂无本地定价策略，已跳过成本估算。`);
  return 0;
}

function resolveModel<T>(model: string, pricingTable: Record<string, T>): { model: string; normalized: boolean } | null {
  if (model in pricingTable) {
    return { model, normalized: false };
  }
  for (const known of Object.keys(pricingTable).sort((a, b) => b.length - a.length)) {
    if (model.startsWith(`${known}-`)) {
      return { model: known, normalized: true };
    }
  }
  return null;
}
