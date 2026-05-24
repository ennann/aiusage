import type { ProductPricing } from '../types.js';

/**
 * 阿里云通义千问 Qwen。
 * 单价 CNY / 1M tokens。来源：https://help.aliyun.com/zh/model-studio/model-pricing
 * 最近核对：2026-05-24
 *
 * 多数 qwen3-* 模型按 input 长度分档（32K / 128K / 256K / 1M）。
 */
export const alibaba: Record<string, ProductPricing> = {
  'qwen-code': {
    models: {
      'qwen3-coder-plus': {
        currency: 'CNY',
        notes: 'tiered by input length',
        tiers: [
          { threshold: 32_000, input_per_million: 4, output_per_million: 16 },
          { threshold: 128_000, input_per_million: 6, output_per_million: 24 },
          { threshold: 256_000, input_per_million: 10, output_per_million: 40 },
          { input_per_million: 20, output_per_million: 200 },
        ],
      },
      'qwen3-coder-flash': {
        currency: 'CNY',
        tiers: [
          { threshold: 32_000, input_per_million: 1, output_per_million: 4 },
          { threshold: 128_000, input_per_million: 1.5, output_per_million: 6 },
          { threshold: 256_000, input_per_million: 2, output_per_million: 8 },
          { input_per_million: 3, output_per_million: 30 },
        ],
      },
      'qwen-coder-plus': {
        currency: 'CNY',
        input_per_million: 3.5,
        output_per_million: 7,
      },
      'qwen3-max': {
        currency: 'CNY',
        tiers: [
          { threshold: 32_000, input_per_million: 2.5, output_per_million: 10 },
          { threshold: 128_000, input_per_million: 5, output_per_million: 20 },
          { threshold: 256_000, input_per_million: 10, output_per_million: 100 },
        ],
      },
      'qwen-max': {
        currency: 'CNY',
        input_per_million: 2.4,
        output_per_million: 9.6,
      },
      'qwen-plus': {
        currency: 'CNY',
        notes: 'cache hit ¥0.8/M',
        cached_input_per_million: 0.8,
        input_per_million: 2,
        output_per_million: 8,
      },
      'qwen-turbo': {
        currency: 'CNY',
        notes: 'cache hit ¥0.3/M',
        cached_input_per_million: 0.3,
        input_per_million: 0.6,
        output_per_million: 3,
      },
      'qwen3-32b': {
        currency: 'CNY',
        input_per_million: 2,
        output_per_million: 8,
      },
      'qwen3-235b-a22b-thinking-2507': {
        currency: 'CNY',
        input_per_million: 2,
        output_per_million: 20,
      },
      'qwen3-235b-a22b-instruct-2507': {
        currency: 'CNY',
        input_per_million: 2,
        output_per_million: 8,
      },
    },
  },
};
