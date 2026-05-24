import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { IngestBreakdown } from '@aiusage/shared';
import { calculateCost } from '@aiusage/shared';
import { scanDates } from './scan.js';

export type ReportRange = '7d' | '1m' | '3m' | 'all' | 'today';

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
  /** 直接传入日期列表时忽略 range 参数 */
  dates?: string[];
}

export async function buildLocalReport(
  range: ReportRange,
  options: BuildReportOptions = {},
): Promise<LocalReport> {
  const requestedDates = options.dates
    ? options.dates
    : range === 'all'
    ? await discoverAllDates()
    : range === 'today'
    ? [toDateKey(getTodayLocalDate())]
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
    const hasData = result.breakdowns.length > 0 || dayTotals.eventCount > 0 || dayTotals.totalTokens > 0;

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

export function parseReportRange(value: string | boolean | undefined, today?: boolean): ReportRange {
  if (today) return 'today';
  if (value === undefined || value === true) return '7d';
  if (value === '7d' || value === '1m' || value === '3m' || value === 'all' || value === 'today') return value;
  throw new Error('--range 仅支持 7d、1m、3m、all、today');
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
    case 'today':
      return '今天';
  }
}

function buildPresetDates(range: Exclude<ReportRange, 'all' | 'today'>): string[] {
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
  const home = homedir();
  await Promise.all([
    discoverClaudeDates(dates),
    discoverCodexDates(dates),
    discoverGeminiDates(dates),
    discoverCopilotVscodeDates(dates),
    discoverAntigravityDates(dates),
    discoverGenericJsonlDates(join(home, '.copilot', 'session-state'), dates),
    discoverGenericJsonlDates(join(home, '.qwen', 'tmp'), dates),
    discoverGenericJsonlDates(join(home, '.kimi', 'sessions'), dates),
    discoverGenericJsonDates(join(home, '.local', 'share', 'amp', 'threads'), dates),
    discoverGenericJsonlDates(join(home, '.factory', 'sessions'), dates),
    discoverGenericJsonDates(join(home, '.local', 'share', 'opencode'), dates),
    discoverGenericJsonlDates(join(home, '.pi', 'agent', 'sessions'), dates),
  ]);
  return [...dates].sort();
}

/** 通用：递归扫描 .jsonl 文件，逐行提取 timestamp */
async function discoverGenericJsonlDates(baseDir: string, dates: Set<string>): Promise<void> {
  const files: string[] = [];
  await walkForFiles(baseDir, '.jsonl', files);
  for (const filePath of files) {
    const content = await safeReadUtf8(filePath);
    if (!content) continue;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let record: { timestamp?: string | number };
      try { record = JSON.parse(line); } catch { continue; }
      const ts = parseTimestamp(record.timestamp as string | undefined);
      if (ts) dates.add(toDateKey(ts));
    }
  }
}

/** 通用：递归扫描 .json 文件，从顶层或 messages 提取 timestamp */
async function discoverGenericJsonDates(baseDir: string, dates: Set<string>): Promise<void> {
  const files: string[] = [];
  await walkForFiles(baseDir, '.json', files);
  for (const filePath of files) {
    const content = await safeReadUtf8(filePath);
    if (!content) continue;
    let data: any;
    try { data = JSON.parse(content); } catch { continue; }
    // 顶层 timestamp
    const topTs = parseTimestamp(data.timestamp ?? data.createTime);
    if (topTs) dates.add(toDateKey(topTs));
    // messages 数组
    const msgs = data.messages ?? data.history ?? [];
    if (Array.isArray(msgs)) {
      for (const msg of msgs) {
        const ts = parseTimestamp(msg.timestamp ?? msg.createTime);
        if (ts) dates.add(toDateKey(ts));
      }
    }
  }
}

async function walkForFiles(dir: string, ext: string, result: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForFiles(fullPath, ext, result);
    } else if (entry.name.endsWith(ext)) {
      result.push(fullPath);
    }
  }
}

async function discoverGeminiDates(dates: Set<string>): Promise<void> {
  const baseDir = join(homedir(), '.gemini', 'tmp');
  const files: string[] = [];
  await walkForGeminiJsonl(baseDir, files);

  for (const filePath of files) {
    const content = await safeReadUtf8(filePath);
    if (!content) continue;

    let session:
      | { timestamp?: string | number; createTime?: string | number; startTime?: string | number; messages?: { timestamp?: string | number; createTime?: string | number }[]; history?: { timestamp?: string | number; createTime?: string | number }[]; data?: { createTime?: string | number; messages?: { timestamp?: string | number; createTime?: string | number }[]; history?: { timestamp?: string | number; createTime?: string | number }[] } }
      | Array<{ timestamp?: string | number }>;
    try {
      session = JSON.parse(content);
    } catch {
      continue;
    }

    if (Array.isArray(session)) {
      for (const row of session) {
        const ts = parseTimestamp(row.timestamp);
        if (ts) dates.add(toDateKey(ts));
      }
      continue;
    }

    const topLevelTs = parseTimestamp(session.timestamp ?? session.createTime ?? session.startTime ?? session.data?.createTime);
    if (topLevelTs) dates.add(toDateKey(topLevelTs));

    const messages = [
      ...(session.messages ?? []),
      ...(session.history ?? []),
      ...(session.data?.messages ?? []),
      ...(session.data?.history ?? []),
    ];
    for (const msg of messages) {
      const ts = parseTimestamp(msg.timestamp ?? msg.createTime);
      if (ts) {
        dates.add(toDateKey(ts));
      }
    }
  }
}

async function walkForGeminiJsonl(dir: string, result: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForGeminiJsonl(fullPath, result);
    } else if (entry.name.endsWith('.json')) {
      result.push(fullPath);
    }
  }
}

async function discoverCopilotVscodeDates(dates: Set<string>): Promise<void> {
  const home = homedir();
  const logFiles: string[] = [];
  await walkForFiles(join(home, 'Library', 'Application Support', 'Code', 'logs'), '.log', logFiles);
  for (const filePath of logFiles) {
    if (basename(filePath) !== 'GitHub Copilot Chat.log') continue;
    const content = await safeReadUtf8(filePath);
    if (!content) continue;
    for (const line of content.split('\n')) {
      if (!line.includes('ccreq:') || !line.includes('| success |')) continue;
      const ts = parseTimestamp(line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/)?.[1]?.replace(' ', 'T'));
      if (ts) dates.add(toDateKey(ts));
    }
  }

  const sessionFiles: string[] = [];
  await walkForFiles(join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'), '.json', sessionFiles);
  for (const filePath of sessionFiles) {
    if (!filePath.includes('/chatSessions/')) continue;
    const content = await safeReadUtf8(filePath);
    if (!content) continue;
    let session: { requests?: Array<{ timestamp?: string | number; response?: unknown[]; result?: { errorDetails?: { responseIsIncomplete?: boolean } } }> };
    try {
      session = JSON.parse(content);
    } catch {
      continue;
    }
    for (const request of session.requests ?? []) {
      if ((request.response?.length ?? 0) === 0) continue;
      if (request.result?.errorDetails?.responseIsIncomplete) continue;
      const ts = parseTimestamp(request.timestamp);
      if (ts) dates.add(toDateKey(ts));
    }
  }
}

async function discoverAntigravityDates(dates: Set<string>): Promise<void> {
  const home = homedir();
  const brainFiles: string[] = [];
  const browserFiles: string[] = [];
  await walkForFiles(join(home, '.gemini', 'antigravity', 'brain'), '.json', brainFiles);
  await walkForFiles(join(home, '.gemini', 'antigravity', 'browser_recordings'), '.json', browserFiles);

  for (const filePath of brainFiles) {
    if (basename(filePath) !== 'task.md.metadata.json') continue;
    const content = await safeReadUtf8(filePath);
    if (!content) continue;
    let data: { updatedAt?: string | number };
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }
    const ts = parseTimestamp(data.updatedAt);
    if (ts) dates.add(toDateKey(ts));
  }

  for (const filePath of browserFiles) {
    if (basename(filePath) !== 'metadata.json') continue;
    const content = await safeReadUtf8(filePath);
    if (!content) continue;
    let data: { highlights?: Array<{ start_time?: string | number; end_time?: string | number }> };
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }
    const ts = parseTimestamp(data.highlights?.[0]?.start_time ?? data.highlights?.[0]?.end_time);
    if (ts) dates.add(toDateKey(ts));
  }
}

async function discoverClaudeDates(dates: Set<string>): Promise<void> {
  const home = homedir();
  const baseDirs = [
    join(home, '.config', 'claude', 'projects'),
    join(home, '.claude', 'projects'),
  ];

  for (const baseDir of baseDirs) {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(baseDir);
    } catch {
      continue;
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

function parseTimestamp(value?: string | number): Date | null {
  if (value === undefined || value === null || value === '') return null;
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

/**
 * 计算单个 breakdown 的成本：
 * 1. 若 Claude Code JSONL 自带 costUSD（旧版本会写），直接采用
 * 2. 否则委托给 @aiusage/shared 的 calculateCost
 *
 * 失败/估算情况注入 warning 给上层报告展示。
 */
export function calculateBreakdownCost(breakdown: IngestBreakdown, warnings: Set<string>): number {
  if (breakdown.costUSD != null && breakdown.costUSD > 0) {
    return breakdown.costUSD;
  }

  const result = calculateCost(
    breakdown.provider,
    breakdown.product,
    breakdown.model,
    {
      inputTokens: breakdown.inputTokens,
      cachedInputTokens: breakdown.cachedInputTokens,
      cacheWriteTokens: breakdown.cacheWriteTokens,
      cacheWrite5mTokens: breakdown.cacheWrite5mTokens,
      cacheWrite1hTokens: breakdown.cacheWrite1hTokens,
      outputTokens: breakdown.outputTokens,
    },
  );

  if (result.costStatus === 'unavailable') {
    warnings.add(`${breakdown.provider}/${breakdown.product}/${breakdown.model} 暂无定价配置，已跳过成本估算。`);
  } else if (result.costStatus === 'estimated' && result.resolvedModel && result.resolvedModel !== breakdown.model) {
    warnings.add(`${breakdown.model} 已按 ${result.resolvedModel} 的公开单价估算。`);
  }

  return result.estimatedCostUsd;
}
