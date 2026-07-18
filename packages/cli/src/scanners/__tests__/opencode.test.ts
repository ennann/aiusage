import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseOpenCodeSqliteRows, scanOpencodeDates } from '../opencode.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-opencode-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('scanOpencodeDates', () => {
  it('旧 JSON 只统计 assistant，补齐 provider 与 cache write', async () => {
    const sessionDir = join(tmpDir, 'ses_1');
    await mkdir(sessionDir, { recursive: true });
    const base = {
      time: { created: Date.parse('2026-07-18T08:00:00Z') },
      modelID: 'claude-sonnet-4-6',
      providerID: 'anthropic',
      path: { root: '/Users/test/repo' },
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } },
    };
    await writeFile(join(sessionDir, 'assistant.json'), JSON.stringify({ ...base, id: 'm1', role: 'assistant' }));
    await writeFile(join(sessionDir, 'user.json'), JSON.stringify({ ...base, id: 'm2', role: 'user' }));

    const rows = (await scanOpencodeDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        product: 'opencode',
        eventCount: 1,
        inputTokens: 100,
        cachedInputTokens: 30,
        cacheWriteTokens: 10,
        outputTokens: 20,
        reasoningOutputTokens: 5,
      }),
    ]);
  });
});

describe('parseOpenCodeSqliteRows', () => {
  it('解析 OpenCode 1.2+ message.data，并以 session directory 补齐项目', () => {
    const records = parseOpenCodeSqliteRows([{
      id: 'row-1',
      session_id: 'ses-1',
      workspace_root: '/Users/test/sqlite-project',
      data: JSON.stringify({
        id: 'msg-1', role: 'assistant', modelID: 'gpt-5.6', providerID: 'openai',
        time: { created: Date.parse('2026-07-18T08:00:00Z') },
        tokens: { input: 7, output: 3, reasoning: 2, cache: { read: 5, write: 1 } },
      }),
    }]);

    expect(records).toEqual([
      expect.objectContaining({
        id: 'msg-1', provider: 'openai', model: 'gpt-5.6',
        projectRoot: '/Users/test/sqlite-project',
        tokens: { input: 7, cached: 5, cacheWrite: 1, output: 3, reasoning: 2 },
      }),
    ]);
  });
});
