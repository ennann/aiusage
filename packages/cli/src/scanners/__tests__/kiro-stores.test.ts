import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanKiroDates } from '../kiro.js';

// 这些测试覆盖新版 Kiro 存储读取：
//   - ~/.kiro/sessions/<ws>/sess_*/messages.jsonl  (usage_summary / promptTurnSummaries)
//   - kiro-cli/data.sqlite3 的 conversations_v2     (usage_info)
// 以及跨存储按 conversation id 去重。

let tmpDir: string;
let baseDir: string;     // 空目录，供旧版 .chat/.json 扫描（应找不到东西）
let sessionsRoot: string;
let dbPath: string;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-kiro-stores-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  baseDir = join(tmpDir, 'base');
  sessionsRoot = join(tmpDir, 'sessions');
  dbPath = join(tmpDir, 'data.sqlite3');
  await mkdir(baseDir, { recursive: true });
  await mkdir(sessionsRoot, { recursive: true });

  for (const key of ['KIRO_USE_CREDIT_COST', 'KIRO_SESSIONS_DIR', 'KIRO_CLI_DB_PATH']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.KIRO_USE_CREDIT_COST = 'true';
});

afterEach(async () => {
  for (const key of ['KIRO_USE_CREDIT_COST', 'KIRO_SESSIONS_DIR', 'KIRO_CLI_DB_PATH']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await rm(tmpDir, { recursive: true, force: true });
});

function usageSummaryLine(timestamp: string, credits: number): string {
  return JSON.stringify({
    id: `${timestamp}-usage`,
    timestamp,
    payload: {
      type: 'usage_summary',
      promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: credits }],
    },
  });
}

async function writeAgentSession(
  ws: string,
  sessName: string,
  meta: Record<string, unknown>,
  lines: string[],
): Promise<void> {
  const dir = join(sessionsRoot, ws, sessName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'session.json'), JSON.stringify(meta), 'utf-8');
  await writeFile(join(dir, 'messages.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
}

function createSqliteDb(filePath: string): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqliteModule = require('node:sqlite') as typeof import('node:sqlite');
  return new sqliteModule.DatabaseSync(filePath, { open: true });
}

function writeConversationsV2(
  filePath: string,
  rows: Array<{ conversationId: string; value: unknown; updatedAt: number }>,
): void {
  const db = createSqliteDb(filePath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_v2 (
        key TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, conversation_id)
      )
    `);
    const stmt = db.prepare(
      'INSERT INTO conversations_v2(key, conversation_id, value, created_at, updated_at) VALUES(?, ?, ?, ?, ?)',
    );
    for (const row of rows) {
      stmt.run(`key-${row.conversationId}`, row.conversationId, JSON.stringify(row.value), row.updatedAt, row.updatedAt);
    }
  } finally {
    db.close();
  }
}

function sumCost(breakdowns: Array<{ costUSD?: number }>): number {
  return breakdowns.reduce((acc, b) => acc + (b.costUSD ?? 0), 0);
}

describe('scanKiroDates new stores', () => {
  it('reads credits from agent sess_*/messages.jsonl (per-line date attribution)', async () => {
    const day = '2026-02-10';
    process.env.KIRO_SESSIONS_DIR = sessionsRoot;
    await writeAgentSession(
      'ws1',
      'sess_aaaaaaaa-0000-0000-0000-000000000001',
      { id: 'sess_aaaaaaaa-0000-0000-0000-000000000001', modelId: 'claude-opus-4.8' },
      [
        usageSummaryLine(`${day}T12:00:00.000`, 10),
        usageSummaryLine(`${day}T13:00:00.000`, 15),
      ],
    );

    const result = await scanKiroDates([day], baseDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual(
      expect.objectContaining({ provider: 'kiro', product: 'kiro', channel: 'cli', model: 'claude-opus-4-8' }),
    );
    // (10 + 15) credits * 0.04 = 1.00
    expect(breakdown[0].costUSD).toBeCloseTo(1.0, 6);
  });

  it('splits a session that spans two days by each turn timestamp', async () => {
    const day1 = '2026-02-10';
    const day2 = '2026-02-11';
    process.env.KIRO_SESSIONS_DIR = sessionsRoot;
    await writeAgentSession(
      'ws1',
      'sess_bbbbbbbb-0000-0000-0000-000000000002',
      { id: 'sess_bbbbbbbb-0000-0000-0000-000000000002', modelId: 'claude-opus-4.8' },
      [
        usageSummaryLine(`${day1}T23:30:00.000`, 5),
        usageSummaryLine(`${day2}T00:30:00.000`, 20),
      ],
    );

    const result = await scanKiroDates([day1, day2], baseDir);
    expect((result.get(day1) ?? [])[0]?.costUSD).toBeCloseTo(0.2, 6); // 5 * 0.04
    expect((result.get(day2) ?? [])[0]?.costUSD).toBeCloseTo(0.8, 6); // 20 * 0.04
  });

  it('reads credits from kiro-cli data.sqlite3 conversations_v2 (usage_info)', async () => {
    const day = '2026-02-12';
    const updatedAt = new Date(`${day}T12:00:00`).getTime();
    writeConversationsV2(dbPath, [
      {
        conversationId: 'conv-db-1',
        updatedAt,
        value: {
          model_info: { model_id: 'claude-opus-4.8' },
          user_turn_metadata: { usage_info: [{ value: 2.5, unit: 'credit', unit_plural: 'credits' }] },
        },
      },
    ]);
    process.env.KIRO_CLI_DB_PATH = dbPath;

    const result = await scanKiroDates([day], baseDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].model).toBe('claude-opus-4-8');
    expect(breakdown[0].costUSD).toBeCloseTo(0.1, 6); // 2.5 * 0.04
  });

  it('does not double-count a conversation present in both the cli session and the agent store', async () => {
    const day = '2026-02-13';
    // 旧版 cli 会话（带 metering credits），session_id = dup-conv
    await writeFile(
      join(baseDir, 'dup.json'),
      JSON.stringify({
        session_id: 'dup-conv',
        created_at: `${day}T12:00:00.000`,
        session_state: {
          conversation_metadata: {
            user_turn_metadatas: [{ metering_usage: [{ value: 0.5, unit: 'credit' }] }],
          },
        },
      }),
      'utf-8',
    );
    // 同一对话也出现在 agent 存储里，convId 相同
    process.env.KIRO_SESSIONS_DIR = sessionsRoot;
    await writeAgentSession(
      'ws1',
      'sess_dup-conv',
      { id: 'dup-conv', modelId: 'claude-opus-4.8' },
      [usageSummaryLine(`${day}T12:30:00.000`, 100)],
    );

    const result = await scanKiroDates([day], baseDir);
    const breakdown = result.get(day) ?? [];
    // 只计入 cli 的 0.5 credit => 0.02，agent 的 100 credit 被去重跳过
    expect(sumCost(breakdown)).toBeCloseTo(0.02, 6);
    expect(breakdown.some((b) => b.model === 'claude-opus-4-8')).toBe(false);
  });

  it('adds events but no cost when credit estimation is disabled', async () => {
    process.env.KIRO_USE_CREDIT_COST = 'false';
    const day = '2026-02-14';
    process.env.KIRO_SESSIONS_DIR = sessionsRoot;
    await writeAgentSession(
      'ws1',
      'sess_cccccccc-0000-0000-0000-000000000003',
      { id: 'sess_cccccccc-0000-0000-0000-000000000003', modelId: 'claude-opus-4.8' },
      [usageSummaryLine(`${day}T12:00:00.000`, 42)],
    );

    const result = await scanKiroDates([day], baseDir);
    const breakdown = result.get(day) ?? [];
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].eventCount).toBe(1);
    expect(breakdown[0].costUSD ?? 0).toBe(0);
  });
});
