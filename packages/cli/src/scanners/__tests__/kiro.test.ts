import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanKiroDates } from '../kiro.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-kiro-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function writeKiroChat(filePath: string, data: object): Promise<void> {
  return writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

describe('scanKiroDates', () => {
  it('extracts a valid chat file as one event with correct date bucket', async () => {
    const day = '2026-01-15';
    await writeKiroChat(
      join(tmpDir, 'single.chat'),
      {
        metadata: {
          startTime: `${day}T10:22:33.123Z`,
          modelProvider: 'openai',
          modelId: 'gpt-4.1',
          executionId: 'exec-1',
        },
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual(
      expect.objectContaining({
        provider: 'kiro',
        product: 'kiro',
        model: 'gpt-4.1',
        channel: 'cli',
        eventCount: 1,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningOutputTokens: 0,
      }),
    );
  });

  it('deduplicates duplicate files by executionId', async () => {
    const day = '2026-01-16';
    const payload = {
      metadata: {
        startTime: `${day}T08:00:00.000Z`,
        modelId: 'gpt-4.1',
      },
      executionId: 'same-execution',
    };

    await writeKiroChat(join(tmpDir, 'a.chat'), payload);
    await writeKiroChat(join(tmpDir, 'b.chat'), payload);

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual(
      expect.objectContaining({
        eventCount: 1,
      }),
    );
  });

  it('skips malformed json without failing the scan', async () => {
    await writeFile(join(tmpDir, 'broken.chat'), '{invalid json', 'utf-8');
    await mkdir(join(tmpDir, 'nested'), { recursive: true });
    await writeKiroChat(
      join(tmpDir, 'nested', 'good.chat'),
      {
        metadata: {
          startTime: '2026-01-17T09:01:00.000Z',
          modelId: 'gpt-4.1',
          executionId: 'exec-3',
        },
      },
    );

    const result = await scanKiroDates(['2026-01-17'], tmpDir);
    const breakdown = result.get('2026-01-17') ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].eventCount).toBe(1);
  });

  it('defaults model to unknown when model metadata is missing', async () => {
    const day = '2026-01-18';
    await writeKiroChat(
      join(tmpDir, 'missing-model.chat'),
      {
        metadata: {
          startTime: `${day}T13:00:00.000Z`,
          executionId: 'exec-unknown',
        },
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].model).toBe('unknown');
    expect(breakdown[0].provider).toBe('kiro');
  });

  it('counts only event count when scanning multiple same-day files and keeps token fields at zero', async () => {
    const day = '2026-01-19';
    await writeKiroChat(
      join(tmpDir, 'day-1.chat'),
      {
        metadata: {
          endTime: `${day}T07:00:00.000Z`,
          modelId: 'gpt-4.1',
          executionId: 'exec-1',
        },
      },
    );
    await writeKiroChat(
      join(tmpDir, 'day-2.chat'),
      {
        metadata: {
          endTime: `${day}T15:00:00.000Z`,
          modelId: 'gpt-4.1',
          executionId: 'exec-2',
        },
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].eventCount).toBe(2);
    expect(breakdown[0].inputTokens).toBe(0);
    expect(breakdown[0].outputTokens).toBe(0);
    expect(breakdown[0].cachedInputTokens).toBe(0);
    expect(breakdown[0].cacheWriteTokens).toBe(0);
    expect(breakdown[0].reasoningOutputTokens).toBe(0);
  });
});
