import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanClaudeDates } from '../claude.js';

// ─── helpers ────────────────────────────────────────────────────────────────

async function writeJsonl(dir: string, filename: string, lines: object[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), lines.map(l => JSON.stringify(l)).join('\n'));
}

function claudeRecord(opts: {
  timestamp: string;
  requestId: string;
  model: string;
  cwd?: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
}): object {
  return {
    timestamp: opts.timestamp,
    requestId: opts.requestId,
    cwd: opts.cwd ?? '/Users/test/project',
    message: {
      id: `msg_${opts.requestId}`,
      model: opts.model,
      usage: {
        input_tokens: opts.inputTokens,
        output_tokens: opts.outputTokens,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: (opts.cacheWrite5m ?? 0) + (opts.cacheWrite1h ?? 0),
        cache_creation: {
          ephemeral_5m_input_tokens: opts.cacheWrite5m ?? 0,
          ephemeral_1h_input_tokens: opts.cacheWrite1h ?? 0,
        },
      },
    },
  };
}

function makeStatsCache(opts: {
  dailyModelTokens: Array<{ date: string; tokensByModel: Record<string, number> }>;
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number }>;
}): string {
  return JSON.stringify({
    version: '1',
    lastComputedDate: '2026-01-31',
    dailyModelTokens: opts.dailyModelTokens,
    modelUsage: opts.modelUsage ?? {},
  });
}

let tmpDir: string;
// baseDirs that getClaudeProjectDirs() will use: tmpDir/projects
// stats-cache lives at: tmpDir/stats-cache.json

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-claude-test-${Date.now()}`);
  await mkdir(join(tmpDir, 'projects'), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── JSONL scanning ──────────────────────────────────────────────────────────

describe('JSONL scanning', () => {
  it('returns data for a date that has JSONL records', async () => {
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    await writeJsonl(projectDir, 'session.jsonl', [
      claudeRecord({
        timestamp: '2026-01-15T10:00:00.000Z',
        requestId: 'req_001',
        model: 'claude-opus-4-5-20251101',
        inputTokens: 1000,
        outputTokens: 200,
        cacheRead: 5000,
        cacheWrite5m: 3000,
      }),
    ]);

    const result = await scanClaudeDates(['2026-01-15'], join(tmpDir, 'projects'));
    const breakdowns = result.get('2026-01-15')!;
    expect(breakdowns).toHaveLength(1);
    const b = breakdowns[0];
    expect(b.model).toBe('claude-opus-4-5');
    expect(b.inputTokens).toBe(1000);
    expect(b.outputTokens).toBe(200);
    expect(b.cachedInputTokens).toBe(5000);
    expect(b.cacheWriteTokens).toBe(3000);
  });

  it('deduplicates streaming records with the same requestId by taking max', async () => {
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    // Same requestId emitted 3× (streaming pattern): output grows 10 → 50 → 200
    await writeJsonl(projectDir, 'session.jsonl', [
      claudeRecord({ timestamp: '2026-01-15T10:00:00.000Z', requestId: 'req_001', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 10 }),
      claudeRecord({ timestamp: '2026-01-15T10:00:01.000Z', requestId: 'req_001', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 50 }),
      claudeRecord({ timestamp: '2026-01-15T10:00:02.000Z', requestId: 'req_001', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 200 }),
    ]);

    const result = await scanClaudeDates(['2026-01-15'], join(tmpDir, 'projects'));
    const [b] = result.get('2026-01-15')!;
    expect(b.outputTokens).toBe(200); // max, not sum
    expect(b.inputTokens).toBe(500);
    expect(b.eventCount).toBe(1);     // counted as a single event
  });

  it('returns empty array for a date with no JSONL data and no stats-cache', async () => {
    const result = await scanClaudeDates(['2025-11-01'], join(tmpDir, 'projects'));
    expect(result.get('2025-11-01')).toEqual([]);
  });
});

// ─── Stats-cache fallback ────────────────────────────────────────────────────

describe('stats-cache fallback', () => {
  it('fills a date with no JSONL data from stats-cache dailyModelTokens', async () => {
    await writeFile(
      join(tmpDir, 'stats-cache.json'),
      makeStatsCache({
        dailyModelTokens: [
          { date: '2025-12-25', tokensByModel: { 'claude-opus-4-5-20251101': 100_000 } },
        ],
        modelUsage: {
          'claude-opus-4-5-20251101': { inputTokens: 800_000, outputTokens: 200_000 }, // 80/20 ratio
        },
      }),
    );

    const result = await scanClaudeDates(['2025-12-25'], join(tmpDir, 'projects'));
    const breakdowns = result.get('2025-12-25')!;
    expect(breakdowns).toHaveLength(1);
    const b = breakdowns[0];
    expect(b.model).toBe('claude-opus-4-5');
    expect(b.provider).toBe('anthropic');
    expect(b.product).toBe('claude-code');
    // 80% input, 20% output
    expect(b.inputTokens).toBe(80_000);
    expect(b.outputTokens).toBe(20_000);
    // cache fields are unknown from stats-cache
    expect(b.cachedInputTokens).toBe(0);
    expect(b.cacheWriteTokens).toBe(0);
  });

  it('uses 70/30 default ratio when modelUsage has no entry for the model', async () => {
    await writeFile(
      join(tmpDir, 'stats-cache.json'),
      makeStatsCache({
        dailyModelTokens: [
          { date: '2025-12-26', tokensByModel: { 'claude-unknown-model-20251201': 50_000 } },
        ],
        modelUsage: {}, // no entry for this model
      }),
    );

    const result = await scanClaudeDates(['2025-12-26'], join(tmpDir, 'projects'));
    const [b] = result.get('2025-12-26')!;
    expect(b.inputTokens).toBe(35_000);  // 70% of 50000
    expect(b.outputTokens).toBe(15_000); // 30% of 50000
  });

  it('does NOT use stats-cache for a date that already has JSONL data', async () => {
    // Write JSONL data for Dec 27
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    await writeJsonl(projectDir, 'session.jsonl', [
      claudeRecord({
        timestamp: '2025-12-27T10:00:00.000Z',
        requestId: 'req_999',
        model: 'claude-opus-4-5-20251101',
        inputTokens: 1_000,
        outputTokens: 100,
      }),
    ]);
    // Stats-cache also has Dec 27 with different (much larger) values
    await writeFile(
      join(tmpDir, 'stats-cache.json'),
      makeStatsCache({
        dailyModelTokens: [
          { date: '2025-12-27', tokensByModel: { 'claude-opus-4-5-20251101': 999_999 } },
        ],
        modelUsage: { 'claude-opus-4-5-20251101': { inputTokens: 7, outputTokens: 3 } },
      }),
    );

    const result = await scanClaudeDates(['2025-12-27'], join(tmpDir, 'projects'));
    const [b] = result.get('2025-12-27')!;
    // Should come from JSONL, not stats-cache
    expect(b.inputTokens).toBe(1_000);
    expect(b.outputTokens).toBe(100);
  });

  it('handles missing stats-cache.json gracefully', async () => {
    // No stats-cache.json written
    const result = await scanClaudeDates(['2025-12-28'], join(tmpDir, 'projects'));
    expect(result.get('2025-12-28')).toEqual([]);
  });

  it('handles malformed stats-cache.json gracefully', async () => {
    await writeFile(join(tmpDir, 'stats-cache.json'), 'not valid json {{{{');

    const result = await scanClaudeDates(['2025-12-29'], join(tmpDir, 'projects'));
    expect(result.get('2025-12-29')).toEqual([]);
  });

  it('covers multiple missing dates from a single stats-cache', async () => {
    await writeFile(
      join(tmpDir, 'stats-cache.json'),
      makeStatsCache({
        dailyModelTokens: [
          { date: '2025-12-25', tokensByModel: { 'claude-opus-4-5-20251101': 100_000 } },
          { date: '2025-12-26', tokensByModel: { 'claude-opus-4-5-20251101': 200_000 } },
          { date: '2025-12-28', tokensByModel: { 'claude-opus-4-5-20251101': 50_000 } }, // not requested
        ],
        modelUsage: { 'claude-opus-4-5-20251101': { inputTokens: 6, outputTokens: 4 } }, // 60/40
      }),
    );

    const result = await scanClaudeDates(
      ['2025-12-25', '2025-12-26'],
      join(tmpDir, 'projects'),
    );
    expect(result.get('2025-12-25')![0].inputTokens).toBe(60_000);
    expect(result.get('2025-12-26')![0].inputTokens).toBe(120_000);
    expect(result.has('2025-12-28')).toBe(false); // not requested
  });

  it('normalises model names from stats-cache (strips date suffix)', async () => {
    await writeFile(
      join(tmpDir, 'stats-cache.json'),
      makeStatsCache({
        dailyModelTokens: [
          { date: '2025-12-30', tokensByModel: { 'claude-sonnet-4-5-20250929': 40_000 } },
        ],
      }),
    );

    const result = await scanClaudeDates(['2025-12-30'], join(tmpDir, 'projects'));
    const [b] = result.get('2025-12-30')!;
    expect(b.model).toBe('claude-sonnet-4-5'); // date suffix stripped
  });
});

// ─── Integration: JSONL + stats-cache mixed ──────────────────────────────────

describe('Integration: JSONL and stats-cache for different dates', () => {
  it('returns JSONL data for covered dates and stats-cache data for uncovered dates', async () => {
    // JSONL covers Jan 15
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    await writeJsonl(projectDir, 'session.jsonl', [
      claudeRecord({
        timestamp: '2026-01-15T10:00:00.000Z',
        requestId: 'req_100',
        model: 'claude-opus-4-6',
        inputTokens: 2_000,
        outputTokens: 300,
      }),
    ]);

    // Stats-cache covers Dec 25 (before JSONL rotation)
    await writeFile(
      join(tmpDir, 'stats-cache.json'),
      makeStatsCache({
        dailyModelTokens: [
          { date: '2025-12-25', tokensByModel: { 'claude-opus-4-5-20251101': 500_000 } },
        ],
        modelUsage: { 'claude-opus-4-5-20251101': { inputTokens: 623, outputTokens: 377 } },
      }),
    );

    const result = await scanClaudeDates(
      ['2026-01-15', '2025-12-25'],
      join(tmpDir, 'projects'),
    );

    // Jan 15: from JSONL
    const jan15 = result.get('2026-01-15')!;
    expect(jan15).toHaveLength(1);
    expect(jan15[0].model).toBe('claude-opus-4-6');
    expect(jan15[0].inputTokens).toBe(2_000);

    // Dec 25: from stats-cache, with 62.3/37.7 ratio
    const dec25 = result.get('2025-12-25')!;
    expect(dec25).toHaveLength(1);
    expect(dec25[0].model).toBe('claude-opus-4-5');
    expect(dec25[0].inputTokens).toBe(311_500); // round(500000 * 623/1000)
    expect(dec25[0].cachedInputTokens).toBe(0); // cache unknown from stats-cache
  });
});
