import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanCodex } from '../codex.js';

// Helper to write a JSONL session file
async function writeSession(dir: string, filename: string, lines: object[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join('\n');
  await writeFile(join(dir, filename), content);
}

function tokenCountEvent(
  timestamp: string,
  last: { input: number; cached: number; output: number; reasoning?: number },
  total: { input: number; cached: number; output: number; reasoning?: number },
  model = 'gpt-5-codex',
  cwd = '/Users/test/project',
): object[] {
  // turn_context sets model/project
  const ctx = {
    type: 'turn_context',
    timestamp,
    payload: { model, cwd },
  };
  const ev = {
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: last.input,
          cached_input_tokens: last.cached,
          output_tokens: last.output,
          reasoning_output_tokens: last.reasoning ?? 0,
        },
        total_token_usage: {
          input_tokens: total.input,
          cached_input_tokens: total.cached,
          output_tokens: total.output,
          reasoning_output_tokens: total.reasoning ?? 0,
        },
      },
    },
  };
  return [ctx, ev];
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-test-${Date.now()}`);
  await mkdir(join(tmpDir, 'sessions'), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Fix 1: cached input is included in input_tokens — should NOT double-count ───

describe('Fix 1: non-cached input cost formula', () => {
  it('stores inputTokens as (input - cached) to avoid double-counting', async () => {
    // Codex JSONL: input_tokens INCLUDES cached_input_tokens
    // last_token_usage: input=10000, cached=8000 → non-cached = 2000
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    const events = tokenCountEvent(
      `${day}T10:00:00.000Z`,
      { input: 10000, cached: 8000, output: 500 },
      { input: 10000, cached: 8000, output: 500 },
    );
    await writeSession(sessionDir, 'rollout-test.jsonl', events);

    const results = await scanCodex(day, tmpDir);
    expect(results).toHaveLength(1);
    const r = results[0];
    // inputTokens should be non-cached portion only: 10000 - 8000 = 2000
    expect(r.inputTokens).toBe(2000);
    expect(r.cachedInputTokens).toBe(8000);
    expect(r.outputTokens).toBe(500);
  });

  it('handles fully cached input (input === cached) without going negative', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    const events = tokenCountEvent(
      `${day}T10:00:00.000Z`,
      { input: 5000, cached: 5000, output: 200 },
      { input: 5000, cached: 5000, output: 200 },
    );
    await writeSession(sessionDir, 'rollout-test.jsonl', events);

    const results = await scanCodex(day, tmpDir);
    expect(results[0].inputTokens).toBe(0); // 5000 - 5000, no negative
    expect(results[0].cachedInputTokens).toBe(5000);
  });

  it('accumulates multiple turns with correct non-cached split', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    // Turn 1: input=3000, cached=2000 → non-cached=1000
    // Turn 2: input=4000, cached=3000 → non-cached=1000
    const lines = [
      ...tokenCountEvent(
        `${day}T10:00:00.000Z`,
        { input: 3000, cached: 2000, output: 100 },
        { input: 3000, cached: 2000, output: 100 },
      ),
      ...tokenCountEvent(
        `${day}T10:05:00.000Z`,
        { input: 4000, cached: 3000, output: 150 },
        { input: 7000, cached: 5000, output: 250 },
      ),
    ];
    await writeSession(sessionDir, 'rollout-test.jsonl', lines);

    const results = await scanCodex(day, tmpDir);
    expect(results[0].inputTokens).toBe(2000);     // (3000-2000) + (4000-3000)
    expect(results[0].cachedInputTokens).toBe(5000); // 2000 + 3000
    expect(results[0].outputTokens).toBe(250);
  });
});

// ─── Fix 2: deduplicate events with identical total_token_usage ───

describe('Fix 2: deduplication of duplicate events', () => {
  it('skips exact duplicate events (same total_token_usage emitted twice)', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    // Codex CLI emits each token_count event 2× with identical data
    const singleEvent = {
      type: 'event_msg',
      timestamp: `${day}T10:00:00.000Z`,
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 100 },
          total_token_usage: { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 100 },
        },
      },
    };
    await writeSession(sessionDir, 'rollout-test.jsonl', [
      { type: 'turn_context', timestamp: `${day}T10:00:00.000Z`, payload: { model: 'gpt-5-codex', cwd: '/p' } },
      singleEvent,
      singleEvent, // exact duplicate
    ]);

    const results = await scanCodex(day, tmpDir);
    expect(results).toHaveLength(1);
    // Should count as 1 event, not 2
    expect(results[0].eventCount).toBe(1);
    expect(results[0].inputTokens).toBe(1000); // 3000-2000
    expect(results[0].cachedInputTokens).toBe(2000);
  });

  it('correctly counts 2 distinct turns even when totals are close', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    const lines = [
      { type: 'turn_context', timestamp: `${day}T10:00:00.000Z`, payload: { model: 'gpt-5-codex', cwd: '/p' } },
      // Turn 1 (emitted twice — only count once)
      {
        type: 'event_msg',
        timestamp: `${day}T10:00:01.000Z`,
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 100 },
            total_token_usage: { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 100 },
          },
        },
      },
      {
        type: 'event_msg',
        timestamp: `${day}T10:00:01.400Z`, // 0.4s later, identical
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 100 },
            total_token_usage: { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 100 },
          },
        },
      },
      // Turn 2 (new total)
      {
        type: 'event_msg',
        timestamp: `${day}T10:05:00.000Z`,
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 4000, cached_input_tokens: 3000, output_tokens: 150 },
            total_token_usage: { input_tokens: 7000, cached_input_tokens: 5000, output_tokens: 250 },
          },
        },
      },
      {
        type: 'event_msg',
        timestamp: `${day}T10:05:00.400Z`, // duplicate of turn 2
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 4000, cached_input_tokens: 3000, output_tokens: 150 },
            total_token_usage: { input_tokens: 7000, cached_input_tokens: 5000, output_tokens: 250 },
          },
        },
      },
    ];
    await writeSession(sessionDir, 'rollout-test.jsonl', lines);

    const results = await scanCodex(day, tmpDir);
    expect(results[0].eventCount).toBe(2); // 2 unique turns
    expect(results[0].inputTokens).toBe(2000);     // (3000-2000) + (4000-3000)
    expect(results[0].cachedInputTokens).toBe(5000); // 2000 + 3000
    expect(results[0].outputTokens).toBe(250);       // 100 + 150
  });
});

// ─── Fix 3: fallback to delta when last_token_usage is absent ───

describe('Fix 3: delta fallback when last_token_usage is missing', () => {
  it('computes delta from total_token_usage when last_token_usage is absent', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    // Event 1: total=5000 input, no last_token_usage → delta = 5000-0 = 5000
    // Event 2: total=8000 input, no last_token_usage → delta = 8000-5000 = 3000
    const lines = [
      { type: 'turn_context', timestamp: `${day}T10:00:00.000Z`, payload: { model: 'gpt-5-codex', cwd: '/p' } },
      {
        type: 'event_msg',
        timestamp: `${day}T10:00:01.000Z`,
        payload: {
          type: 'token_count',
          info: {
            // no last_token_usage
            total_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 200 },
          },
        },
      },
      {
        type: 'event_msg',
        timestamp: `${day}T10:05:00.000Z`,
        payload: {
          type: 'token_count',
          info: {
            // no last_token_usage
            total_token_usage: { input_tokens: 8000, cached_input_tokens: 6000, output_tokens: 350 },
          },
        },
      },
    ];
    await writeSession(sessionDir, 'rollout-test.jsonl', lines);

    const results = await scanCodex(day, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].eventCount).toBe(2);
    // Delta 1: input=5000, cached=4000 → non-cached=1000
    // Delta 2: input=3000 (8000-5000), cached=2000 (6000-4000) → non-cached=1000
    expect(results[0].inputTokens).toBe(2000);       // 1000 + 1000
    expect(results[0].cachedInputTokens).toBe(6000);  // 4000 + 2000
    expect(results[0].outputTokens).toBe(350);        // 200 + 150
  });

  it('skips events missing both last_token_usage and total_token_usage', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    await writeSession(sessionDir, 'rollout-test.jsonl', [
      { type: 'turn_context', timestamp: `${day}T10:00:00.000Z`, payload: { model: 'gpt-5-codex', cwd: '/p' } },
      {
        type: 'event_msg',
        timestamp: `${day}T10:00:01.000Z`,
        payload: { type: 'token_count', info: {} }, // no token data at all
      },
    ]);

    const results = await scanCodex(day, tmpDir);
    expect(results).toHaveLength(0);
  });
});

// ─── Fix 4: file glob matches all .jsonl files, not just rollout-* ───

describe('Fix 4: file glob includes all .jsonl files', () => {
  it('scans session files not prefixed with "rollout-"', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');
    const events = tokenCountEvent(
      `${day}T10:00:00.000Z`,
      { input: 3000, cached: 2000, output: 100 },
      { input: 3000, cached: 2000, output: 100 },
    );
    // Use a non-rollout filename
    await writeSession(sessionDir, 'session-abc123.jsonl', events);

    const results = await scanCodex(day, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].inputTokens).toBe(1000);
  });

  it('scans both rollout-* and other .jsonl files in same directory', async () => {
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');

    const eventsA = tokenCountEvent(
      `${day}T10:00:00.000Z`,
      { input: 2000, cached: 1000, output: 50 },
      { input: 2000, cached: 1000, output: 50 },
    );
    const eventsB = tokenCountEvent(
      `${day}T11:00:00.000Z`,
      { input: 4000, cached: 3000, output: 80 },
      { input: 4000, cached: 3000, output: 80 },
    );

    await writeSession(sessionDir, 'rollout-2025-10-16T10-00-00-abc.jsonl', eventsA);
    await writeSession(sessionDir, 'session-xyz.jsonl', eventsB);

    const results = await scanCodex(day, tmpDir);
    const total = results.reduce((s, r) => ({ inputTokens: s.inputTokens + r.inputTokens, cachedInputTokens: s.cachedInputTokens + r.cachedInputTokens }), { inputTokens: 0, cachedInputTokens: 0 });
    expect(total.inputTokens).toBe(2000);       // (2000-1000) + (4000-3000)
    expect(total.cachedInputTokens).toBe(4000); // 1000 + 3000
  });
});

// ─── Integration: multiple fixes together ───

describe('Integration: real-world duplicate pattern', () => {
  it('handles the 2× duplicate emission pattern from Codex CLI correctly', async () => {
    // Simulates the actual Codex CLI behavior: every turn emits 2 identical events
    const day = '2025-10-16';
    const sessionDir = join(tmpDir, 'sessions', '2025', '10', '16');

    const makeDupTurn = (ts: string, last: { input: number; cached: number; output: number }, total: typeof last) => [
      {
        type: 'event_msg', timestamp: ts,
        payload: { type: 'token_count', info: { last_token_usage: { input_tokens: last.input, cached_input_tokens: last.cached, output_tokens: last.output }, total_token_usage: { input_tokens: total.input, cached_input_tokens: total.cached, output_tokens: total.output } } },
      },
      {
        type: 'event_msg', timestamp: `${ts.slice(0, -5)}0.400Z`, // 0.4s later, identical
        payload: { type: 'token_count', info: { last_token_usage: { input_tokens: last.input, cached_input_tokens: last.cached, output_tokens: last.output }, total_token_usage: { input_tokens: total.input, cached_input_tokens: total.cached, output_tokens: total.output } } },
      },
    ];

    const lines = [
      { type: 'turn_context', timestamp: `${day}T10:00:00.000Z`, payload: { model: 'gpt-5-codex', cwd: '/proj' } },
      // Turn 1: input=3000, cached=2000 → non-cached=1000
      ...makeDupTurn(`${day}T10:00:01.000Z`, { input: 3000, cached: 2000, output: 100 }, { input: 3000, cached: 2000, output: 100 }),
      // Turn 2: input=5000, cached=4000 → non-cached=1000
      ...makeDupTurn(`${day}T10:05:01.000Z`, { input: 5000, cached: 4000, output: 200 }, { input: 8000, cached: 6000, output: 300 }),
      // Turn 3: input=4000, cached=3500 → non-cached=500
      ...makeDupTurn(`${day}T10:10:01.000Z`, { input: 4000, cached: 3500, output: 150 }, { input: 12000, cached: 9500, output: 450 }),
    ];
    await writeSession(sessionDir, 'rollout-test.jsonl', lines);

    const results = await scanCodex(day, tmpDir);
    expect(results[0].eventCount).toBe(3);    // 3 unique turns (not 6)
    expect(results[0].inputTokens).toBe(2500);       // 1000+1000+500
    expect(results[0].cachedInputTokens).toBe(9500);  // 2000+4000+3500
    expect(results[0].outputTokens).toBe(450);        // 100+200+150
  });
});
