import type { ProductPricing } from '../types.js';

/**
 * Anthropic Claude（含 Claude Code CLI）。
 * 单价 USD / 1M tokens。来源：https://docs.claude.com/en/docs/about-claude/pricing
 * 最近核对：2026-07-02
 */
export const anthropic: Record<string, ProductPricing> = {
  'claude-code': {
    models: {
      'claude-fable-5': {
        currency: 'USD',
        input_per_million: 10,
        output_per_million: 50,
        cache_write_5m_per_million: 12.5,
        cache_write_1h_per_million: 20,
        cached_input_per_million: 1,
      },
      'claude-sonnet-5': {
        currency: 'USD',
        notes: 'introductory pricing through 2026-08-31; standard pricing starts 2026-09-01',
        input_per_million: 2,
        output_per_million: 10,
        cache_write_5m_per_million: 2.5,
        cache_write_1h_per_million: 4,
        cached_input_per_million: 0.2,
      },
      'claude-opus-4-8': {
        currency: 'USD',
        input_per_million: 5,
        output_per_million: 25,
        cache_write_5m_per_million: 6.25,
        cache_write_1h_per_million: 10,
        cached_input_per_million: 0.5,
      },
      'claude-opus-4-7': {
        currency: 'USD',
        input_per_million: 5,
        output_per_million: 25,
        cache_write_5m_per_million: 6.25,
        cache_write_1h_per_million: 10,
        cached_input_per_million: 0.5,
      },
      'claude-opus-4-6': {
        currency: 'USD',
        input_per_million: 5,
        output_per_million: 25,
        cache_write_5m_per_million: 6.25,
        cache_write_1h_per_million: 10,
        cached_input_per_million: 0.5,
      },
      'claude-opus-4-5': {
        currency: 'USD',
        input_per_million: 5,
        output_per_million: 25,
        cache_write_5m_per_million: 6.25,
        cache_write_1h_per_million: 10,
        cached_input_per_million: 0.5,
      },
      'claude-opus-4-1': {
        currency: 'USD',
        input_per_million: 15,
        output_per_million: 75,
        cache_write_5m_per_million: 18.75,
        cache_write_1h_per_million: 30,
        cached_input_per_million: 1.5,
      },
      'claude-opus-4': {
        currency: 'USD',
        notes: 'deprecated',
        input_per_million: 15,
        output_per_million: 75,
        cache_write_5m_per_million: 18.75,
        cache_write_1h_per_million: 30,
        cached_input_per_million: 1.5,
      },
      'claude-sonnet-4-6': {
        currency: 'USD',
        input_per_million: 3,
        output_per_million: 15,
        cache_write_5m_per_million: 3.75,
        cache_write_1h_per_million: 6,
        cached_input_per_million: 0.3,
      },
      'claude-sonnet-4-5': {
        currency: 'USD',
        input_per_million: 3,
        output_per_million: 15,
        cache_write_5m_per_million: 3.75,
        cache_write_1h_per_million: 6,
        cached_input_per_million: 0.3,
      },
      'claude-sonnet-4': {
        currency: 'USD',
        notes: 'deprecated',
        input_per_million: 3,
        output_per_million: 15,
        cache_write_5m_per_million: 3.75,
        cache_write_1h_per_million: 6,
        cached_input_per_million: 0.3,
      },
      'claude-haiku-4-5': {
        currency: 'USD',
        input_per_million: 1,
        output_per_million: 5,
        cache_write_5m_per_million: 1.25,
        cache_write_1h_per_million: 2,
        cached_input_per_million: 0.1,
      },
      'claude-haiku-3-5': {
        currency: 'USD',
        notes: 'retired except on Bedrock/Vertex',
        input_per_million: 0.8,
        output_per_million: 4,
        cache_write_5m_per_million: 1,
        cache_write_1h_per_million: 1.6,
        cached_input_per_million: 0.08,
      },
    },
  },
};
