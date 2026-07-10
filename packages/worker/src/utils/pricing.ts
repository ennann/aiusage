/**
 * Worker 侧定价入口 —— 转发到 @aiusage/shared 的统一定价目录。
 * 历史 ModelPricing / PricingCatalog 类型保留 re-export 以兼容现有调用。
 */
import { calculateCost as calculateSharedCost } from '@aiusage/shared';
import type { CostCalcResult, IngestBreakdown } from '@aiusage/shared';

export function calculateIngestBreakdownCost(breakdown: IngestBreakdown): CostCalcResult {
  const calculated = calculateSharedCost(
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

  if (
    breakdown.costUSD == null ||
    !Number.isFinite(breakdown.costUSD) ||
    breakdown.costUSD <= 0 ||
    breakdown.pricingVersion !== calculated.pricingVersion
  ) {
    return calculated;
  }

  return { ...calculated, estimatedCostUsd: breakdown.costUSD, costStatus: 'exact' };
}

export {
  calculateCost,
  getWorstCostStatus,
  getPricingCatalog,
  catalog,
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
