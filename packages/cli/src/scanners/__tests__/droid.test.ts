import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeDroidModel, scanDroidDates } from '../droid.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-droid-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('scanDroidDates', () => {
  it('无需 transcript 即可读取 settings，保留五类 token 并归一化模型', async () => {
    const path = join(tmpDir, 'Users-test-aiusage', 'session.settings.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({
      model: 'custom:Claude-Opus-4.5-Thinking-[Anthropic]-0',
      providerLock: 'anthropic',
      providerLockTimestamp: '2026-07-18T10:00:00Z',
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationTokens: 12,
        cacheReadTokens: 30,
        thinkingTokens: 5,
      },
    }));

    const rows = (await scanDroidDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        product: 'droid',
        model: 'claude-opus-4-5-thinking-0',
        inputTokens: 100,
        cachedInputTokens: 30,
        cacheWriteTokens: 12,
        outputTokens: 20,
        reasoningOutputTokens: 5,
      }),
    ]);
  });

  it('模型缺失时可从 transcript 的 Model 提示恢复', async () => {
    const base = join(tmpDir, 'repo', 'session');
    await mkdir(dirname(base), { recursive: true });
    await writeFile(`${base}.jsonl`, '{"text":"Model: Gemini 2.5 Pro [Google]"}\n');
    await writeFile(`${base}.settings.json`, JSON.stringify({
      providerLockTimestamp: '2026-07-18T10:00:00Z',
      tokenUsage: { inputTokens: 1 },
    }));

    const rows = (await scanDroidDates(['2026-07-18'], tmpDir)).get('2026-07-18')!;
    expect(rows[0]).toEqual(expect.objectContaining({ model: 'gemini-2-5-pro', provider: 'google' }));
  });
});

describe('normalizeDroidModel', () => {
  it('清理 custom 前缀、供应商括号、点号和重复连接符', () => {
    expect(normalizeDroidModel('custom:Claude-Sonnet-4.6-[Anthropic]')).toBe('claude-sonnet-4-6');
  });
});
