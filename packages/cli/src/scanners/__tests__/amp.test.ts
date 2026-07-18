import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanAmpDates } from '../amp.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-amp-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeThread(name: string, value: unknown): Promise<void> {
  await writeFile(join(tmpDir, name), JSON.stringify(value));
}

describe('scanAmpDates', () => {
  it('部分 ledger 与 message usage 对账：匹配项不双计，缺失项仍保留', async () => {
    await writeThread('T-partial.json', {
      id: 'thread-1',
      created: Date.parse('2026-07-18T08:00:00Z'),
      usageLedger: { events: [{
        timestamp: '2026-07-18T09:00:00Z',
        model: 'claude-sonnet-4',
        toMessageId: 1,
        tokens: { input: 100, output: 20 },
      }] },
      messages: [
        { role: 'assistant', messageId: 1, usage: { model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 30 } },
        { role: 'assistant', messageId: 2, usage: { model: 'claude-sonnet-4', inputTokens: 50, outputTokens: 10, cacheCreationInputTokens: 5 } },
      ],
    });

    const rows = (await scanAmpDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        product: 'amp',
        eventCount: 2,
        inputTokens: 150,
        cachedInputTokens: 30,
        cacheWriteTokens: 5,
        outputTokens: 30,
      }),
    ]);
  });

  it('完整 ledger 与无 ID 的同 token 消息按指纹去重', async () => {
    await writeThread('T-full.json', {
      created: '2026-07-18T08:00:00Z',
      usageLedger: { events: [{ model: 'gemini-2.5-pro', tokens: { input: 10, output: 2 } }] },
      messages: [{ role: 'assistant', usage: { model: 'gemini-2.5-pro', inputTokens: 10, outputTokens: 2 } }],
    });

    const rows = (await scanAmpDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows[0]).toEqual(expect.objectContaining({
      provider: 'google', eventCount: 1, inputTokens: 10, outputTokens: 2,
    }));
  });
});
