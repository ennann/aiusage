import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanCopilotDates } from '../copilot.js';

/** Write a JSONL file inside the given directory. */
async function writeSession(dir: string, filename: string, lines: object[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join('\n');
  await writeFile(join(dir, filename), content);
}

/** Build a session.start event. */
function sessionStart(ts: string, gitRoot?: string, cwd?: string): object {
  return {
    type: 'session.start',
    timestamp: ts,
    data: { context: { ...(gitRoot !== undefined && { gitRoot }), ...(cwd !== undefined && { cwd }) } },
  };
}

/** Build a session.resume event. */
function sessionResume(ts: string, gitRoot?: string, cwd?: string): object {
  return {
    type: 'session.resume',
    timestamp: ts,
    data: { context: { ...(gitRoot !== undefined && { gitRoot }), ...(cwd !== undefined && { cwd }) } },
  };
}

/** Build a session.shutdown event with modelMetrics. */
function sessionShutdown(
  ts: string,
  metrics: Record<string, { inputTokens?: number; cacheReadTokens?: number; outputTokens?: number }>,
): object {
  const modelMetrics: Record<string, object> = {};
  for (const [model, usage] of Object.entries(metrics)) {
    modelMetrics[model] = { usage };
  }
  return { type: 'session.shutdown', timestamp: ts, data: { modelMetrics } };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-copilot-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── 1. 基本用量提取 ───

describe('basic usage extraction', () => {
  it('extracts tokens from session.start + session.shutdown', async () => {
    const day = '2025-06-15';
    const sessionDir = join(tmpDir, 'session-abc');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${day}T10:00:00.000Z`, '/Users/test/my-project'),
      sessionShutdown(`${day}T10:30:00.000Z`, {
        'gpt-4o': { inputTokens: 5000, cacheReadTokens: 2000, outputTokens: 800 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items).toHaveLength(1);

    const r = items[0];
    expect(r.provider).toBe('github');
    expect(r.product).toBe('copilot-cli');
    expect(r.model).toBe('gpt-4o');
    expect(r.inputTokens).toBe(3000); // 5000 - 2000
    expect(r.cachedInputTokens).toBe(2000);
    expect(r.outputTokens).toBe(800);
    expect(r.eventCount).toBe(1);
  });
});

// ─── 2. 从 gitRoot 提取项目名 ───

describe('project name from gitRoot', () => {
  it('uses gitRoot basename as projectDisplay', async () => {
    const day = '2025-06-15';
    const sessionDir = join(tmpDir, 'session-git');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${day}T09:00:00.000Z`, '/Users/test/awesome-repo'),
      sessionShutdown(`${day}T09:30:00.000Z`, {
        'claude-sonnet-4': { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 200 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items).toHaveLength(1);
    expect(items[0].project).toBe('/Users/test/awesome-repo');
    expect(items[0].projectDisplay).toBe('awesome-repo');
  });
});

// ─── 3. 从 cwd 提取项目名（无 gitRoot 时回退） ───

describe('project name fallback to cwd', () => {
  it('falls back to cwd when gitRoot is absent', async () => {
    const day = '2025-06-15';
    const sessionDir = join(tmpDir, 'session-cwd');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${day}T08:00:00.000Z`, undefined, '/home/user/fallback-project'),
      sessionShutdown(`${day}T08:30:00.000Z`, {
        'gpt-4o': { inputTokens: 2000, cacheReadTokens: 500, outputTokens: 300 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items).toHaveLength(1);
    expect(items[0].project).toBe('/home/user/fallback-project');
    expect(items[0].projectDisplay).toBe('fallback-project');
  });

  it('prefers gitRoot over cwd when both present', async () => {
    const day = '2025-06-15';
    const sessionDir = join(tmpDir, 'session-both');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${day}T08:00:00.000Z`, '/git/root-project', '/cwd/other-project'),
      sessionShutdown(`${day}T08:30:00.000Z`, {
        'gpt-4o': { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 100 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items[0].projectDisplay).toBe('root-project');
  });
});

// ─── 4. 项目别名解析 ───

describe('project alias resolution', () => {
  it('resolves alias by display name', async () => {
    const day = '2025-06-15';
    const sessionDir = join(tmpDir, 'session-alias');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${day}T07:00:00.000Z`, '/Users/test/my-repo'),
      sessionShutdown(`${day}T07:30:00.000Z`, {
        'gpt-4o': { inputTokens: 3000, cacheReadTokens: 1000, outputTokens: 400 },
      }),
    ]);

    const aliases = { 'my-repo': 'My Awesome Project' };
    const result = await scanCopilotDates([day], tmpDir, aliases);
    const items = result.get(day)!;
    expect(items).toHaveLength(1);
    expect(items[0].projectAlias).toBe('My Awesome Project');
  });

  it('resolves alias by full path', async () => {
    const day = '2025-06-15';
    const sessionDir = join(tmpDir, 'session-alias2');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${day}T07:00:00.000Z`, '/Users/test/my-repo'),
      sessionShutdown(`${day}T07:30:00.000Z`, {
        'gpt-4o': { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 100 },
      }),
    ]);

    const aliases = { '/Users/test/my-repo': 'Full Path Alias' };
    const result = await scanCopilotDates([day], tmpDir, aliases);
    const items = result.get(day)!;
    expect(items[0].projectAlias).toBe('Full Path Alias');
  });
});

// ─── 5. 无数据时返回空结果 ───

describe('empty results', () => {
  it('returns empty arrays when no data files exist', async () => {
    const day = '2025-06-15';
    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items).toEqual([]);
  });

  it('returns empty arrays when files have no matching date', async () => {
    const day = '2025-06-15';
    const otherDay = '2025-06-14';
    const sessionDir = join(tmpDir, 'session-other');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${otherDay}T10:00:00.000Z`, '/Users/test/proj'),
      sessionShutdown(`${otherDay}T10:30:00.000Z`, {
        'gpt-4o': { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 100 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items).toEqual([]);
  });
});

// ─── 6. 多个 session 目录聚合 ───

describe('multi-session aggregation', () => {
  it('aggregates tokens across multiple session directories', async () => {
    const day = '2025-06-15';

    // Session 1: same model + project
    const session1 = join(tmpDir, 'session-001');
    await writeSession(session1, 'events.jsonl', [
      sessionStart(`${day}T09:00:00.000Z`, '/Users/test/proj'),
      sessionShutdown(`${day}T09:30:00.000Z`, {
        'gpt-4o': { inputTokens: 3000, cacheReadTokens: 1000, outputTokens: 200 },
      }),
    ]);

    // Session 2: same model + project -> should merge
    const session2 = join(tmpDir, 'session-002');
    await writeSession(session2, 'events.jsonl', [
      sessionStart(`${day}T10:00:00.000Z`, '/Users/test/proj'),
      sessionShutdown(`${day}T10:30:00.000Z`, {
        'gpt-4o': { inputTokens: 4000, cacheReadTokens: 2000, outputTokens: 300 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    // Same model + project key -> merged into one breakdown
    expect(items).toHaveLength(1);
    expect(items[0].eventCount).toBe(2);
    expect(items[0].inputTokens).toBe(4000);       // (3000-1000) + (4000-2000)
    expect(items[0].cachedInputTokens).toBe(3000);  // 1000 + 2000
    expect(items[0].outputTokens).toBe(500);         // 200 + 300
  });

  it('keeps separate breakdowns for different models', async () => {
    const day = '2025-06-15';

    const session1 = join(tmpDir, 'session-m1');
    await writeSession(session1, 'events.jsonl', [
      sessionStart(`${day}T09:00:00.000Z`, '/Users/test/proj'),
      sessionShutdown(`${day}T09:30:00.000Z`, {
        'gpt-4o': { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 100 },
      }),
    ]);

    const session2 = join(tmpDir, 'session-m2');
    await writeSession(session2, 'events.jsonl', [
      sessionStart(`${day}T10:00:00.000Z`, '/Users/test/proj'),
      sessionShutdown(`${day}T10:30:00.000Z`, {
        'claude-sonnet-4': { inputTokens: 2000, cacheReadTokens: 500, outputTokens: 200 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items).toHaveLength(2);

    const gpt = items.find((i) => i.model === 'gpt-4o')!;
    const claude = items.find((i) => i.model === 'claude-sonnet-4')!;
    expect(gpt.inputTokens).toBe(1000);
    expect(claude.inputTokens).toBe(1500); // 2000 - 500
    expect(claude.cachedInputTokens).toBe(500);
  });

  it('handles multiple models in a single shutdown event', async () => {
    const day = '2025-06-15';
    const sessionDir = join(tmpDir, 'session-multi-model');
    await writeSession(sessionDir, 'events.jsonl', [
      sessionStart(`${day}T09:00:00.000Z`, '/Users/test/proj'),
      sessionShutdown(`${day}T09:30:00.000Z`, {
        'gpt-4o': { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 100 },
        'claude-sonnet-4': { inputTokens: 2000, cacheReadTokens: 500, outputTokens: 300 },
      }),
    ]);

    const result = await scanCopilotDates([day], tmpDir);
    const items = result.get(day)!;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.model).sort()).toEqual(['claude-sonnet-4', 'gpt-4o']);
  });
});
