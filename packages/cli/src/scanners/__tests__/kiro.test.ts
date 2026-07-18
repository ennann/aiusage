import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanKiroDates } from '../kiro.js';

let tmpDir: string;
let originalKiroCreditCostEnv: string | undefined;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-kiro-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  originalKiroCreditCostEnv = process.env.KIRO_USE_CREDIT_COST;
});

afterEach(async () => {
  if (originalKiroCreditCostEnv === undefined) {
    delete process.env.KIRO_USE_CREDIT_COST;
  } else {
    process.env.KIRO_USE_CREDIT_COST = originalKiroCreditCostEnv;
  }

  await rm(tmpDir, { recursive: true, force: true });
});

function writeKiroChat(filePath: string, data: object): Promise<void> {
  return writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function writeKiroSessionJson(filePath: string, data: object): Promise<void> {
  return writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function writeKiroTokenLog(filePath: string, records: Array<Record<string, unknown>>): Promise<void> {
  const content = records.map((record) => JSON.stringify(record)).join('\n');
  return writeFile(filePath, `${content}\n`, 'utf-8');
}

function createSqliteDb(filePath: string): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqliteModule = require('node:sqlite') as typeof import('node:sqlite');
  return new sqliteModule.DatabaseSync(filePath, { open: true });
}

async function writeKiroTokenSqlite(filePath: string, rows: Array<{
  model: string;
  provider: string;
  promptTokens: number;
  generatedTokens: number;
  timestamp: string;
}>): Promise<void> {
  let db: ReturnType<typeof createSqliteDb> | null = null;
  try {
    db = createSqliteDb(filePath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tokens_generated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT,
        provider TEXT,
        tokens_generated INT,
        tokens_prompt INT,
        timestamp DATETIME
      )
    `);
    const stmt = db.prepare('INSERT INTO tokens_generated(model, provider, tokens_generated, tokens_prompt, timestamp) VALUES(?, ?, ?, ?, ?)');
    for (const row of rows) {
      stmt.run(row.model, row.provider, row.generatedTokens, row.promptTokens, row.timestamp);
    }
  } finally {
    if (db) db.close();
  }
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

  it('defaults model to claude-opus-4-8 when model metadata is missing', async () => {
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
    expect(breakdown[0].model).toBe('claude-opus-4-8');
    expect(breakdown[0].provider).toBe('kiro');
  });

  it('uses selectedModel when metadata model fields are absent', async () => {
    const day = '2026-01-23';
    await writeKiroSessionJson(
      join(tmpDir, 'selected-model.chat'),
      {
        selectedModel: 'claude-opus-4.6',
        created_at: `${day}T10:00:00.000Z`,
        session_id: 'selected-model',
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].model).toBe('claude-opus-4-6');
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

  it('reads Kiro session json files from ~/.kiro sessions format', async () => {
    const day = '2026-01-20';
    await writeKiroSessionJson(
      join(tmpDir, 'session.json'),
      {
        session_id: 'session-json-1',
        created_at: `${day}T11:00:00.000Z`,
        updated_at: `${day}T11:10:00.000Z`,
        session_state: {
          rts_model_state: {
            model_info: {
              model_id: 'claude-opus-4.6',
              model_name: 'claude-opus-4.6',
            },
          },
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
        model: 'claude-opus-4-6',
        channel: 'cli',
        eventCount: 1,
      }),
    );
  });

  it('normalizes Kiro Claude model names with dots to price-compatible dashes', async () => {
    const day = '2026-01-21';
    await writeKiroChat(
      join(tmpDir, 'opus-dot.chat'),
      {
        metadata: {
          startTime: `${day}T07:45:00.000Z`,
          modelId: 'claude-opus-4.6',
          executionId: 'opus-2026-01-21',
        },
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].model).toBe('claude-opus-4-6');
  });

  it('normalizes Kiro uppercase underscore Claude model metadata to canonical format', async () => {
    const day = '2026-01-22';
    await writeKiroSessionJson(
      join(tmpDir, 'sonnet-legacy.json'),
      {
        session_id: 'kiro-legacy',
        created_at: `${day}T06:00:00.000Z`,
        updated_at: `${day}T06:15:00.000Z`,
        session_state: {
          rts_model_state: {
            model_info: {
              model_id: 'CLAUDE_SONNET_4_20250514_V1_0',
            },
          },
        },
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].model).toBe('claude-sonnet-4');
  });

  it('adds prompt-only token estimates from kiro dev_data/tokens_generated.jsonl', async () => {
    const day = '2026-01-24';
    await mkdir(join(tmpDir, 'dev_data'), { recursive: true });
    await writeKiroTokenLog(
      join(tmpDir, 'dev_data', 'tokens_generated.jsonl'),
      [
        {
          model: 'agent',
          provider: 'kiro',
          promptTokens: 1200,
          generatedTokens: 500,
          timestamp: `${day}T09:00:00.000Z`,
        },
        {
          model: 'agent',
          provider: 'kiro',
          promptTokens: 300,
          generatedTokens: 0,
          timestamp: `${day}T10:00:00.000Z`,
        },
      ],
    );
    await writeKiroChat(
      join(tmpDir, 'chat-01.chat'),
      {
        metadata: {
          startTime: `${day}T11:00:00.000Z`,
          modelProvider: 'qdev',
          executionId: 'kiro-opex-1',
        },
      },
    );
    await writeKiroChat(
      join(tmpDir, 'chat-02.chat'),
      {
        metadata: {
          startTime: `${day}T12:00:00.000Z`,
          modelProvider: 'qdev',
          executionId: 'kiro-opex-2',
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
        model: 'claude-opus-4-6',
        channel: 'cli',
        eventCount: 2,
        inputTokens: 1500,
        outputTokens: 500,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningOutputTokens: 0,
      }),
    );
  });

  it('skips malformed tokens_generated.jsonl while still returning event counts', async () => {
    const day = '2026-01-25';
    await mkdir(join(tmpDir, 'dev_data'), { recursive: true });
    await writeFile(
      join(tmpDir, 'dev_data', 'tokens_generated.jsonl'),
      '{not valid json}\n',
      'utf-8',
    );
    await writeKiroChat(
      join(tmpDir, 'chat.chat'),
      {
        metadata: {
          startTime: `${day}T14:00:00.000Z`,
          modelId: 'gpt-4.1',
          executionId: 'kiro-malformed-token-file',
        },
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].eventCount).toBe(1);
    expect(breakdown[0].inputTokens).toBe(0);
  });

  it('reads token estimates from kiro dev_data/devdata.sqlite', async () => {
    const day = '2026-01-26';
    await mkdir(join(tmpDir, 'dev_data'), { recursive: true });
    const sqlitePath = join(tmpDir, 'dev_data', 'devdata.sqlite');

    try {
      await writeKiroTokenSqlite(
        sqlitePath,
        [
          {
            model: 'agent',
            provider: 'kiro',
            promptTokens: 1200,
            generatedTokens: 300,
            timestamp: `${day}T09:00:00.000Z`,
          },
          {
            model: 'agent',
            provider: 'kiro',
            promptTokens: 300,
            generatedTokens: 100,
            timestamp: `${day}T11:00:00.000Z`,
          },
        ],
      );
    } catch {
      return;
    }

    await writeKiroChat(
      join(tmpDir, 'chat-01.chat'),
      {
        metadata: {
          startTime: `${day}T10:00:00.000Z`,
          modelProvider: 'qdev',
          executionId: 'sqlite-kiro-1',
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
        model: 'claude-opus-4-6',
        channel: 'cli',
        eventCount: 1,
        inputTokens: 1500,
        outputTokens: 400,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningOutputTokens: 0,
      }),
    );
  });

  it('does not add estimated cost from metering_usage credits when explicitly disabled', async () => {
    process.env.KIRO_USE_CREDIT_COST = 'false';
    const day = '2026-01-27';
    await writeKiroSessionJson(
      join(tmpDir, 'session-credits.json'),
      {
        session_id: 'session-credits-01',
        created_at: `${day}T10:00:00.000Z`,
        updated_at: `${day}T10:10:00.000Z`,
        session_state: {
          conversation_metadata: {
            user_turn_metadatas: [
              {
                metering_usage: [
                  { value: 0.5, unit: 'credit' },
                  { value: 0.25, unit: 'credit' },
                ],
              },
            ],
          },
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
        channel: 'cli',
        eventCount: 1,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningOutputTokens: 0,
      }),
    );
    expect(breakdown[0].costUSD ?? 0).toBe(0);
  });

  it('adds estimated cost from metering_usage credits by default', async () => {
    const day = '2026-01-27';
    await writeKiroSessionJson(
      join(tmpDir, 'session-credits-default.json'),
      {
        session_id: 'session-credits-default',
        created_at: `${day}T10:00:00.000Z`,
        updated_at: `${day}T10:10:00.000Z`,
        session_state: {
          conversation_metadata: {
            user_turn_metadatas: [
              {
                metering_usage: [
                  { value: 0.5, unit: 'credit' },
                  { value: 0.25, unit: 'credit' },
                ],
              },
            ],
          },
        },
      },
    );

    const result = await scanKiroDates([day], tmpDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].costUSD).toBe(0.03);
  });

  it('adds estimated cost from metering_usage credits when explicitly enabled', async () => {
    process.env.KIRO_USE_CREDIT_COST = 'true';
    const day = '2026-01-27';
    await writeKiroSessionJson(
      join(tmpDir, 'session-credits.json'),
      {
        session_id: 'session-credits-01',
        created_at: `${day}T10:00:00.000Z`,
        updated_at: `${day}T10:10:00.000Z`,
        session_state: {
          conversation_metadata: {
            user_turn_metadatas: [
              {
                metering_usage: [
                  { value: 0.5, unit: 'credit' },
                  { value: 0.25, unit: 'credit' },
                ],
              },
            ],
          },
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
        channel: 'cli',
        eventCount: 1,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningOutputTokens: 0,
        costUSD: 0.03,
      }),
    );
  });
});
