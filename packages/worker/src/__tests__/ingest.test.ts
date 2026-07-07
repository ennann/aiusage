import { describe, expect, it } from 'vitest';
import { handleIngest } from '../routes/ingest.js';
import { signDeviceToken } from '../utils/token.js';

interface DbCall {
  sql: string;
  bindings: unknown[];
}

function createMockDb() {
  const calls: DbCall[] = [];

  const db = {
    prepare(sql: string) {
      const call: DbCall = { sql, bindings: [] };
      calls.push(call);

      const statement = {
        bind(...bindings: unknown[]) {
          call.bindings = bindings;
          return statement;
        },
        async first() {
          if (sql.includes('SELECT status, token_version FROM devices')) {
            return { status: 'active', token_version: 1 };
          }
          return null;
        },
        async run() {
          return { success: true };
        },
      };

      return statement;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map(statement => statement.run()));
    },
  };

  return { db, calls };
}

async function makeRequest(days: unknown[]) {
  const token = await signDeviceToken({
    siteId: 'site-test',
    deviceId: 'device-test',
    tokenVersion: 1,
    issuedAt: '2026-07-06T12:00:00.000Z',
  }, 'test-secret');

  return new Request('https://example.com/api/v1/ingest/daily', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      siteId: 'site-test',
      schemaVersion: '1.0',
      generatedAt: '2026-07-06T12:00:00.000Z',
      device: {
        deviceId: 'device-test',
        hostname: 'test-host',
        timezone: 'UTC',
        appVersion: 'test',
      },
      days,
    }),
  });
}

describe('handleIngest', () => {
  it('prunes stale breakdown rows before writing corrected day rows', async () => {
    const { db, calls } = createMockDb();
    const request = await makeRequest([
      {
        usageDate: '2026-07-05',
        breakdowns: [
          {
            provider: 'openai',
            product: 'codex',
            channel: 'cli',
            model: 'gpt-5.5',
            project: '/real-session',
            eventCount: 1,
            inputTokens: 1000,
            cachedInputTokens: 500,
            cacheWriteTokens: 0,
            outputTokens: 100,
            reasoningOutputTokens: 0,
          },
        ],
      },
    ]);

    const response = await handleIngest(request, {
      DB: db,
      DEVICE_TOKEN_SECRET: 'test-secret',
    } as any);

    expect(response.status).toBe(200);

    const dailyUpsertIndex = calls.findIndex(call => call.sql.includes('INSERT INTO daily_usage'));
    const deleteIndex = calls.findIndex(call => call.sql.includes('DELETE FROM daily_usage_breakdown'));
    const breakdownInsertIndex = calls.findIndex(call => call.sql.includes('INSERT INTO daily_usage_breakdown'));

    expect(dailyUpsertIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(dailyUpsertIndex);
    expect(deleteIndex).toBeLessThan(breakdownInsertIndex);
    expect(calls[deleteIndex].bindings).toEqual(['device-test', '2026-07-05']);
  });

  it('can prune a corrected day that now has no breakdowns', async () => {
    const { db, calls } = createMockDb();
    const request = await makeRequest([
      {
        usageDate: '2026-07-05',
        breakdowns: [],
      },
    ]);

    const response = await handleIngest(request, {
      DB: db,
      DEVICE_TOKEN_SECRET: 'test-secret',
    } as any);

    expect(response.status).toBe(200);
    expect(calls.some(call => call.sql.includes('DELETE FROM daily_usage_breakdown'))).toBe(true);
    expect(calls.some(call => call.sql.includes('INSERT INTO daily_usage_breakdown'))).toBe(false);
  });
});
