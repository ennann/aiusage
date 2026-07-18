import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanQwenDates } from '../qwen.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-qwen-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n'));
}

describe('scanQwenDates', () => {
  it('读取当前 projects 目录格式，拆分缓存与思考 token 并按消息去重', async () => {
    const file = join(tmpDir, 'my-project', 'chats', 'session.jsonl');
    const usage = {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      cachedContentTokenCount: 30,
      thoughtsTokenCount: 5,
    };
    await writeJsonl(file, [
      { type: 'assistant', uuid: 'm1', sessionId: 's1', timestamp: '2026-07-18T08:00:00Z', model: 'qwen3-coder-plus', usageMetadata: usage },
      { type: 'assistant', uuid: 'm1', sessionId: 's1', timestamp: '2026-07-18T08:00:01Z', model: 'qwen3-coder-plus', usageMetadata: usage },
    ]);

    const rows = (await scanQwenDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        provider: 'alibaba',
        product: 'qwen-code',
        model: 'qwen3-coder-plus',
        projectDisplay: 'my-project',
        eventCount: 1,
        inputTokens: 70,
        cachedInputTokens: 30,
        outputTokens: 20,
        reasoningOutputTokens: 5,
      }),
    ]);
  });

  it('缺少时间戳时使用文件 mtime，不丢弃真实 token', async () => {
    const file = join(tmpDir, 'project', 'chats', 'session.jsonl');
    await writeJsonl(file, [{
      type: 'assistant',
      model: 'qwen-plus',
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    }]);
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const rows = (await scanQwenDates([day], tmpDir)).get(day)!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ inputTokens: 4, outputTokens: 2 }));
  });
});
