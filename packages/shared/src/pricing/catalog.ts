import type { PricingCatalog } from './types.js';
import { anthropic } from './data/anthropic.js';
import { openai } from './data/openai.js';
import { google } from './data/google.js';
import { moonshot } from './data/moonshot.js';
import { alibaba } from './data/alibaba.js';
import { deepseek } from './data/deepseek.js';
import { zhipu } from './data/zhipu.js';
import { github } from './data/github.js';
import { sourcegraph } from './data/sourcegraph.js';
import { inflection, cursor, droid, opencode } from './data/placeholders.js';

export const PRICING_VERSION = '2026-05-24-unified-v1';

/**
 * 模型别名（精确匹配优先于前缀回退）。
 * key = 出现在数据里的 raw model 名，value = 标准 model 名。
 */
const aliases: Record<string, string> = {
  'claude-opus-4-7-20260201': 'claude-opus-4-7',
  'claude-sonnet-4-6-20250301': 'claude-sonnet-4-6',
  'claude-opus-4-6-20250301': 'claude-opus-4-6',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
  'claude-sonnet-4.6': 'claude-sonnet-4-6',
  'codex-auto-review': 'gpt-5.4',
};

export const catalog: PricingCatalog = {
  version: PRICING_VERSION,
  // 汇率（1 USD ≈ N CNY）。Worker 启动时可被 env 覆盖。
  fx: {
    CNY: 7.2,
  },
  aliases,
  providers: {
    anthropic,
    openai,
    google,
    moonshot,
    alibaba,
    deepseek,
    zhipu,
    github,
    sourcegraph,
    inflection,
    cursor,
    droid,
    opencode,
  },
};

export function getPricingCatalog(): PricingCatalog {
  return catalog;
}
