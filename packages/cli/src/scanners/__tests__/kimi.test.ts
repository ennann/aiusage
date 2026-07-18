import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveKimiCodeHome, scanKimiDates } from '../kimi.js';

let rootDir: string;
let previousKimiCodeHome: string | undefined;

beforeEach(async () => {
  rootDir = join(tmpdir(), `aiusage-kimi-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  previousKimiCodeHome = process.env.KIMI_CODE_HOME;
  delete process.env.KIMI_CODE_HOME;
  await mkdir(rootDir, { recursive: true });
});

afterEach(async () => {
  if (previousKimiCodeHome == null) delete process.env.KIMI_CODE_HOME;
  else process.env.KIMI_CODE_HOME = previousKimiCodeHome;
  await rm(rootDir, { recursive: true, force: true });
});

describe('scanKimiDates', () => {
  it('parses legacy nested StatusUpdate records and keeps the largest progressive update', async () => {
    const legacyHome = join(rootDir, '.kimi');
    const sessionDir = join(legacyHome, 'sessions', 'workspace-hash', 'legacy-session');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(legacyHome, 'kimi.json'),
      JSON.stringify({
        model: 'kimi-k2.6',
        workspaces: {
          'workspace-hash': { path: '/Users/test/Projects/legacy-project' },
        },
      }),
    );
    await writeFile(
      join(sessionDir, 'wire.jsonl'),
      [
        '{"type":"metadata","protocol_version":"1.3"}',
        JSON.stringify({
          timestamp: '2026-07-17T12:00:00Z',
          message: {
            type: 'StatusUpdate',
            payload: {
              message_id: 'progressive',
              token_usage: { input_other: 100, output: 10, input_cache_read: 5 },
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-17T12:01:00Z',
          message: {
            type: 'StatusUpdate',
            payload: {
              message_id: 'progressive',
              token_usage: {
                input_other: 120,
                output: 30,
                input_cache_read: 15,
                input_cache_creation: 7,
              },
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-17T12:02:00Z',
          message: {
            type: 'StatusUpdate',
            payload: {
              message_id: 'second',
              token_usage: { input_other: 80, output: 20, input_cache_read: 10 },
            },
          },
        }),
        'malformed',
      ].join('\n'),
    );

    const result = await scanKimiDates(['2026-07-17'], legacyHome);
    const [breakdown] = result.get('2026-07-17') ?? [];

    expect(breakdown).toMatchObject({
      provider: 'moonshot',
      product: 'kimi-code',
      model: 'kimi-k2.6',
      project: '/Users/test/Projects/legacy-project',
      projectDisplay: 'legacy-project',
      eventCount: 2,
      sessionCount: 1,
      inputTokens: 200,
      cachedInputTokens: 25,
      cacheWriteTokens: 7,
      outputTokens: 50,
    });
  });

  it('parses turn-scoped Kimi Code usage across main and subagents without double-counting session records', async () => {
    const legacyHome = join(rootDir, '.kimi');
    const codeHome = join(rootDir, '.kimi-code');
    const sessionDir = join(codeHome, 'sessions', 'wd_aiusage_123456789abc', 'session-one');
    const mainDir = join(sessionDir, 'agents', 'main');
    const subagentDir = join(sessionDir, 'agents', 'agent-0');
    await mkdir(mainDir, { recursive: true });
    await mkdir(subagentDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'state.json'),
      JSON.stringify({ workDir: '/Users/test/Projects/AI/aiusage' }),
    );
    await writeFile(
      join(mainDir, 'wire.jsonl'),
      [
        JSON.stringify({
          type: 'usage.record',
          model: 'kimi-code/k3',
          usage: { inputOther: 100, output: 20, inputCacheRead: 300, inputCacheCreation: 40 },
          usageScope: 'turn',
          time: Date.parse('2026-07-17T12:00:00Z'),
        }),
        JSON.stringify({
          type: 'usage.record',
          model: 'kimi-code/k3',
          usage: { inputOther: 999, output: 999, inputCacheRead: 999, inputCacheCreation: 999 },
          usageScope: 'session',
          time: Date.parse('2026-07-17T12:01:00Z'),
        }),
        JSON.stringify({
          type: 'usage.record',
          model: 'kimi-code/k3',
          usage: { inputOther: 888, output: 888 },
          time: Date.parse('2026-07-17T12:02:00Z'),
        }),
        JSON.stringify({
          type: 'context.append_loop_event',
          time: Date.parse('2026-07-17T12:03:00Z'),
        }),
      ].join('\n'),
    );
    await writeFile(
      join(subagentDir, 'wire.jsonl'),
      JSON.stringify({
        type: 'usage.record',
        model: 'kimi-code/k3',
        usage: { inputOther: 50, output: 10, inputCacheRead: 70, inputCacheCreation: -1 },
        usageScope: 'turn',
        time: Date.parse('2026-07-17T13:00:00Z'),
      }),
    );

    const result = await scanKimiDates(
      ['2026-07-17'],
      legacyHome,
      { aiusage: 'AIUsage' },
      codeHome,
    );
    const [breakdown] = result.get('2026-07-17') ?? [];

    expect(breakdown).toMatchObject({
      model: 'k3',
      project: '/Users/test/Projects/AI/aiusage',
      projectDisplay: 'aiusage',
      projectAlias: 'AIUsage',
      eventCount: 2,
      sessionCount: 1,
      inputTokens: 150,
      cachedInputTokens: 370,
      cacheWriteTokens: 40,
      outputTokens: 30,
    });
  });

  it('uses session_index.jsonl when a Kimi Code state file is missing', async () => {
    const legacyHome = join(rootDir, '.kimi');
    const codeHome = join(rootDir, '.kimi-code');
    const sessionDir = join(codeHome, 'sessions', 'wd_fallback_abcdef123456', 'session-two');
    const agentDir = join(sessionDir, 'agents', 'main');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(codeHome, 'session_index.jsonl'),
      JSON.stringify({
        sessionId: 'session-two',
        sessionDir,
        workDir: '/Users/test/Projects/indexed-project',
      }),
    );
    await writeFile(
      join(agentDir, 'wire.jsonl'),
      JSON.stringify({
        type: 'usage.record',
        model: 'kimi-code/k3',
        usage: { inputOther: 5, output: 2, inputCacheRead: 9, inputCacheCreation: 1 },
        usageScope: 'turn',
        time: Date.parse('2026-07-17T12:00:00Z'),
      }),
    );

    const result = await scanKimiDates(['2026-07-17'], legacyHome, undefined, codeHome);
    expect(result.get('2026-07-17')).toContainEqual(
      expect.objectContaining({
        project: '/Users/test/Projects/indexed-project',
        projectDisplay: 'indexed-project',
      }),
    );
  });
});

describe('resolveKimiCodeHome', () => {
  it('honors KIMI_CODE_HOME and trims whitespace', () => {
    process.env.KIMI_CODE_HOME = `  ${join(rootDir, 'custom-kimi')}  `;
    expect(resolveKimiCodeHome('/Users/fallback')).toBe(join(rootDir, 'custom-kimi'));
  });
});
