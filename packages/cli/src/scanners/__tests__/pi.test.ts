import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanPiDates } from '../pi.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-pi-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n'));
}

describe('scanPiDates', () => {
  it('兼容 title 前置记录，保留 cache write，并优先使用消息 provider', async () => {
    await writeJsonl(join(tmpDir, '--Users-test-repo--', 'session.jsonl'), [
      { type: 'title', title: 'generated' },
      { type: 'session', id: 's1', cwd: '/Users/test/repo' },
      {
        type: 'message',
        id: 'm1',
        timestamp: '2026-07-18T09:00:00Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          provider: 'anthropic',
          usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 10 },
        },
      },
    ]);

    const rows = (await scanPiDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        product: 'pi',
        project: '/Users/test/repo',
        eventCount: 1,
        inputTokens: 100,
        cachedInputTokens: 30,
        cacheWriteTokens: 10,
        outputTokens: 20,
      }),
    ]);
  });

  it('provider 缺失时根据模型推断，并将去重范围限制在各会话内', async () => {
    for (const session of ['a', 'b']) {
      await writeJsonl(join(tmpDir, session, `${session}.jsonl`), [
        { type: 'session', id: session, cwd: `/tmp/${session}` },
        {
          type: 'message', id: 'same-id', timestamp: '2026-07-18T10:00:00Z',
          message: { role: 'assistant', model: 'gpt-5.6', usage: { input: 3, output: 2 } },
        },
      ]);
    }

    const rows = (await scanPiDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.provider === 'openai')).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.eventCount, 0)).toBe(2);
  });
});
