import { describe, it, expect } from 'vitest';
import { calculateCost, catalog } from '../pricing/index.js';

// ─── 结构完整性 ───

describe('catalog 结构', () => {
  it('catalog.version 与 fx 已配置', () => {
    expect(catalog.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(catalog.fx.CNY).toBeGreaterThan(0);
  });

  it('每个 scanner 涉及的 (provider, product) 都存在于 catalog', () => {
    const required: Array<[string, string]> = [
      ['anthropic', 'claude-code'],
      ['openai', 'codex'],
      ['google', 'gemini-cli'],
      ['google', 'antigravity'],
      ['github', 'copilot-cli'],
      ['github', 'copilot-vscode'],
      ['moonshot', 'kimi-code'],
      ['alibaba', 'qwen-code'],
      ['sourcegraph', 'amp'],
      ['inflection', 'pi'],
      ['cursor', 'cursor'],
      ['droid', 'droid'],
      ['opencode', 'opencode'],
    ];
    const missing = required.filter(([p, pr]) => !catalog.providers[p]?.[pr]);
    expect(missing).toEqual([]);
  });
});

// ─── 关键模型定价能解析 ───

describe('calculateCost — 关键模型', () => {
  const tokens = {
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1_000_000,
  };

  it.each([
    ['anthropic', 'claude-code', 'claude-opus-4-7', 30], // 5 + 25
    ['anthropic', 'claude-code', 'claude-sonnet-4-6', 18],
    ['openai', 'codex', 'gpt-5.4', 17.5], // 2.5 + 15
    ['openai', 'codex', 'gpt-5.5-pro', 210], // 30 + 180
    ['openai', 'codex', 'o3-deep-research', 25], // 5 + 20，修正后
    ['openai', 'codex', 'computer-use-preview', 7.5], // 1.5 + 6，修正后
    ['google', 'gemini-cli', 'gemini-2.5-flash', 2.8], // 0.30 + 2.50，修正后
  ])('%s/%s/%s 应等于 $%s', (provider, product, model, expected) => {
    const r = calculateCost(provider, product, model, tokens);
    expect(r.costStatus).toBe('exact');
    expect(r.estimatedCostUsd).toBeCloseTo(expected, 4);
  });

  it('未知模型返回 unavailable', () => {
    const r = calculateCost('anthropic', 'claude-code', 'totally-unknown', tokens);
    expect(r.costStatus).toBe('unavailable');
    expect(r.estimatedCostUsd).toBe(0);
  });

  it('版本后缀别名（alias）解析为 exact', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-opus-4-7-20260201', tokens);
    expect(r.resolvedModel).toBe('claude-opus-4-7');
    expect(r.costStatus).toBe('exact');
  });

  it('未知后缀触发前缀回退（estimated）', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6-20260101', tokens);
    expect(r.resolvedModel).toBe('claude-sonnet-4-6');
    expect(r.costStatus).toBe('estimated');
  });
});

// ─── 多币种折算 ───

describe('多币种折算', () => {
  it('Kimi K2.6 CNY 价应被折算成 USD（按 fx.CNY=7.2）', () => {
    const r = calculateCost('moonshot', 'kimi-code', 'kimi-k2.6', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    // input ¥6.5 + output ¥27 = ¥33.5 → $4.6528
    expect(r.estimatedCostUsd).toBeCloseTo(33.5 / 7.2, 3);
    expect(r.costStatus).toBe('exact');
  });

  it('DeepSeek v4-flash 已是 USD，不折算', () => {
    const r = calculateCost('deepseek', 'deepseek-chat', 'deepseek-v4-flash', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    // 0.14 + 0.28 = 0.42
    expect(r.estimatedCostUsd).toBeCloseTo(0.42, 4);
  });
});

// ─── 阶梯定价 ───

describe('阶梯定价', () => {
  it('Qwen3-coder-plus ≤32K 命中第 0 档', () => {
    const r = calculateCost('alibaba', 'qwen-code', 'qwen3-coder-plus', {
      inputTokens: 10_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5_000,
    });
    expect(r.matchedTierIndex).toBe(0);
    // (10000/1e6)*4 + (5000/1e6)*16 = 0.04 + 0.08 = 0.12 ¥ → /7.2 ≈ 0.0167
    expect(r.estimatedCostUsd).toBeCloseTo(0.12 / 7.2, 3);
  });

  it('Qwen3-coder-plus >128K 命中第 2 档', () => {
    const r = calculateCost('alibaba', 'qwen-code', 'qwen3-coder-plus', {
      inputTokens: 200_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1000,
    });
    expect(r.matchedTierIndex).toBe(2);
  });

  it('Gemini 2.5 Pro ≤200K 命中低价档', () => {
    const r = calculateCost('google', 'gemini-cli', 'gemini-2.5-pro', {
      inputTokens: 100_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 50_000,
    });
    expect(r.matchedTierIndex).toBe(0);
    // 100K*$1.25/M + 50K*$10/M = 0.125 + 0.5 = $0.625
    expect(r.estimatedCostUsd).toBeCloseTo(0.625, 4);
  });

  it('Gemini 2.5 Pro >200K 命中高价档', () => {
    const r = calculateCost('google', 'gemini-cli', 'gemini-2.5-pro', {
      inputTokens: 500_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000,
    });
    expect(r.matchedTierIndex).toBe(1);
  });
});
