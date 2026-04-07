// NOTE: vitest 尚未添加到 @aiusage/worker devDependencies，运行前需执行：
//   pnpm --filter @aiusage/worker add -D vitest

import { describe, it, expect } from 'vitest';
import { calculateCost, getPricingCatalog, getWorstCostStatus } from '../utils/pricing.js';

// ─── getPricingCatalog ───

describe('getPricingCatalog', () => {
  it('返回包含 version 和 providers 的定价目录', () => {
    const catalog = getPricingCatalog();
    expect(catalog.version).toBeTruthy();
    expect(catalog.providers).toBeDefined();
    expect(catalog.providers.anthropic).toBeDefined();
    expect(catalog.providers.openai).toBeDefined();
  });
});

// ─── calculateCost: 基本计费 ───

describe('calculateCost: 基本计费', () => {
  it('Claude haiku-4-5 基本 input/output 计费', () => {
    // haiku-4-5: input=$1/M, output=$5/M
    const result = calculateCost('anthropic', 'claude-code', 'claude-haiku-4-5', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    // 1*1 + 5*1 = $6
    expect(result.estimatedCostUsd).toBe(6);
    expect(result.costStatus).toBe('exact');
    expect(result.pricingVersion).toBeTruthy();
  });

  it('Claude opus-4-6 基本 input/output 计费', () => {
    // opus-4-6: input=$5/M, output=$25/M
    const result = calculateCost('anthropic', 'claude-code', 'claude-opus-4-6', {
      inputTokens: 500_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 200_000,
    });
    // 0.5*5 + 0.2*25 = 2.5 + 5 = $7.5
    expect(result.estimatedCostUsd).toBe(7.5);
    expect(result.costStatus).toBe('exact');
  });

  it('Codex gpt-5.4 基本 input/output 计费', () => {
    // gpt-5.4: input=$2.5/M, output=$15/M
    const result = calculateCost('openai', 'codex', 'gpt-5.4', {
      inputTokens: 2_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500_000,
    });
    // 2*2.5 + 0.5*15 = 5 + 7.5 = $12.5
    expect(result.estimatedCostUsd).toBe(12.5);
    expect(result.costStatus).toBe('exact');
  });
});

// ─── calculateCost: cached input ───

describe('calculateCost: cached input', () => {
  it('包含 cached input 的计费使用缓存价格', () => {
    // haiku-4-5: input=$1/M, cached=$0.1/M, output=$5/M
    const result = calculateCost('anthropic', 'claude-code', 'claude-haiku-4-5', {
      inputTokens: 200_000,
      cachedInputTokens: 800_000,
      cacheWriteTokens: 0,
      outputTokens: 100_000,
    });
    // 0.2*1 + 0.8*0.1 + 0.1*5 = 0.2 + 0.08 + 0.5 = $0.78
    expect(result.estimatedCostUsd).toBe(0.78);
    expect(result.costStatus).toBe('exact');
  });
});

// ─── calculateCost: cache_write_5m / cache_write_1h ───

describe('calculateCost: cache write tokens', () => {
  it('包含 cache_write_5m 和 cache_write_1h 的计费', () => {
    // sonnet-4-6: cache_write_5m=$3.75/M, cache_write_1h=$6/M
    // cacheWriteTokens 必须非零，否则 totalTokens=0 会短路返回
    const result = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6', {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 1_500_000, // 5m + 1h 总和
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 500_000,
      outputTokens: 0,
    });
    // 1*3.75 + 0.5*6 = 3.75 + 3 = $6.75
    expect(result.estimatedCostUsd).toBe(6.75);
    expect(result.costStatus).toBe('exact');
  });

  it('未提供 cacheWrite5mTokens 时回退到 cacheWriteTokens', () => {
    // sonnet-4-6: cache_write_5m=$3.75/M
    const result = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6', {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 1_000_000,
      // 不提供 cacheWrite5mTokens
      outputTokens: 0,
    });
    // fallback: cacheWriteTokens 用于 5m 价格 → 1*3.75 = $3.75
    expect(result.estimatedCostUsd).toBe(3.75);
  });
});

// ─── calculateCost: 模型别名解析 ───

describe('calculateCost: 模型别名解析', () => {
  it('claude-haiku-4-5-20251001 解析为 claude-haiku-4-5', () => {
    const aliased = calculateCost('anthropic', 'claude-code', 'claude-haiku-4-5-20251001', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    const direct = calculateCost('anthropic', 'claude-code', 'claude-haiku-4-5', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    expect(aliased.estimatedCostUsd).toBe(direct.estimatedCostUsd);
    // 别名解析后 resolvedModel !== baseModel，status 为 estimated
    expect(aliased.costStatus).toBe('estimated');
  });
});

// ─── calculateCost: 模型前缀匹配 ───

describe('calculateCost: 模型前缀匹配', () => {
  it('claude-sonnet-4-6-20260101 前缀匹配 claude-sonnet-4-6', () => {
    const prefixed = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6-20260101', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    const direct = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    expect(prefixed.estimatedCostUsd).toBe(direct.estimatedCostUsd);
    // 前缀匹配时 resolvedModel !== baseModel，应返回 estimated
    expect(prefixed.costStatus).toBe('estimated');
  });
});

// ─── calculateCost: fast 模式 ───

describe('calculateCost: fast 模式', () => {
  it('model 以 -fast 结尾时费用乘以 6', () => {
    const normal = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    const fast = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6-fast', {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    });
    // fast = normal * 6
    expect(fast.estimatedCostUsd).toBe(
      Math.round(normal.estimatedCostUsd * 6 * 10000) / 10000,
    );
  });
});

// ─── calculateCost: 未知模型 ───

describe('calculateCost: 未知模型', () => {
  it('未知模型返回 cost=0, costStatus=unavailable', () => {
    const result = calculateCost('anthropic', 'claude-code', 'totally-unknown-model', {
      inputTokens: 500_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500_000,
    });
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.costStatus).toBe('unavailable');
  });

  it('未知 provider 返回 unavailable', () => {
    const result = calculateCost('unknown-provider', 'unknown-product', 'some-model', {
      inputTokens: 100_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 100_000,
    });
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.costStatus).toBe('unavailable');
  });
});

// ─── calculateCost: 全零 token ───

describe('calculateCost: 全零 token', () => {
  it('所有 token 为 0 时返回 cost=0, costStatus=exact', () => {
    const result = calculateCost('anthropic', 'claude-code', 'claude-sonnet-4-6', {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.costStatus).toBe('exact');
  });
});

// ─── getWorstCostStatus ───

describe('getWorstCostStatus', () => {
  it('全部 exact → exact', () => {
    expect(getWorstCostStatus(['exact', 'exact', 'exact'])).toBe('exact');
  });

  it('包含 estimated → estimated', () => {
    expect(getWorstCostStatus(['exact', 'estimated', 'exact'])).toBe('estimated');
  });

  it('包含 unavailable → unavailable（优先级最高）', () => {
    expect(getWorstCostStatus(['exact', 'estimated', 'unavailable'])).toBe('unavailable');
  });

  it('空数组 → exact', () => {
    expect(getWorstCostStatus([])).toBe('exact');
  });
});
