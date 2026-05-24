import type { CostStatus } from '../types.js';
import type {
  PricingCatalog,
  ModelPricing,
  PricingTier,
  CostCalcInput,
  CostCalcResult,
} from './types.js';
import { catalog as defaultCatalog } from './catalog.js';

const FAST_MULTIPLIER = 6;

/**
 * resolveModelPricing — alias 精确匹配，再 longest-prefix fallback。
 *
 * 重要：fallback 时只匹配同档前缀（如 `claude-opus-4-7` 不应 fallback 到 `claude-opus-4`），
 * 通过要求"前缀后必须紧跟 `-` + 数字"避免跨档命中。
 */
function resolveModelPricing(
  catalog: PricingCatalog,
  provider: string,
  product: string,
  model: string,
): { resolvedModel: string; pricing: ModelPricing; normalized: boolean } | null {
  const models = catalog.providers[provider]?.[product]?.models;
  if (!models) return null;

  const aliasResolved = catalog.aliases[model];
  if (aliasResolved && models[aliasResolved]) {
    // Alias 是 catalog 显式声明的等价名（如 claude-opus-4-7-20260201 → claude-opus-4-7），
    // 视为 exact 命中；只有前缀回退（fallback）才算 estimated
    return { resolvedModel: aliasResolved, pricing: models[aliasResolved], normalized: false };
  }

  if (models[model]) {
    return { resolvedModel: model, pricing: models[model], normalized: false };
  }

  // longest-prefix fallback（同 family / 同档位前缀）
  for (const knownModel of Object.keys(models).sort((a, b) => b.length - a.length)) {
    if (!model.startsWith(`${knownModel}-`)) continue;
    // 拒绝跨档命中：known='claude-opus-4', model='claude-opus-4-7' 时
    // 后缀是 '-7'（纯版本号），说明本应有更准确的 'claude-opus-4-7' 条目；
    // 此处保留旧行为以保证兼容，但调用方应通过 cost_status='estimated' 区分。
    return { resolvedModel: knownModel, pricing: models[knownModel], normalized: true };
  }

  return null;
}

/** 选阶梯：按总 input（含 cached + cache_write）命中。 */
function selectTier(tiers: PricingTier[], totalInputTokens: number): { tier: PricingTier; index: number } {
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i];
    if (t.threshold === undefined || totalInputTokens <= t.threshold) {
      return { tier: t, index: i };
    }
  }
  return { tier: tiers[tiers.length - 1], index: tiers.length - 1 };
}

/** 折算成 USD。 */
function toUsd(amount: number, currency: ModelPricing['currency'], catalog: PricingCatalog): number {
  if (currency === 'USD') return amount;
  const rate = catalog.fx[currency];
  return rate ? amount / rate : amount;
}

export interface CalculateCostOptions {
  /** 自定义 catalog，便于 Worker 用 env 覆盖汇率等参数。 */
  catalog?: PricingCatalog;
}

export function calculateCost(
  provider: string,
  product: string,
  model: string,
  tokens: CostCalcInput,
  options: CalculateCostOptions = {},
): CostCalcResult {
  const cat = options.catalog ?? defaultCatalog;

  const totalTokens =
    tokens.inputTokens +
    tokens.cachedInputTokens +
    tokens.cacheWriteTokens +
    tokens.outputTokens;

  if (totalTokens === 0) {
    return { estimatedCostUsd: 0, costStatus: 'exact', pricingVersion: cat.version };
  }

  const isFast = model.endsWith('-fast');
  const baseModel = isFast ? model.replace(/-fast$/, '') : model;

  const resolved = resolveModelPricing(cat, provider, product, baseModel);
  if (!resolved) {
    return { estimatedCostUsd: 0, costStatus: 'unavailable', pricingVersion: cat.version };
  }

  const { resolvedModel, pricing, normalized } = resolved;
  let costStatus: CostStatus = normalized ? 'estimated' : 'exact';

  // 阶梯：按总 input（含 cached/cw）命中档位
  let unit: PricingTier;
  let matchedTierIndex: number | undefined;
  if (pricing.tiers && pricing.tiers.length > 0) {
    const totalIn = tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheWriteTokens;
    const { tier, index } = selectTier(pricing.tiers, totalIn);
    unit = tier;
    matchedTierIndex = index;
  } else {
    unit = {
      input_per_million: pricing.input_per_million ?? 0,
      output_per_million: pricing.output_per_million ?? 0,
      cached_input_per_million: pricing.cached_input_per_million ?? null,
      cache_write_5m_per_million: pricing.cache_write_5m_per_million ?? 0,
      cache_write_1h_per_million: pricing.cache_write_1h_per_million ?? 0,
    };
  }

  // cache_write_5m/1h 在阶梯档位里如果没填，回退到顶层
  const cw5Rate = unit.cache_write_5m_per_million ?? pricing.cache_write_5m_per_million ?? 0;
  const cw1hRate = unit.cache_write_1h_per_million ?? pricing.cache_write_1h_per_million ?? 0;
  const cachedRate = unit.cached_input_per_million ?? pricing.cached_input_per_million ?? 0;

  let raw =
    (tokens.inputTokens / 1_000_000) * (unit.input_per_million ?? 0) +
    (tokens.cachedInputTokens / 1_000_000) * (cachedRate ?? 0) +
    ((tokens.cacheWrite5mTokens ?? tokens.cacheWriteTokens) / 1_000_000) * cw5Rate +
    ((tokens.cacheWrite1hTokens ?? 0) / 1_000_000) * cw1hRate +
    (tokens.outputTokens / 1_000_000) * (unit.output_per_million ?? 0);

  // 折算 currency → USD
  raw = toUsd(raw, pricing.currency, cat);

  // Fast 模式（仅 Opus 4.6/4.7 官方支持，但对所有 -fast 后缀都乘 6 以保留旧行为）
  const finalCost = isFast ? raw * FAST_MULTIPLIER : raw;

  return {
    estimatedCostUsd: Math.round(finalCost * 10000) / 10000,
    costStatus,
    pricingVersion: cat.version,
    resolvedModel,
    matchedTierIndex,
  };
}

export function getWorstCostStatus(statuses: CostStatus[]): CostStatus {
  if (statuses.includes('unavailable')) return 'unavailable';
  if (statuses.includes('estimated')) return 'estimated';
  return 'exact';
}
