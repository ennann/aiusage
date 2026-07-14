import type { ProductPricing } from '../types.js';

/**
 * DeepSeek。
 * 单价 USD / 1M tokens（DeepSeek 官方直接美元定价）。
 * 来源：https://api-docs.deepseek.com/quick_start/pricing/
 * 最近核对：2026-05-24
 *
 * deepseek-v4-pro 当前为 75% off 促销，2026-05-31 后涨 4 倍至 $0.0145/$1.74/$3.48
 */
export const deepseek: Record<string, ProductPricing> = {
  'deepseek-chat': {
    models: {
      'deepseek-v4-flash': {
        currency: 'USD',
        input_per_million: 0.14,
        cached_input_per_million: 0.0028,
        output_per_million: 0.28,
      },
      'deepseek-v4-pro': {
        currency: 'USD',
        notes: '75% off promo until 2026-05-31',
        input_per_million: 0.435,
        cached_input_per_million: 0.003625,
        output_per_million: 0.87,
        effective_to: '2026-05-31',
      },
      // 兼容别名（chat = v4-flash 非思考，reasoner = v4-flash 思考），按 v4-flash 同价计
      'deepseek-chat': {
        currency: 'USD',
        notes: 'alias for v4-flash non-thinking',
        input_per_million: 0.14,
        cached_input_per_million: 0.0028,
        output_per_million: 0.28,
      },
      'deepseek-reasoner': {
        currency: 'USD',
        notes: 'alias for v4-flash thinking',
        input_per_million: 0.14,
        cached_input_per_million: 0.0028,
        output_per_million: 0.28,
      },
    },
  },
};
