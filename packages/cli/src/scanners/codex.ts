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

export async function scanCodexDates(
  targetDates: string[],
  codexDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const targetDateSet = new Set(targetDates);
  const groupedByDate = new Map<string, Map<string, IngestBreakdown>>();
  for (const targetDate of targetDateSet) groupedByDate.set(targetDate, new Map());

  const baseDirs = resolveCodexDirs(codexDir);

  const sessionFiles = (
    await Promise.all(baseDirs.map(async (baseDir) => (
      collectSessionFiles(baseDir, await detectCodexServiceTier(baseDir))
    )))
  ).flat();
  if (sessionFiles.length === 0) {
    return new Map([...targetDateSet].map((targetDate) => [targetDate, []]));
  }

  // 跨文件全局签名去重
  const globalSeenSigs = new Set<string>();

  // 并发流式处理文件
  await runWithConcurrency(sessionFiles, FILE_CONCURRENCY, async (file) => {
    await processCodexFile(file, targetDateSet, projectAliases, groupedByDate, globalSeenSigs);
  });

  return new Map(
    [...groupedByDate.entries()].map(([usageDate, grouped]) => [usageDate, [...grouped.values()]]),
  );
}

/** 流式逐行读取单个 Codex JSONL 文件 */
async function processCodexFile(
  file: CodexSessionFile,
  targetDateSet: Set<string>,
  projectAliases: Record<string, string> | undefined,
  groupedByDate: Map<string, Map<string, IngestBreakdown>>,
  globalSeenSigs: Set<string>,
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
      if (!targetDateSet.has(usageDate)) continue;

      // 跨文件全局去重：total_token_usage 在会话内单调累加，相同的非零累计值
      // 只可能来自 fork/resume 复制行或重复 emit，可安全去重。
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
      const signature = `${total.input_tokens ?? 0}|${total.cached_input_tokens ?? 0}|${total.output_tokens ?? 0}|${total.reasoning_output_tokens ?? 0}|${total.total_tokens ?? 0}`;
      if (globalSeenSigs.has(signature)) continue;
      globalSeenSigs.add(signature);

      // Use last_token_usage when available; otherwise compute delta from total_token_usage
      const last: TokenUsage = info.last_token_usage ?? {
        input_tokens: Math.max(0, (total.input_tokens ?? 0) - (previousTotal.input_tokens ?? 0)),
        cached_input_tokens: Math.max(0, (total.cached_input_tokens ?? 0) - (previousTotal.cached_input_tokens ?? 0)),
        output_tokens: Math.max(0, (total.output_tokens ?? 0) - (previousTotal.output_tokens ?? 0)),
        reasoning_output_tokens: Math.max(0, (total.reasoning_output_tokens ?? 0) - (previousTotal.reasoning_output_tokens ?? 0)),
      };
      previousTotal = total;

      // In Codex JSONL, input_tokens includes cached_input_tokens.
      // Subtract to get the non-cached portion so cost formula works uniformly.
      const nonCachedInput = Math.max(0, (last.input_tokens ?? 0) - (last.cached_input_tokens ?? 0));
      const cachedInput = last.cached_input_tokens ?? 0;
      const output = last.output_tokens ?? 0;
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

      const grouped = groupedByDate.get(usageDate);
      if (!grouped) continue;
      const key = `${currentProvider}|${currentModel}|${currentProjectFields.project}`;

      const existing = grouped.get(key);
      if (existing) {
        existing.eventCount += 1;
        existing.inputTokens += nonCachedInput;
        existing.cachedInputTokens += cachedInput;
        existing.outputTokens += output;
        existing.reasoningOutputTokens += last.reasoning_output_tokens ?? 0;
        if (exactEventCost !== undefined) {
          existing.costUSD = (existing.costUSD ?? 0) + exactEventCost;
          existing.pricingVersion = eventCost.pricingVersion;
        }
      } else {
        const breakdown: IngestBreakdown = {
          provider: currentProvider,
          product: currentProduct,
          channel: 'cli',
          model: currentModel,
          project: currentProjectFields.project,
          projectDisplay: currentProjectFields.projectDisplay,
          projectAlias: currentProjectFields.projectAlias,
          eventCount: 1,
          inputTokens: nonCachedInput,
          cachedInputTokens: cachedInput,
          cacheWriteTokens: 0,
          outputTokens: output,
          reasoningOutputTokens: last.reasoning_output_tokens ?? 0,
        };
        if (exactEventCost !== undefined) {
          breakdown.costUSD = exactEventCost;
          breakdown.pricingVersion = eventCost.pricingVersion;
        }
        grouped.set(key, breakdown);
      }
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
