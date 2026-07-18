import { readdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { calculateCost, type IngestBreakdown } from '@aiusage/shared';
import { normalizeModelName, runWithConcurrency, resolveProjectFields, type ProjectFields } from './utils.js';

const FILE_CONCURRENCY = 16;
const MAX_LINE_BYTES = 64 * 1024 * 1024; // 64 MB
const REPLAY_SCAN_MIN_FILE_BYTES = 1024 * 1024;
const REPLAY_MIN_TOKEN_EVENTS = 200;
const REPLAY_MAX_SPAN_MS = 60_000;

/** 默认扫描的 Codex 数据目录（相对 home），覆盖标准 Codex 及额外客户端 */
const DEFAULT_CODEX_DIRNAMES = ['.codex', '.codex-kiro'];

/** 解析待扫描的 Codex 基础目录列表 */
function resolveCodexDirs(codexDir?: string): string[] {
  if (codexDir) return [codexDir];
  const home = homedir();
  return DEFAULT_CODEX_DIRNAMES.map((name) => join(home, name));
}

interface CodexModelMeta {
  provider: string;
  product: string;
  model: string;
}

/**
 * 解析 Codex turn_context 中的模型名。
 * 部分客户端（如 .codex-kiro）通过 ninerouter 路由第三方模型，
 * 形如 `kr/claude-opus-4.8`，需按真实 provider 归类并归一化模型名。
 */
function resolveCodexModelMeta(rawModel: string): CodexModelMeta {
  const stripped = rawModel.includes('/') ? rawModel.slice(rawModel.lastIndexOf('/') + 1) : rawModel;
  const lower = stripped.toLowerCase();

  if (lower.startsWith('claude')) {
    const model = lower.replace(/\./g, '-').replace(/-\d{8}$/, '');
    return { provider: 'anthropic', product: 'codex', model };
  }

  return { provider: 'openai', product: 'codex', model: normalizeModelName(rawModel) };
}

type CodexServiceTier = 'fast' | 'priority' | null;

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

interface CodexSessionFile {
  path: string;
  isArchived: boolean;
  serviceTier: CodexServiceTier;
}

export async function scanCodex(
  targetDate: string,
  codexDir?: string,
  projectAliases?: Record<string, string>,
): Promise<IngestBreakdown[]> {
  const groupedByDate = await scanCodexDates([targetDate], codexDir, projectAliases);
  return groupedByDate.get(targetDate) ?? [];
}

/** 单个 token_count 事件按累计签名去重后保留的最早一次记录 */
interface CodexEventRecord {
  tsMs: number;
  usageDate: string;
  provider: string;
  product: string;
  model: string;
  project: string;
  projectDisplay: string;
  projectAlias?: string;
  nonCachedInput: number;
  cachedInput: number;
  output: number;
  reasoning: number;
  exactEventCost?: number;
  pricingVersion?: string;
}

export async function scanCodexDates(
  targetDates: string[],
  codexDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const targetDateSet = new Set(targetDates);

  const baseDirs = resolveCodexDirs(codexDir);

  const sessionFiles = (
    await Promise.all(baseDirs.map(async (baseDir) => (
      collectSessionFiles(baseDir, await detectCodexServiceTier(baseDir))
    )))
  ).flat();
  if (sessionFiles.length === 0) {
    return new Map([...targetDateSet].map((targetDate) => [targetDate, []]));
  }

  // 跨文件按累计签名去重，并将用量归属到该签名【最早】出现的时间。
  //
  // fork/resume 会话会在 fork 时刻以当时的时间戳批量重放父会话的全部 token_count
  // 事件（可从 session_meta.forked_from_id 识别）。若按事件时间戳直接累加，会把父
  // 会话的历史用量误计入 fork 当天，导致当日用量被严重放大——尤其在只查询单日
  // （--today）时，父会话原始事件不在查询范围内，旧的「同范围内首次出现即去重」
  // 逻辑无法抵消重放，从而虚高数倍。
  //
  // 这里改为「最早时间戳获胜」：重放事件的累计签名与父会话原始事件完全相同，而父
  // 会话原始事件时间更早，故每个签名的用量始终归属其首次真实发生的日期，fork 当天
  // 不会再重复计入。该判定只依赖时间戳，与文件处理顺序无关，结果稳定且与查询范围无关。
  //
  // 注意：为找到每个签名的最早出现，必须扫描全部会话文件（不能按目标日期提前跳过），
  // 最终再按 targetDateSet 过滤归属结果。
  const earliestBySig = new Map<string, CodexEventRecord>();

  await runWithConcurrency(sessionFiles, FILE_CONCURRENCY, async (file) => {
    await processCodexFile(file, projectAliases, earliestBySig);
  });

  const groupedByDate = new Map<string, Map<string, IngestBreakdown>>();
  for (const targetDate of targetDateSet) groupedByDate.set(targetDate, new Map());

  for (const record of earliestBySig.values()) {
    if (!targetDateSet.has(record.usageDate)) continue;
    const grouped = groupedByDate.get(record.usageDate);
    if (!grouped) continue;

    const key = `${record.provider}|${record.model}|${record.project}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.eventCount += 1;
      existing.inputTokens += record.nonCachedInput;
      existing.cachedInputTokens += record.cachedInput;
      existing.outputTokens += record.output;
      existing.reasoningOutputTokens += record.reasoning;
      if (record.exactEventCost !== undefined) {
        existing.costUSD = (existing.costUSD ?? 0) + record.exactEventCost;
        existing.pricingVersion = record.pricingVersion;
      }
    } else {
      const breakdown: IngestBreakdown = {
        provider: record.provider,
        product: record.product,
        channel: 'cli',
        model: record.model,
        project: record.project,
        projectDisplay: record.projectDisplay,
        projectAlias: record.projectAlias,
        eventCount: 1,
        inputTokens: record.nonCachedInput,
        cachedInputTokens: record.cachedInput,
        cacheWriteTokens: 0,
        outputTokens: record.output,
        reasoningOutputTokens: record.reasoning,
      };
      if (record.exactEventCost !== undefined) {
        breakdown.costUSD = record.exactEventCost;
        breakdown.pricingVersion = record.pricingVersion;
      }
      grouped.set(key, breakdown);
    }
  }

  return new Map(
    [...groupedByDate.entries()].map(([usageDate, grouped]) => [usageDate, [...grouped.values()]]),
  );
}

/** 流式逐行读取单个 Codex JSONL 文件，将每个 token_count 事件按签名并入最早记录表 */
async function processCodexFile(
  file: CodexSessionFile,
  projectAliases: Record<string, string> | undefined,
  earliestBySig: Map<string, CodexEventRecord>,
): Promise<void> {
  if (await isReplayDump(file)) {
    return;
  }

  let fh;
  try {
    fh = await open(file.path, 'r');
  } catch {
    return;
  }

  try {
    const rl = createInterface({
      input: fh.createReadStream({ encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let currentModel = 'unknown';
    let currentProvider = 'openai';
    let currentProduct = 'codex';
    let currentProjectFields: ProjectFields = { project: 'unknown', projectDisplay: 'unknown' };
    let previousTotal: TokenUsage = {};

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
          const meta = resolveCodexModelMeta(rawModel);
          currentModel = applyCodexServiceTier(meta.model, file.serviceTier);
          currentProvider = meta.provider;
          currentProduct = meta.product;
        }
        if (record.payload?.cwd) {
          currentProjectFields = resolveProjectFields(record.payload.cwd, projectAliases);
        }
        continue;
      }

      if (record.type !== 'event_msg') continue;
      if (record.payload?.type !== 'token_count') continue;

      const info = record.payload?.info;
      if (!info?.total_token_usage) continue;

      const ts = parseTimestamp(record.timestamp);
      if (!ts) continue;
      const usageDate = toDateKey(ts);

      // total_token_usage 在会话内单调累加，可作为事件的稳定签名。
      const total = info.total_token_usage;
      const totalSum =
        (total.input_tokens ?? 0) +
        (total.cached_input_tokens ?? 0) +
        (total.output_tokens ?? 0) +
        (total.reasoning_output_tokens ?? 0) +
        (total.total_tokens ?? 0);
      // 全零累计是每个会话开头都有的噪声，跨会话签名相同会被误杀，
      // 故全零既不参与去重也不计入用量（last 也必为 0，无影响）。
      if (totalSum === 0) continue;

      // Use last_token_usage when available; otherwise compute delta from total_token_usage.
      // previousTotal 逐事件推进（含被去重的重复行），保证 delta 回退路径在文件内始终正确。
      const last: TokenUsage = info.last_token_usage ?? {
        input_tokens: Math.max(0, (total.input_tokens ?? 0) - (previousTotal.input_tokens ?? 0)),
        cached_input_tokens: Math.max(0, (total.cached_input_tokens ?? 0) - (previousTotal.cached_input_tokens ?? 0)),
        output_tokens: Math.max(0, (total.output_tokens ?? 0) - (previousTotal.output_tokens ?? 0)),
        reasoning_output_tokens: Math.max(0, (total.reasoning_output_tokens ?? 0) - (previousTotal.reasoning_output_tokens ?? 0)),
      };
      previousTotal = total;

      const signature = `${total.input_tokens ?? 0}|${total.cached_input_tokens ?? 0}|${total.output_tokens ?? 0}|${total.reasoning_output_tokens ?? 0}|${total.total_tokens ?? 0}`;
      const tsMs = ts.getTime();
      // 仅保留该签名【最早】出现的一次：同一签名的后续出现（重复 emit、fork/resume
      // 重放的父会话历史）时间不早于既有记录，直接跳过，避免重复计入用量。
      const seen = earliestBySig.get(signature);
      if (seen && tsMs >= seen.tsMs) continue;

      // In Codex JSONL, input_tokens includes cached_input_tokens.
      // Subtract to get the non-cached portion so cost formula works uniformly.
      const nonCachedInput = Math.max(0, (last.input_tokens ?? 0) - (last.cached_input_tokens ?? 0));
      const cachedInput = last.cached_input_tokens ?? 0;
      const output = last.output_tokens ?? 0;
      const reasoning = last.reasoning_output_tokens ?? 0;
      const pricingProduct = currentProvider === 'anthropic' && currentProduct === 'codex'
        ? 'claude-code'
        : currentProduct;
      const eventCost = calculateCost(currentProvider, pricingProduct, currentModel, {
        inputTokens: nonCachedInput,
        cachedInputTokens: cachedInput,
        cacheWriteTokens: 0,
        outputTokens: output,
      });
      const exactEventCost = eventCost.costStatus === 'exact' ? eventCost.estimatedCostUsd : undefined;

      earliestBySig.set(signature, {
        tsMs,
        usageDate,
        provider: currentProvider,
        product: currentProduct,
        model: currentModel,
        project: currentProjectFields.project,
        projectDisplay: currentProjectFields.projectDisplay,
        projectAlias: currentProjectFields.projectAlias,
        nonCachedInput,
        cachedInput,
        output,
        reasoning,
        ...(exactEventCost !== undefined
          ? { exactEventCost, pricingVersion: eventCost.pricingVersion }
          : {}),
      });
    }
  } finally {
    await fh.close();
  }
}

async function collectSessionFiles(
  baseDir: string,
  serviceTier: CodexServiceTier,
): Promise<CodexSessionFile[]> {
  const paths: CodexSessionFile[] = [];

  // archived_sessions/*.jsonl
  const archivedDir = join(baseDir, 'archived_sessions');
  try {
    const files = await readdir(archivedDir);
    for (const f of files) {
      if (f.endsWith('.jsonl')) {
        paths.push({ path: join(archivedDir, f), isArchived: true, serviceTier });
      }
    }
  } catch { /* ignore */ }

  // sessions/**/*.jsonl (递归)
  const sessionsDir = join(baseDir, 'sessions');
  await walkDir(sessionsDir, paths, false, serviceTier);

  return paths;
}

async function detectCodexServiceTier(baseDir: string): Promise<CodexServiceTier> {
  let config = '';
  try {
    config = await readFile(join(baseDir, 'config.toml'), 'utf-8');
  } catch {
    return null;
  }

  const serviceTier = config.match(/^\s*service_tier\s*=\s*["']([^"']+)["']/m)?.[1]?.trim().toLowerCase();
  if (serviceTier === 'priority') return 'priority';
  if (serviceTier === 'fast') return 'fast';

  const fastMode = config.match(/^\s*fast_mode\s*=\s*(true|false)\s*$/m)?.[1];
  return fastMode === 'true' ? 'fast' : null;
}

function applyCodexServiceTier(model: string, serviceTier: CodexServiceTier): string {
  if (!serviceTier) return model;
  if (model.endsWith('-fast') || model.endsWith('-priority')) return model;
  const supportsFast = model === 'gpt-5.5' || model === 'gpt-5.4';
  const supportsPriority =
    model === 'gpt-5.6' ||
    model === 'gpt-5.6-sol' ||
    model === 'gpt-5.6-terra' ||
    model === 'gpt-5.6-luna' ||
    supportsFast;
  if ((serviceTier === 'fast' && supportsFast) || (serviceTier === 'priority' && supportsPriority)) {
    return `${model}-${serviceTier}`;
  }
  return model;
}

async function walkDir(
  dir: string,
  result: CodexSessionFile[],
  isArchived: boolean,
  serviceTier: CodexServiceTier,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, result, isArchived, serviceTier);
    } else if (entry.name.endsWith('.jsonl')) {
      result.push({ path: fullPath, isArchived, serviceTier });
    }
  }
}

async function isReplayDump(file: CodexSessionFile): Promise<boolean> {
  if (!file.isArchived) {
    try {
      const fileStat = await stat(file.path);
      if (fileStat.size < REPLAY_SCAN_MIN_FILE_BYTES) return false;
    } catch {
      return false;
    }
  }

  let fh;
  try {
    fh = await open(file.path, 'r');
  } catch {
    return false;
  }

  try {
    const rl = createInterface({
      input: fh.createReadStream({ encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let tokenEvents = 0;
    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = 0;

    for await (const line of rl) {
      if (!line) continue;
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) continue;

      let record: CodexRecord;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type !== 'event_msg') continue;
      if (record.payload?.type !== 'token_count') continue;

      const ts = parseTimestamp(record.timestamp)?.getTime();
      if (!ts) continue;

      tokenEvents += 1;
      minTime = Math.min(minTime, ts);
      maxTime = Math.max(maxTime, ts);

      if (tokenEvents >= REPLAY_MIN_TOKEN_EVENTS && maxTime - minTime > REPLAY_MAX_SPAN_MS) {
        return false;
      }
    }

    return tokenEvents >= REPLAY_MIN_TOKEN_EVENTS
      && maxTime - minTime <= REPLAY_MAX_SPAN_MS;
  } finally {
    await fh.close();
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
