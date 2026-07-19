import { describe, expect, it } from 'vitest';
import { normalizeTraeCnUsage } from '../../trae-sync.js';

describe('normalizeTraeCnUsage', () => {
  it('splits prompt/completion totals into exclusive AIUsage token buckets', () => {
    const result = normalizeTraeCnUsage({
      messageId: 'message-1',
      timestamp: '2026-01-28T12:00:00Z',
      model: 'Claude Sonnet 4.6',
      promptTokens: 115_271,
      completionTokens: 2_944,
      reasoningTokens: 159,
      cacheReadInputTokens: 102_912,
      cacheCreationInputTokens: 0,
      totalTokens: 118_215,
    });

    expect(result).toEqual({
      messageId: 'message-1',
      timestamp: '2026-01-28T12:00:00Z',
      model: 'claude-sonnet-4.6',
      inputTokens: 12_359,
      cachedInputTokens: 102_912,
      cacheWriteTokens: 0,
      outputTokens: 2_944,
      reasoningOutputTokens: 0,
    });
    expect(Object.values(result!).filter(value => typeof value === 'number').reduce((a, b) => a + b, 0))
      .toBe(118_215);
  });

  it('falls back to total_tokens only when detailed counters are absent', () => {
    expect(normalizeTraeCnUsage({
      messageId: 'message-2',
      timestamp: 1784289600000,
      totalTokens: 42,
    })).toMatchObject({
      inputTokens: 42,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  });
});
