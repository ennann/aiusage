/**
 * Worker 侧定价入口 —— 转发到 @aiusage/shared 的统一定价目录。
 * 历史 ModelPricing / PricingCatalog 类型保留 re-export 以兼容现有调用。
 */
import {
  calculateCost as calculateSharedCost,
  catalog as sharedCatalog,
} from '@aiusage/shared';
import type {
  CalculateCostOptions,
  CostCalcInput,
  CostCalcResult,
  IngestBreakdown,
  PricingCatalog,
} from '@aiusage/shared';

const claudeCodeModels = {
  ...sharedCatalog.providers.anthropic['claude-code'].models,
  'claude-fable-5': {
    currency: 'USD' as const,
    input_per_million: 10,
    output_per_million: 50,
    cached_input_per_million: 1,
    cache_write_5m_per_million: 12.5,
    cache_write_1h_per_million: 20,
  },
  'claude-sonnet-5': {
    currency: 'USD' as const,
    input_per_million: 2,
    output_per_million: 10,
    cached_input_per_million: 0.2,
    cache_write_5m_per_million: 2.5,
    cache_write_1h_per_million: 4,
  },
};

/** Worker keeps Joe's additional public-price rows and ninerouter product route. */
export const catalog: PricingCatalog = {
  ...sharedCatalog,
  providers: {
    ...sharedCatalog.providers,
    anthropic: {
      ...sharedCatalog.providers.anthropic,
      'claude-code': { models: claudeCodeModels },
      codex: { models: claudeCodeModels },
    },
  },
};

const legacyModelAliases: Record<string, string> = {
  'claude-opus-4.6': 'claude-opus-4-6',
  'claude-opus-4.8': 'claude-opus-4-8',
  'claude-sonnet-4-20250514-v1-0': 'claude-sonnet-4',
};

export function getPricingCatalog(): PricingCatalog {
  return catalog;
}

export function calculateCost(
  provider: string,
  product: string,
  model: string,
  tokens: CostCalcInput,
  options: CalculateCostOptions = {},
): CostCalcResult {
  const aliasKey = model.trim().toLowerCase().replace(/_/g, '-');
  const resolvedLegacyModel = legacyModelAliases[aliasKey];
  const result = calculateSharedCost(
    provider,
    product,
    resolvedLegacyModel ?? model,
    tokens,
    { ...options, catalog: options.catalog ?? catalog },
  );

  return resolvedLegacyModel && result.costStatus !== 'unavailable'
    ? { ...result, costStatus: 'estimated' }
    : result;
}

export function calculateIngestBreakdownCost(breakdown: IngestBreakdown): CostCalcResult {
  const calculated = calculateCost(
    breakdown.provider,
    breakdown.product,
    breakdown.model,
    {
      inputTokens: breakdown.inputTokens,
      cachedInputTokens: breakdown.cachedInputTokens,
      cacheWriteTokens: breakdown.cacheWriteTokens,
      cacheWrite5mTokens: breakdown.cacheWrite5mTokens ?? breakdown.cacheWriteTokens,
      cacheWrite1hTokens: breakdown.cacheWrite1hTokens ?? 0,
      outputTokens: breakdown.outputTokens,
    },
    { requestCount: breakdown.eventCount },
  );

  const hasClientCost =
    breakdown.costUSD != null &&
    Number.isFinite(breakdown.costUSD) &&
    breakdown.costUSD > 0;
  if (!hasClientCost) return calculated;

  const estimatedCostUsd = Math.round(breakdown.costUSD! * 10000) / 10000;
  if (breakdown.pricingVersion === calculated.pricingVersion) {
    return { ...calculated, estimatedCostUsd, costStatus: 'exact' };
  }

  // Kiro credit usage and a few legacy scanners have authoritative local cost
  // but no token-based catalog version. Preserve that cost while continuing to
  // reject explicitly stale catalog calculations.
  if (!breakdown.pricingVersion) {
    return {
      ...calculated,
      estimatedCostUsd,
      costStatus: 'estimated',
      pricingVersion: 'client-supplied',
    };
  }

  return calculated;
}

export {
  getWorstCostStatus,
  PRICING_VERSION,
} from '@aiusage/shared';

export type {
  ModelPricing,
  PricingCatalog,
  ProductPricing,
  Currency,
  PricingTier,
  CostCalcInput,
  CostCalcResult,
} from '@aiusage/shared';
