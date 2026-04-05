import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanAnthropicApiDates, chunkDateRange } from '../anthropic-admin-api.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeBucket(date: string, results: Array<{
  model: string;
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  output_tokens?: number;
}>) {
  return {
    starting_at: `${date}T00:00:00Z`,
    ending_at: `${date}T00:00:00Z`, // ignored in parsing
    results: results.map(r => ({
      model: r.model,
      uncached_input_tokens: r.uncached_input_tokens ?? 0,
      cache_read_input_tokens: r.cache_read_input_tokens ?? 0,
      cache_creation: r.cache_creation ?? {},
      output_tokens: r.output_tokens ?? 0,
    })),
  };
}

function mockFetch(pages: object[]) {
  let callCount = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const page = pages[callCount++] ?? { data: [], has_more: false, next_page: null };
    return {
      ok: true,
      json: async () => page,
    };
  }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── chunkDateRange ──────────────────────────────────────────────────────────

describe('chunkDateRange', () => {
  it('returns single chunk for ≤31 days', () => {
    const chunks = chunkDateRange('2025-11-01', '2025-11-30');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startingAt).toBe('2025-11-01T00:00:00Z');
    expect(chunks[0].endingAt).toBe('2025-12-01T00:00:00Z'); // endDate+1 day
  });

  it('splits into multiple chunks for >31 days', () => {
    const chunks = chunkDateRange('2025-11-01', '2026-01-08'); // 69 days
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks together should cover the full range
    expect(chunks[0].startingAt).toBe('2025-11-01T00:00:00Z');
    const lastEnd = chunks[chunks.length - 1].endingAt;
    expect(lastEnd).toBe('2026-01-09T00:00:00Z'); // day after endDate
  });

  it('handles single day range', () => {
    const chunks = chunkDateRange('2025-12-25', '2025-12-25');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startingAt).toBe('2025-12-25T00:00:00Z');
    expect(chunks[0].endingAt).toBe('2025-12-26T00:00:00Z');
  });
});

// ─── scanAnthropicApiDates ───────────────────────────────────────────────────

describe('scanAnthropicApiDates', () => {
  it('maps API response fields to IngestBreakdown correctly', async () => {
    mockFetch([{
      data: [
        makeBucket('2025-11-15', [{
          model: 'claude-opus-4-5-20251101',
          uncached_input_tokens: 5000,
          cache_read_input_tokens: 200000,
          cache_creation: { ephemeral_5m_input_tokens: 10000, ephemeral_1h_input_tokens: 8000 },
          output_tokens: 1500,
        }]),
      ],
      has_more: false,
      next_page: null,
    }]);

    const result = await scanAnthropicApiDates(['2025-11-15'], 'sk-ant-admin-test');
    const breakdowns = result.get('2025-11-15')!;

    expect(breakdowns).toHaveLength(1);
    const b = breakdowns[0];
    expect(b.model).toBe('claude-opus-4-5');        // date suffix stripped
    expect(b.provider).toBe('anthropic');
    expect(b.product).toBe('claude-code');
    expect(b.inputTokens).toBe(5000);               // uncached_input_tokens
    expect(b.cachedInputTokens).toBe(200000);        // cache_read_input_tokens
    expect(b.cacheWrite5mTokens).toBe(10000);
    expect(b.cacheWrite1hTokens).toBe(8000);
    expect(b.cacheWriteTokens).toBe(18000);          // 5m + 1h
    expect(b.outputTokens).toBe(1500);
  });

  it('returns empty array for dates not in API response', async () => {
    mockFetch([{
      data: [makeBucket('2025-11-15', [{ model: 'claude-opus-4-5-20251101', output_tokens: 100 }])],
      has_more: false,
      next_page: null,
    }]);

    const result = await scanAnthropicApiDates(['2025-11-15', '2025-11-16'], 'sk-ant-admin-test');
    expect(result.get('2025-11-15')).toHaveLength(1);
    expect(result.get('2025-11-16')).toEqual([]); // not in API response
  });

  it('aggregates multiple models on same date', async () => {
    mockFetch([{
      data: [
        makeBucket('2025-11-20', [
          { model: 'claude-opus-4-5-20251101', uncached_input_tokens: 3000, output_tokens: 500 },
          { model: 'claude-haiku-4-5-20251001', uncached_input_tokens: 1000, output_tokens: 200 },
        ]),
      ],
      has_more: false,
      next_page: null,
    }]);

    const breakdowns = (await scanAnthropicApiDates(['2025-11-20'], 'sk-ant-admin-test')).get('2025-11-20')!;
    expect(breakdowns).toHaveLength(2);
    const models = breakdowns.map(b => b.model).sort();
    expect(models).toEqual(['claude-haiku-4-5', 'claude-opus-4-5']);
  });

  it('handles paginated responses (has_more = true)', async () => {
    mockFetch([
      {
        data: [makeBucket('2025-11-01', [{ model: 'claude-opus-4-5-20251101', output_tokens: 100 }])],
        has_more: true,
        next_page: 'page-token-2',
      },
      {
        data: [makeBucket('2025-11-02', [{ model: 'claude-opus-4-5-20251101', output_tokens: 200 }])],
        has_more: false,
        next_page: null,
      },
    ]);

    const result = await scanAnthropicApiDates(['2025-11-01', '2025-11-02'], 'sk-ant-admin-test');
    expect(result.get('2025-11-01')![0].outputTokens).toBe(100);
    expect(result.get('2025-11-02')![0].outputTokens).toBe(200);

    // Should have made 2 fetch calls
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call should include page token
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain('page=page-token-2');
  });

  it('throws on non-OK API response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"unauthorized"}',
    })));

    await expect(
      scanAnthropicApiDates(['2025-11-01'], 'sk-ant-admin-bad-key'),
    ).rejects.toThrow('401');
  });

  it('returns empty maps for empty input', async () => {
    const result = await scanAnthropicApiDates([], 'sk-ant-admin-test');
    expect(result.size).toBe(0);
  });

  it('skips all-zero token entries', async () => {
    mockFetch([{
      data: [
        makeBucket('2025-11-15', [
          { model: 'claude-opus-4-5-20251101' }, // all zeros
          { model: 'claude-haiku-4-5-20251001', output_tokens: 50 }, // has data
        ]),
      ],
      has_more: false,
      next_page: null,
    }]);

    const breakdowns = (await scanAnthropicApiDates(['2025-11-15'], 'sk-ant-admin-test')).get('2025-11-15')!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0].model).toBe('claude-haiku-4-5');
  });

  it('splits long date ranges into multiple 31-day API requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    })));

    // 69 days → should require at least 3 requests
    const dates: string[] = [];
    const start = new Date('2025-11-01');
    for (let i = 0; i < 69; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    await scanAnthropicApiDates(dates, 'sk-ant-admin-test');

    const callCount = vi.mocked(fetch).mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});
