import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanTraeDates } from '../trae.js';

let rootDir: string;
let nativeDir: string;
let tokscaleDir: string;

beforeEach(async () => {
  rootDir = join(tmpdir(), `aiusage-trae-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  nativeDir = join(rootDir, 'native');
  tokscaleDir = join(rootDir, 'tokscale');
  await Promise.all([
    mkdir(nativeDir, { recursive: true }),
    mkdir(tokscaleDir, { recursive: true }),
  ]);
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('scanTraeDates', () => {
  it('reads the minimized Trae CN cache and deduplicates message ids', async () => {
    const session = {
      schemaVersion: 1,
      source: 'trae-cn-local-rpc',
      syncedAt: '2026-07-19T00:00:00Z',
      sessionId: 'session-cn-1',
      project: '/Users/test/Projects/trae-project',
      events: [{
        messageId: 'message-1',
        timestamp: '2026-07-17T12:00:00Z',
        model: 'Claude Sonnet 4.6',
        inputTokens: 100,
        cachedInputTokens: 300,
        cacheWriteTokens: 40,
        outputTokens: 20,
        reasoningOutputTokens: 10,
      }],
    };
    await writeFile(join(nativeDir, 'one.json'), JSON.stringify(session));
    await writeFile(join(nativeDir, 'duplicate.json'), JSON.stringify(session));

    const result = await scanTraeDates(['2026-07-17'], {
      nativeCacheDir: nativeDir,
      tokscaleCacheDir: tokscaleDir,
      projectAliases: { 'trae-project': 'Trae 项目' },
    });

    expect(result.get('2026-07-17')).toEqual([expect.objectContaining({
      provider: 'anthropic',
      product: 'trae',
      channel: 'ide',
      model: 'claude-sonnet-4.6',
      project: '/Users/test/Projects/trae-project',
      projectDisplay: 'trae-project',
      projectAlias: 'Trae 项目',
      eventCount: 1,
      sessionCount: 1,
      inputTokens: 100,
      cachedInputTokens: 300,
      cacheWriteTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 10,
    })]);
  });

  it('parses tokscale Trae caches with model and provider normalization', async () => {
    await writeFile(join(tokscaleDir, 'page-1.json'), JSON.stringify([
      {
        model_name: 'GPT-5.4',
        session_id: 'intl-1',
        usage_time: 1784289600,
        dollar_float: 0.5,
        extra_info: {
          input_token: 1000,
          output_token: 500,
          cache_read_token: 200,
          cache_write_token: 100,
        },
      },
      {
        model_name: '',
        mode: 'Auto',
        session_id: 'intl-2',
        usage_time: 1784289600,
        extra_info: {
          input_token: 50,
          output_token: 5,
          cache_read_token: 0,
          cache_write_token: 0,
        },
      },
    ]));

    const result = await scanTraeDates(['2026-07-17'], {
      nativeCacheDir: nativeDir,
      tokscaleCacheDir: tokscaleDir,
    });
    const breakdowns = result.get('2026-07-17') ?? [];

    expect(breakdowns).toContainEqual(expect.objectContaining({
      provider: 'openai',
      product: 'trae',
      model: 'gpt-5.4',
      eventCount: 1,
      sessionCount: 1,
      inputTokens: 1000,
      cachedInputTokens: 200,
      cacheWriteTokens: 100,
      outputTokens: 500,
      costUSD: 0.5,
    }));
    expect(breakdowns).toContainEqual(expect.objectContaining({
      provider: 'trae',
      model: 'trae-auto',
      inputTokens: 50,
      outputTokens: 5,
    }));
  });
});
