import type { CostStatus } from '@aiusage/shared';

export interface ModelPricing {
  input_per_million_usd: number;
  output_per_million_usd: number;
  cached_input_per_million_usd: number | null;
  cache_write_5m_per_million_usd: number;
  cache_write_1h_per_million_usd: number;
}

export interface PricingCatalog {
  version: string;
  aliases: Record<string, string>;
  providers: Record<string, Record<string, { models: Record<string, ModelPricing> }>>;
}

// 第一版内置定价目录，后续可改为读取 JSON 文件或 KV
const catalog: PricingCatalog = {
  version: '2026-04-01-official-v2',
  aliases: {
    'claude-sonnet-4-6-20250301': 'claude-sonnet-4-6',
    'claude-opus-4-6-20250301': 'claude-opus-4-6',
    'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
  },
  providers: {
    anthropic: {
      'claude-code': {
        models: {
          'claude-sonnet-4-6': {
            input_per_million_usd: 3,
            output_per_million_usd: 15,
            cache_write_5m_per_million_usd: 3.75,
            cache_write_1h_per_million_usd: 6,
            cached_input_per_million_usd: 0.3,
          },
          'claude-sonnet-4-5': {
            input_per_million_usd: 3,
            output_per_million_usd: 15,
            cache_write_5m_per_million_usd: 3.75,
            cache_write_1h_per_million_usd: 6,
            cached_input_per_million_usd: 0.3,
          },
          'claude-sonnet-4': {
            input_per_million_usd: 3,
            output_per_million_usd: 15,
            cache_write_5m_per_million_usd: 3.75,
            cache_write_1h_per_million_usd: 6,
            cached_input_per_million_usd: 0.3,
          },
          'claude-sonnet-3.7': {
            input_per_million_usd: 3,
            output_per_million_usd: 15,
            cache_write_5m_per_million_usd: 3.75,
            cache_write_1h_per_million_usd: 6,
            cached_input_per_million_usd: 0.3,
          },
          'claude-opus-4-6': {
            input_per_million_usd: 5,
            output_per_million_usd: 25,
            cache_write_5m_per_million_usd: 6.25,
            cache_write_1h_per_million_usd: 10,
            cached_input_per_million_usd: 0.5,
          },
          'claude-opus-4-5': {
            input_per_million_usd: 5,
            output_per_million_usd: 25,
            cache_write_5m_per_million_usd: 6.25,
            cache_write_1h_per_million_usd: 10,
            cached_input_per_million_usd: 0.5,
          },
          'claude-opus-4-1': {
            input_per_million_usd: 15,
            output_per_million_usd: 75,
            cache_write_5m_per_million_usd: 18.75,
            cache_write_1h_per_million_usd: 30,
            cached_input_per_million_usd: 1.5,
          },
          'claude-opus-4': {
            input_per_million_usd: 15,
            output_per_million_usd: 75,
            cache_write_5m_per_million_usd: 18.75,
            cache_write_1h_per_million_usd: 30,
            cached_input_per_million_usd: 1.5,
          },
          'claude-opus-3': {
            input_per_million_usd: 15,
            output_per_million_usd: 75,
            cache_write_5m_per_million_usd: 18.75,
            cache_write_1h_per_million_usd: 30,
            cached_input_per_million_usd: 1.5,
          },
          'claude-haiku-4-5': {
            input_per_million_usd: 1,
            output_per_million_usd: 5,
            cache_write_5m_per_million_usd: 1.25,
            cache_write_1h_per_million_usd: 2,
            cached_input_per_million_usd: 0.1,
          },
          'claude-haiku-3-5': {
            input_per_million_usd: 0.8,
            output_per_million_usd: 4,
            cache_write_5m_per_million_usd: 1,
            cache_write_1h_per_million_usd: 1.6,
            cached_input_per_million_usd: 0.08,
          },
          'claude-haiku-3': {
            input_per_million_usd: 0.25,
            output_per_million_usd: 1.25,
            cache_write_5m_per_million_usd: 0.3,
            cache_write_1h_per_million_usd: 0.5,
            cached_input_per_million_usd: 0.03,
          },
        },
      },
    },
    openai: {
      codex: {
        models: {
          'gpt-5.4-pro': {
            input_per_million_usd: 30,
            output_per_million_usd: 180,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.4': {
            input_per_million_usd: 2.5,
            output_per_million_usd: 15,
            cached_input_per_million_usd: 0.25,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.4-mini': {
            input_per_million_usd: 0.75,
            output_per_million_usd: 4.5,
            cached_input_per_million_usd: 0.075,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.4-nano': {
            input_per_million_usd: 0.2,
            output_per_million_usd: 1.25,
            cached_input_per_million_usd: 0.02,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.2-pro': {
            input_per_million_usd: 21,
            output_per_million_usd: 168,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.2': {
            input_per_million_usd: 1.75,
            output_per_million_usd: 14,
            cached_input_per_million_usd: 0.175,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.3-codex': {
            input_per_million_usd: 1.75,
            output_per_million_usd: 14,
            cached_input_per_million_usd: 0.175,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.2-codex': {
            input_per_million_usd: 1.75,
            output_per_million_usd: 14,
            cached_input_per_million_usd: 0.175,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.1-codex-max': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 0.125,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.1-codex-mini': {
            input_per_million_usd: 0.25,
            output_per_million_usd: 2,
            cached_input_per_million_usd: 0.025,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.1-codex': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 0.125,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5.1': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 0.125,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5-pro': {
            input_per_million_usd: 15,
            output_per_million_usd: 120,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5-mini': {
            input_per_million_usd: 0.25,
            output_per_million_usd: 2,
            cached_input_per_million_usd: 0.025,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5-nano': {
            input_per_million_usd: 0.05,
            output_per_million_usd: 0.4,
            cached_input_per_million_usd: 0.005,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5-codex': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 0.125,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-5': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 0.125,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4.1': {
            input_per_million_usd: 2,
            output_per_million_usd: 8,
            cached_input_per_million_usd: 0.5,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4.1-mini': {
            input_per_million_usd: 0.4,
            output_per_million_usd: 1.6,
            cached_input_per_million_usd: 0.1,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4.1-nano': {
            input_per_million_usd: 0.1,
            output_per_million_usd: 0.4,
            cached_input_per_million_usd: 0.025,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4o-2024-05-13': {
            input_per_million_usd: 5,
            output_per_million_usd: 15,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4o': {
            input_per_million_usd: 2.5,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 1.25,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4o-mini': {
            input_per_million_usd: 0.15,
            output_per_million_usd: 0.6,
            cached_input_per_million_usd: 0.075,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o1-pro': {
            input_per_million_usd: 150,
            output_per_million_usd: 600,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o1': {
            input_per_million_usd: 15,
            output_per_million_usd: 60,
            cached_input_per_million_usd: 7.5,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o3-pro': {
            input_per_million_usd: 20,
            output_per_million_usd: 80,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o3': {
            input_per_million_usd: 2,
            output_per_million_usd: 8,
            cached_input_per_million_usd: 0.5,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o4-mini': {
            input_per_million_usd: 1.1,
            output_per_million_usd: 4.4,
            cached_input_per_million_usd: 0.275,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o3-mini': {
            input_per_million_usd: 1.1,
            output_per_million_usd: 4.4,
            cached_input_per_million_usd: 0.55,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o1-mini': {
            input_per_million_usd: 1.1,
            output_per_million_usd: 4.4,
            cached_input_per_million_usd: 0.55,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4-turbo-2024-04-09': {
            input_per_million_usd: 10,
            output_per_million_usd: 30,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4-0125-preview': {
            input_per_million_usd: 10,
            output_per_million_usd: 30,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4-1106-preview': {
            input_per_million_usd: 10,
            output_per_million_usd: 30,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4-1106-vision-preview': {
            input_per_million_usd: 10,
            output_per_million_usd: 30,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4-0613': {
            input_per_million_usd: 30,
            output_per_million_usd: 60,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4-0314': {
            input_per_million_usd: 30,
            output_per_million_usd: 60,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4-32k': {
            input_per_million_usd: 60,
            output_per_million_usd: 120,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-3.5-turbo': {
            input_per_million_usd: 0.5,
            output_per_million_usd: 1.5,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-3.5-turbo-0125': {
            input_per_million_usd: 0.5,
            output_per_million_usd: 1.5,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-3.5-turbo-1106': {
            input_per_million_usd: 1,
            output_per_million_usd: 2,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-3.5-turbo-0613': {
            input_per_million_usd: 1.5,
            output_per_million_usd: 2,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-3.5-0301': {
            input_per_million_usd: 1.5,
            output_per_million_usd: 2,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-3.5-turbo-instruct': {
            input_per_million_usd: 1.5,
            output_per_million_usd: 2,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-3.5-turbo-16k-0613': {
            input_per_million_usd: 3,
            output_per_million_usd: 4,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'davinci-002': {
            input_per_million_usd: 2,
            output_per_million_usd: 2,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'babbage-002': {
            input_per_million_usd: 0.4,
            output_per_million_usd: 0.4,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o3-deep-research': {
            input_per_million_usd: 10,
            output_per_million_usd: 40,
            cached_input_per_million_usd: 2.5,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o4-mini-deep-research': {
            input_per_million_usd: 2,
            output_per_million_usd: 8,
            cached_input_per_million_usd: 0.5,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'computer-use-preview': {
            input_per_million_usd: 3,
            output_per_million_usd: 12,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'text-embedding-3-small': {
            input_per_million_usd: 0.02,
            output_per_million_usd: 0,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'text-embedding-3-large': {
            input_per_million_usd: 0.13,
            output_per_million_usd: 0,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'text-embedding-ada-002': {
            input_per_million_usd: 0.1,
            output_per_million_usd: 0,
            cached_input_per_million_usd: null,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
        },
      },
    },
    google: {
      'gemini-cli': {
        models: {
          'gemini-2.5-pro': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 0.31,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gemini-2.5-flash': {
            input_per_million_usd: 0.15,
            output_per_million_usd: 0.6,
            cached_input_per_million_usd: 0.0375,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gemini-2.0-flash': {
            input_per_million_usd: 0.1,
            output_per_million_usd: 0.4,
            cached_input_per_million_usd: 0.025,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gemini-1.5-pro': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 5,
            cached_input_per_million_usd: 0.3125,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gemini-1.5-flash': {
            input_per_million_usd: 0.075,
            output_per_million_usd: 0.3,
            cached_input_per_million_usd: 0.01875,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
        },
      },
    },
    github: {
      'copilot-cli': {
        models: {
          'gpt-4o': {
            input_per_million_usd: 2.5,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 1.25,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gpt-4o-mini': {
            input_per_million_usd: 0.15,
            output_per_million_usd: 0.6,
            cached_input_per_million_usd: 0.075,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'claude-sonnet-4': {
            input_per_million_usd: 3,
            output_per_million_usd: 15,
            cached_input_per_million_usd: 0.3,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'o3-mini': {
            input_per_million_usd: 1.1,
            output_per_million_usd: 4.4,
            cached_input_per_million_usd: 0.55,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gemini-2.0-flash': {
            input_per_million_usd: 0.1,
            output_per_million_usd: 0.4,
            cached_input_per_million_usd: 0.025,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
        },
      },
    },
    sourcegraph: {
      amp: {
        models: {
          'claude-sonnet-4': {
            input_per_million_usd: 3,
            output_per_million_usd: 15,
            cached_input_per_million_usd: 0.3,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'claude-sonnet-3.7': {
            input_per_million_usd: 3,
            output_per_million_usd: 15,
            cached_input_per_million_usd: 0.3,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
          'gemini-2.5-pro': {
            input_per_million_usd: 1.25,
            output_per_million_usd: 10,
            cached_input_per_million_usd: 0.31,
            cache_write_5m_per_million_usd: 0,
            cache_write_1h_per_million_usd: 0,
          },
        },
      },
    },
  },
};

export function getPricingCatalog(): PricingCatalog {
  return catalog;
}

function resolveModelPricing(
  provider: string,
  product: string,
  model: string,
): { resolvedModel: string; pricing: ModelPricing } | null {
  const models = catalog.providers[provider]?.[product]?.models;
  if (!models) return null;

  const aliasResolved = catalog.aliases[model];
  if (aliasResolved && models[aliasResolved]) {
    return { resolvedModel: aliasResolved, pricing: models[aliasResolved] };
  }

  if (models[model]) {
    return { resolvedModel: model, pricing: models[model] };
  }

  for (const knownModel of Object.keys(models).sort((a, b) => b.length - a.length)) {
    if (model.startsWith(`${knownModel}-`)) {
      return { resolvedModel: knownModel, pricing: models[knownModel] };
    }
  }

  return null;
}

interface CostResult {
  estimatedCostUsd: number;
  costStatus: CostStatus;
  pricingVersion: string;
}

const FAST_MULTIPLIER = 6;

export function calculateCost(
  provider: string,
  product: string,
  model: string,
  tokens: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    cacheWrite5mTokens?: number;
    cacheWrite1hTokens?: number;
    outputTokens: number;
  },
): CostResult {
  const totalTokens =
    tokens.inputTokens +
    tokens.cachedInputTokens +
    tokens.cacheWriteTokens +
    tokens.outputTokens;

  if (totalTokens === 0) {
    return { estimatedCostUsd: 0, costStatus: 'exact', pricingVersion: catalog.version };
  }

  // 检测 fast 模式（model 名以 -fast 结尾）
  const isFast = model.endsWith('-fast');
  const baseModel = isFast ? model.replace(/-fast$/, '') : model;

  const resolved = resolveModelPricing(provider, product, baseModel);

  if (!resolved) {
    return { estimatedCostUsd: 0, costStatus: 'unavailable', pricingVersion: catalog.version };
  }

  const { resolvedModel, pricing } = resolved;
  const costStatus: CostStatus = resolvedModel !== baseModel ? 'estimated' : 'exact';

  const cost =
    (tokens.inputTokens / 1_000_000) * pricing.input_per_million_usd +
    (tokens.cachedInputTokens / 1_000_000) * (pricing.cached_input_per_million_usd ?? 0) +
    ((tokens.cacheWrite5mTokens ?? tokens.cacheWriteTokens) / 1_000_000) * pricing.cache_write_5m_per_million_usd +
    ((tokens.cacheWrite1hTokens ?? 0) / 1_000_000) * pricing.cache_write_1h_per_million_usd +
    (tokens.outputTokens / 1_000_000) * pricing.output_per_million_usd;

  const finalCost = isFast ? cost * FAST_MULTIPLIER : cost;

  return {
    estimatedCostUsd: Math.round(finalCost * 10000) / 10000,
    costStatus,
    pricingVersion: catalog.version,
  };
}

export function getWorstCostStatus(statuses: CostStatus[]): CostStatus {
  if (statuses.includes('unavailable')) return 'unavailable';
  if (statuses.includes('estimated')) return 'estimated';
  return 'exact';
}
