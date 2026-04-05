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
      { type: 'user', timestamp: '2025-06-30T21:38:58.048Z' },
      { type: 'user', timestamp: '2025-07-15T18:07:20.242Z' },
      { type: 'user', timestamp: '2025-09-17T20:40:13.941Z' },
    ]);

    await writeJson(join(baseDir, 'project-a', 'session.json'), {
      data: {
        model: 'gemini-2.5-pro',
        messages: [
          {
            timestamp: '2025-09-17T20:40:13.941Z',
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
        outputTokens: 45,
        reasoningOutputTokens: 5,
      }),
    ]);
  });
});
