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

  it('deduplicates repeated records with the same messageId+requestId', async () => {
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    // Same messageId+requestId in 3 files (session replay pattern): identical token counts
    await writeJsonl(projectDir, 'session1.jsonl', [
      claudeRecord({ timestamp: '2026-01-15T10:00:00.000Z', requestId: 'req_001', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 200 }),
    ]);
    await writeJsonl(projectDir, 'session2.jsonl', [
      claudeRecord({ timestamp: '2026-01-15T10:00:00.000Z', requestId: 'req_001', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 200 }),
    ]);
    await writeJsonl(projectDir, 'session3.jsonl', [
      claudeRecord({ timestamp: '2026-01-15T10:00:00.000Z', requestId: 'req_001', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 200 }),
    ]);

    const result = await scanClaudeDates(['2026-01-15'], join(tmpDir, 'projects'));
    const [b] = result.get('2026-01-15')!;
    expect(b.outputTokens).toBe(200); // counted once, not 3×
    expect(b.inputTokens).toBe(500);
    expect(b.eventCount).toBe(1);     // single event despite 3 files
  });

  it('缺少 requestId 时按 message.id 去重，并合并流式快照的字段最大值', async () => {
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    await writeJsonl(projectDir, 'session.jsonl', [
      {
        type: 'assistant', timestamp: '2026-01-15T10:00:00.000Z', cwd: '/Users/test/project',
        message: { id: 'msg_stream', model: 'claude-opus-4-8', usage: {
          input_tokens: 100, cache_read_input_tokens: 300, output_tokens: 20,
        } },
      },
      {
        type: 'assistant', timestamp: '2026-01-15T10:00:01.000Z', cwd: '/Users/test/project',
        message: { id: 'msg_stream', model: 'claude-opus-4-8', usage: {
          input_tokens: 150, cache_read_input_tokens: 250, output_tokens: 40,
        } },
      },
    ]);

    const [b] = (await scanClaudeDates(['2026-01-15'], join(tmpDir, 'projects'))).get('2026-01-15')!;
    expect(b).toEqual(expect.objectContaining({
      eventCount: 1,
      inputTokens: 150,
      cachedInputTokens: 300,
      outputTokens: 40,
    }));
  });

  it('缓存写入总量使用权威字段，并随流式快照更新明细', async () => {
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    await writeJsonl(projectDir, 'session.jsonl', [
      {
        type: 'assistant', timestamp: '2026-01-15T10:00:00.000Z', cwd: '/Users/test/project',
        message: { id: 'msg_cache', model: 'claude-opus-4-8', usage: {
          input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 100,
          cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 30 },
        } },
      },
      {
        type: 'assistant', timestamp: '2026-01-15T10:00:01.000Z', cwd: '/Users/test/project',
        message: { id: 'msg_cache', model: 'claude-opus-4-8', usage: {
          input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 120,
          cache_creation: { ephemeral_5m_input_tokens: 70, ephemeral_1h_input_tokens: 50 },
        } },
      },
    ]);

    const [b] = (await scanClaudeDates(['2026-01-15'], join(tmpDir, 'projects'))).get('2026-01-15')!;
    expect(b).toEqual(expect.objectContaining({
      eventCount: 1,
      cacheWriteTokens: 120,
      cacheWrite5mTokens: 70,
      cacheWrite1hTokens: 50,
    }));
  });

  it('从显式字段或模型前缀识别兼容模型供应商', async () => {
    const projectDir = join(tmpDir, 'projects', '-Users-test-project');
    await writeJsonl(projectDir, 'session.jsonl', [
      {
        type: 'assistant', timestamp: '2026-01-15T10:00:00.000Z', cwd: '/Users/test/project',
        message: { id: 'msg_custom', model: 'model_api/experimental_0630', usage: {
          input_tokens: 100, output_tokens: 20,
        } },
      },
    ]);

    const [b] = (await scanClaudeDates(['2026-01-15'], join(tmpDir, 'projects'))).get('2026-01-15')!;
    expect(b.provider).toBe('model_api');
  });

  it('returns empty array for a date with no JSONL data and no stats-cache', async () => {
    const result = await scanClaudeDates(['2025-11-01'], join(tmpDir, 'projects'));
    expect(result.get('2025-11-01')).toEqual([]);
  });
});

describe('stats-cache safety', () => {
  it('does not fabricate per-model input/output from aggregate stats-cache data', async () => {
    await writeFile(join(tmpDir, 'stats-cache.json'), JSON.stringify({
      dailyModelTokens: [
        { date: '2025-12-25', tokensByModel: { 'claude-opus-4-5': 500_000 } },
      ],
    }));

    const result = await scanClaudeDates(['2025-12-25'], join(tmpDir, 'projects'));
    expect(result.get('2025-12-25')).toEqual([]);
  });
});
