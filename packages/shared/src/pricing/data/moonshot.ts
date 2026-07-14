import type { ProductPricing } from '../types.js';

/**
 * Moonshot Kimi。
 * 单价 CNY / 1M tokens。来源：https://platform.kimi.com/docs/pricing/chat
 * 最近核对：2026-05-24
 *
 * Kimi 没有 cache_write 概念，只有 cache hit / miss：
 * - input_per_million = cache miss 价
 * - cached_input_per_million = cache hit 价
 */
export const moonshot: Record<string, ProductPricing> = {
  'kimi-code': {
    models: {
      'kimi-k2.6': {
        currency: 'CNY',
        input_per_million: 6.5,
        cached_input_per_million: 1.1,
        output_per_million: 27,
      },
      'kimi-k2.5': {
        currency: 'CNY',
        input_per_million: 4,
        cached_input_per_million: 0.7,
        output_per_million: 21,
      },
      'kimi-k2-0905-preview': {
        currency: 'CNY',
        notes: 'will be retired 2026-05-25',
        input_per_million: 4,
        cached_input_per_million: 1,
        output_per_million: 16,
      },
      'kimi-k2-0711-preview': {
        currency: 'CNY',
        notes: 'will be retired 2026-05-25',
        input_per_million: 4,
        cached_input_per_million: 1,
        output_per_million: 16,
      },
      'kimi-k2-turbo-preview': {
        currency: 'CNY',
        notes: 'will be retired 2026-05-25',
        input_per_million: 8,
        cached_input_per_million: 1,
        output_per_million: 58,
      },
      'kimi-k2-thinking': {
        currency: 'CNY',
        input_per_million: 4,
        cached_input_per_million: 1,
        output_per_million: 16,
      },
      'kimi-k2-thinking-turbo': {
        currency: 'CNY',
        input_per_million: 8,
        cached_input_per_million: 1,
        output_per_million: 58,
      },
      'moonshot-v1-8k': {
        currency: 'CNY',
        input_per_million: 2,
        output_per_million: 10,
      },
      'moonshot-v1-32k': {
        currency: 'CNY',
        input_per_million: 5,
        output_per_million: 20,
      },
      'moonshot-v1-128k': {
        currency: 'CNY',
        input_per_million: 10,
        output_per_million: 30,
      },
      'moonshot-v1-8k-vision-preview': {
        currency: 'CNY',
        input_per_million: 2,
        output_per_million: 10,
      },
      'moonshot-v1-32k-vision-preview': {
        currency: 'CNY',
        input_per_million: 5,
        output_per_million: 20,
      },
      'moonshot-v1-128k-vision-preview': {
        currency: 'CNY',
        input_per_million: 10,
        output_per_million: 30,
      },
    },
  },
};
