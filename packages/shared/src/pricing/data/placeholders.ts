import type { ProductPricing } from '../types.js';

/**
 * 占位 provider：这些 scanner 只能拿到 token / 事件数，但厂商不公开 per-token 单价，
 * 或本身按订阅/打包计费。保留空 models 让 CI 测试通过，同时 calculateCost
 * 会返回 costStatus='unavailable' 并 cost=0。
 *
 * 后续若官方放出定价，把对应模型直接加进 models 即可。
 */

const empty: Record<string, ProductPricing> = {};

export const inflection: Record<string, ProductPricing> = {
  pi: { models: {} },
};

export const cursor: Record<string, ProductPricing> = {
  cursor: { models: {} },
};

export const droid: Record<string, ProductPricing> = {
  droid: { models: {} },
};

export const opencode: Record<string, ProductPricing> = {
  opencode: { models: {} },
};

// google.antigravity 是 google 下的另一个 product；扩展 google 表
export const googleAntigravity: ProductPricing = { models: {} };

void empty;
