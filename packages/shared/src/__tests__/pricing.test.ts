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
    ['anthropic', 'claude-code', 'claude-opus-4-8', 30], // 5 + 25
    ['anthropic', 'claude-code', 'claude-opus-4-7', 30], // 5 + 25
    ['anthropic', 'claude-code', 'claude-fable-5', 60], // 10 + 50
    ['anthropic', 'claude-code', 'claude-sonnet-5', 12], // current intro: 2 + 10
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

  it('Claude Fable 5 includes cache read/write pricing', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-fable-5', {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      cacheWriteTokens: 1_500_000,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 500_000,
      outputTokens: 200_000,
    });
    // 10 + 1 + 12.5 + 10 + 10 = $43.5
    expect(r.estimatedCostUsd).toBe(43.5);
    expect(r.costStatus).toBe('exact');
  });

  it('Claude Sonnet 5 includes current introductory cache read/write pricing', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-sonnet-5', {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      cacheWriteTokens: 1_500_000,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 500_000,
      outputTokens: 200_000,
    });
    // 2 + 0.2 + 2.5 + 2 + 2 = $8.7
    expect(r.estimatedCostUsd).toBe(8.7);
    expect(r.costStatus).toBe('exact');
  });

  it('版本后缀别名（alias）解析为 exact', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-opus-4-7-20260201', tokens);
    expect(r.resolvedModel).toBe('claude-opus-4-7');
    expect(r.costStatus).toBe('exact');
  });

  it('语义化未知后缀触发前缀回退（estimated）', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6-bedrock', tokens);
    expect(r.resolvedModel).toBe('claude-sonnet-4-6');
    expect(r.costStatus).toBe('estimated');
  });

  it('纯日期后缀视为独立版本，未登记则 unavailable（不再静默回退）', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6-20260101', tokens);
    expect(r.costStatus).toBe('unavailable');
  });
});

// ─── 跨档防护（fallback 不应跨版本号档位）───

describe('跨档防护', () => {
  const tokens = {
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1_000_000,
  };

  it('已知 claude-opus-4-7 不应回退到 claude-opus-4（即便都在表中）', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-opus-4-7', tokens);
    expect(r.resolvedModel).toBe('claude-opus-4-7');
    expect(r.costStatus).toBe('exact');
  });

  it('已登记的 claude-opus-4-8 命中 exact 而非吞到 claude-opus-4', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-opus-4-8', tokens);
    expect(r.resolvedModel).toBe('claude-opus-4-8');
    expect(r.costStatus).toBe('exact');
  });

  it('未来未登记的 claude-opus-4-9 应返回 unavailable 而非吞到 claude-opus-4', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-opus-4-9', tokens);
    expect(r.costStatus).toBe('unavailable');
    expect(r.estimatedCostUsd).toBe(0);
  });

  it('claude-sonnet-4-9 同理拒绝跨档', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-9', tokens);
    expect(r.costStatus).toBe('unavailable');
  });

  it('带语义后缀（非纯数字）的版本可以回退', () => {
    const r = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6-bedrock', tokens);
    expect(r.resolvedModel).toBe('claude-sonnet-4-6');
    expect(r.costStatus).toBe('estimated');
  });
});

// ─── Fast 模式白名单 ───

describe('Fast 模式白名单', () => {
  const tokens = {
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1_000_000,
  };

  it('Opus 4.8-fast 应 ×6', () => {
    const fast = calculateCost('anthropic', 'claude-code', 'claude-opus-4-8-fast', tokens);
    const normal = calculateCost('anthropic', 'claude-code', 'claude-opus-4-8', tokens);
    expect(fast.estimatedCostUsd).toBeCloseTo(normal.estimatedCostUsd * 6, 3);
  });

  it('Opus 4.7-fast 应 ×6', () => {
    const fast = calculateCost('anthropic', 'claude-code', 'claude-opus-4-7-fast', tokens);
    const normal = calculateCost('anthropic', 'claude-code', 'claude-opus-4-7', tokens);
    expect(fast.estimatedCostUsd).toBeCloseTo(normal.estimatedCostUsd * 6, 3);
  });

  it('Opus 4.6-fast 应 ×6', () => {
    const fast = calculateCost('anthropic', 'claude-code', 'claude-opus-4-6-fast', tokens);
    const normal = calculateCost('anthropic', 'claude-code', 'claude-opus-4-6', tokens);
    expect(fast.estimatedCostUsd).toBeCloseTo(normal.estimatedCostUsd * 6, 3);
  });

  it('Sonnet-fast 不应 ×6（官方不支持）', () => {
    const fast = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6-fast', tokens);
    const normal = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6', tokens);
    expect(fast.estimatedCostUsd).toBe(normal.estimatedCostUsd);
  });

  it('Haiku-fast 不应 ×6', () => {
    const fast = calculateCost('anthropic', 'claude-code', 'claude-haiku-4-5-fast', tokens);
    const normal = calculateCost('anthropic', 'claude-code', 'claude-haiku-4-5', tokens);
    expect(fast.estimatedCostUsd).toBe(normal.estimatedCostUsd);
  });

  it('Gemini-fast 不应 ×6', () => {
    const fast = calculateCost('google', 'gemini-cli', 'gemini-2.5-flash-fast', tokens);
    const normal = calculateCost('google', 'gemini-cli', 'gemini-2.5-flash', tokens);
    expect(fast.estimatedCostUsd).toBe(normal.estimatedCostUsd);
  });

  it('Codex GPT-5.5 priority 应 ×2.5', () => {
    const priority = calculateCost('openai', 'codex', 'gpt-5.5-priority', tokens);
    const normal = calculateCost('openai', 'codex', 'gpt-5.5', tokens);
    expect(priority.estimatedCostUsd).toBeCloseTo(normal.estimatedCostUsd * 2.5, 3);
  });

  it('Codex GPT-5.4 fast 应 ×2', () => {
    const fast = calculateCost('openai', 'codex', 'gpt-5.4-fast', tokens);
    const normal = calculateCost('openai', 'codex', 'gpt-5.4', tokens);
    expect(fast.estimatedCostUsd).toBeCloseTo(normal.estimatedCostUsd * 2, 3);
  });

  it('Codex GPT-5-Codex fast 暂无官方倍率时不放大', () => {
    const fast = calculateCost('openai', 'codex', 'gpt-5-codex-fast', tokens);
    const normal = calculateCost('openai', 'codex', 'gpt-5-codex', tokens);
    expect(fast.estimatedCostUsd).toBe(normal.estimatedCostUsd);
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
