import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanGeminiDates } from '../gemini.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-gemini-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

describe('scanGeminiDates', () => {
  it('uses logs.json as event-only fallback before token-bearing sessions begin', async () => {
    const baseDir = join(tmpDir, '.gemini', 'tmp');

    await writeJson(join(baseDir, 'project-a', 'logs.json'), [
      { type: 'user', timestamp: '2025-06-30T12:38:58.048Z' },
      { type: 'user', timestamp: '2025-07-15T12:07:20.242Z' },
      { type: 'user', timestamp: '2025-09-17T12:40:13.941Z' },
    ]);

    await writeJson(join(baseDir, 'project-a', 'session.json'), {
      data: {
        model: 'gemini-2.5-pro',
        messages: [
          {
            timestamp: '2025-09-17T12:40:13.941Z',
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 50,
              cachedContentTokenCount: 20,
              thoughtsTokenCount: 5,
            },
          },
        ],
      },
    });

    const result = await scanGeminiDates(['2025-06-30', '2025-07-15', '2025-09-17'], baseDir);

    expect(result.get('2025-06-30')).toEqual([
      expect.objectContaining({
        provider: 'google',
        product: 'gemini-cli',
        model: 'unknown',
        eventCount: 1,
      }),
    ]);

    expect(result.get('2025-07-15')).toEqual([
      expect.objectContaining({
        provider: 'google',
        product: 'gemini-cli',
        model: 'unknown',
        eventCount: 1,
      }),
    ]);

    expect(result.get('2025-09-17')).toEqual([
      expect.objectContaining({
        provider: 'google',
        product: 'gemini-cli',
        model: 'gemini-2.5-pro',
        eventCount: 1,
        inputTokens: 80,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningOutputTokens: 5,
      }),
    ]);
  });

  it('解析当前 headless JSONL，按消息 ID 采用最后一条并跳过损坏行', async () => {
    const baseDir = join(tmpDir, '.gemini', 'tmp');
    const path = join(baseDir, 'project-a', 'chats', 'session-current.jsonl');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, [
      JSON.stringify({ type: 'init', model: 'gemini-2.5-pro', session_id: 's1' }),
      '{broken',
      JSON.stringify({ type: 'gemini', id: 'm1', timestamp: '2026-07-18T10:00:00Z', tokens: { prompt: 100, cached: 30, candidates: 20, thoughts: 5 } }),
      JSON.stringify({ type: 'gemini', id: 'm1', timestamp: '2026-07-18T10:00:01Z', tokens: { prompt: 120, cached: 40, candidates: 25, thoughts: 6 } }),
    ].join('\n'));

    const rows = (await scanGeminiDates(['2026-07-18'], baseDir)).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        projectDisplay: 'project-a',
        eventCount: 1,
        inputTokens: 80,
        cachedInputTokens: 40,
        outputTokens: 25,
        reasoningOutputTokens: 6,
      }),
    ]);
  });

  it('解析 a2a 的 $set.messages 追加记录', async () => {
    const baseDir = join(tmpDir, '.gemini', 'tmp');
    const path = join(baseDir, 'project-b', 'chats', 'session-a2a.jsonl');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, [
      JSON.stringify({ kind: 'session', sessionId: 's2', startTime: '2026-07-18T09:00:00Z' }),
      JSON.stringify({ $set: { messages: [{
        id: 'm2', type: 'gemini', model: 'gemini-2.5-flash', timestamp: '2026-07-18T09:01:00Z',
        usageMetadata: { promptTokenCount: 20, cachedContentTokenCount: 5, candidatesTokenCount: 4 },
      }] } }),
    ].join('\n'));

    const rows = (await scanGeminiDates(['2026-07-18'], baseDir)).get('2026-07-18')!;
    expect(rows[0]).toEqual(expect.objectContaining({ inputTokens: 15, cachedInputTokens: 5, outputTokens: 4 }));
  });

  it('解析按模型分组的 headless stats', async () => {
    const baseDir = join(tmpDir, '.gemini', 'tmp');
    await writeJson(join(baseDir, 'project-c', 'session-headless.json'), {
      timestamp: '2026-07-18T08:00:00Z',
      stats: { models: { 'gemini-2.5-pro': { tokens: { prompt: 12, cached: 5, candidates: 3, thoughts: 2 } } } },
    });

    const rows = (await scanGeminiDates(['2026-07-18'], baseDir)).get('2026-07-18')!;
    expect(rows[0]).toEqual(expect.objectContaining({
      inputTokens: 7, cachedInputTokens: 5, outputTokens: 3, reasoningOutputTokens: 2,
    }));
  });
});
