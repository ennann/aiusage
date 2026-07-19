import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deduplicateOpenCodeRecords,
  detectOpenCodeSqliteRuntime,
  discoverOpenCodeDatabases,
  discoverOpenCodeUsageDates,
  isOpenCodeDatabaseFilename,
  parseOpenCodeSqliteRows,
  resolveOpenCodeDataDir,
  resolveOpenCodeSources,
  scanOpencodeDates,
} from '../opencode.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'aiusage-opencode-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('OpenCode source discovery', () => {
  it('honors XDG_DATA_HOME and OPENCODE_DB while discovering every channel database', async () => {
    const dataDir = join(tmpDir, 'xdg', 'opencode');
    const externalDir = join(tmpDir, 'external');
    await mkdir(dataDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    for (const name of [
      'opencode.db',
      'opencode-stable.db',
      'opencode-next.db',
      'opencode.db-wal',
      'opencode-next.db-shm',
      'not-opencode.db',
    ]) {
      await writeFile(join(dataDir, name), '');
    }
    const externalDb = join(externalDir, 'opencode-nightly.db');
    await writeFile(externalDb, '');

    expect(resolveOpenCodeDataDir('/home/test', { XDG_DATA_HOME: join(tmpDir, 'xdg') })).toBe(dataDir);
    expect(isOpenCodeDatabaseFilename('opencode-next.db')).toBe(true);
    expect(isOpenCodeDatabaseFilename('opencode.db-wal')).toBe(false);
    expect(await detectOpenCodeSqliteRuntime()).toBe('node');

    const sources = await resolveOpenCodeSources({
      homeDir: '/home/test',
      env: { XDG_DATA_HOME: join(tmpDir, 'xdg'), OPENCODE_DB: externalDb },
    });
    expect(sources.dbPaths).toEqual([
      join(dataDir, 'opencode-next.db'),
      join(dataDir, 'opencode-stable.db'),
      join(dataDir, 'opencode.db'),
      externalDb,
    ].sort((a, b) => a.localeCompare(b)));
  });

  it('deduplicates configured paths and ignores stale or sidecar entries', async () => {
    const dbPath = join(tmpDir, 'opencode.db');
    const sidecar = join(tmpDir, 'opencode.db-wal');
    await writeFile(dbPath, '');
    await writeFile(sidecar, '');

    expect(await discoverOpenCodeDatabases(tmpDir, [dbPath, sidecar, join(tmpDir, 'opencode-missing.db')])).toEqual([dbPath]);
  });
});

describe('OpenCode message parsing and deduplication', () => {
  it('parses v1 rows and lets the top-level model/provider win over nested fields', () => {
    const records = parseOpenCodeSqliteRows([{
      id: 'row-1',
      session_id: 'ses-1',
      workspace_root: '/Users/test/sqlite-project///',
      data: JSON.stringify({
        id: 'msg-1',
        sessionID: 'stale-embedded-session',
        role: 'assistant',
        modelID: 'gpt-5.6',
        providerID: 'openai-codex',
        model: { id: 'wrong-model', providerID: 'wrong-provider' },
        cost: 0.75,
        time: { created: Date.parse('2026-07-18T08:00:00Z') },
        tokens: { input: 7, output: 3, reasoning: 2, cache: { read: 5, write: 1 } },
      }),
    }]);

    expect(records).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        sessionId: 'ses-1',
        provider: 'openai',
        model: 'gpt-5.6',
        projectRoot: '/Users/test/sqlite-project',
        costUSD: 0.75,
        tokens: { input: 7, cached: 5, cacheWrite: 1, output: 3, reasoning: 2 },
      }),
    ]);
  });

  it('keeps provider-reported cost when a valid assistant message has zero tokens', () => {
    const records = parseOpenCodeSqliteRows([{
      id: 'row-cost-only',
      session_id: 'ses-cost-only',
      data: JSON.stringify({
        id: 'msg-cost-only',
        role: 'assistant',
        modelID: 'cost-only-model',
        providerID: 'custom-provider',
        cost: 0.12,
        time: { created: Date.parse('2026-07-18T08:30:00Z') },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    }]);

    expect(records).toEqual([
      expect.objectContaining({ costUSD: 0.12, sessionId: 'ses-cost-only' }),
    ]);
  });

  it('keeps distinct ids with the same fingerprint but merges fork copies and project conflicts', () => {
    const rows = ['msg-a', 'msg-b'].map(id => ({
      id: `row-${id}`,
      session_id: 'ses-1',
      workspace_root: '/repo/a',
      data: JSON.stringify({
        id,
        role: 'assistant',
        modelID: 'gpt-5',
        providerID: 'openai',
        time: { created: Date.parse('2026-07-18T08:00:00Z') },
        tokens: { input: 10, output: 2, cache: { read: 0, write: 0 } },
      }),
    }));
    const [a, b] = parseOpenCodeSqliteRows(rows);
    const fork = { ...a, projectRoot: '/repo/b', tokens: { ...a.tokens } };

    const deduped = deduplicateOpenCodeRecords([a, b, fork]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find(record => record.id === 'msg-a')?.projectRoot).toBeUndefined();
  });
});

describe('scanOpencodeDates', () => {
  it('keeps legacy JSON strict to explicit assistant messages', async () => {
    const legacyDir = join(tmpDir, 'storage', 'message', 'ses_1');
    await mkdir(legacyDir, { recursive: true });
    const base = {
      time: { created: Date.parse('2026-07-18T08:00:00Z') },
      modelID: 'claude-sonnet-4-6',
      providerID: 'anthropic',
      path: { root: '/Users/test/repo' },
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } },
    };
    await writeFile(join(legacyDir, 'assistant.json'), JSON.stringify({ ...base, id: 'm1', role: 'assistant' }));
    await writeFile(join(legacyDir, 'user.json'), JSON.stringify({ ...base, id: 'm2', role: 'user' }));
    await writeFile(join(legacyDir, 'missing-role.json'), JSON.stringify({ ...base, id: 'm3' }));

    const rows = (await scanOpencodeDates(['2026-07-18'], {
      dataDir: tmpDir,
      legacyDir: join(tmpDir, 'storage', 'message'),
      env: {},
    })).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        product: 'opencode',
        eventCount: 1,
        sessionCount: 1,
        inputTokens: 100,
        cachedInputTokens: 30,
        cacheWriteTokens: 10,
        outputTokens: 20,
        reasoningOutputTokens: 5,
      }),
    ]);
  });

  it('reads v2 session_message, nested model/provider, cost, workspace and usage dates', async () => {
    const dbPath = join(tmpDir, 'opencode-next.db');
    createV2Database(dbPath, [{
      rowId: 'row-v2',
      messageId: 'msg-v2',
      sessionId: 'ses-v2',
      type: 'assistant',
      workspace: '/Users/test/v2-project',
      data: {
        model: { id: 'gpt-5.6', providerID: 'openai-codex' },
        cost: 0.42,
        mode: 'build',
        time: { created: Date.parse('2026-07-18T09:00:00Z') },
        tokens: { input: 200, output: 40, reasoning: 10, cache: { read: 60, write: 20 } },
      },
    }, {
      rowId: 'row-user',
      messageId: 'msg-user',
      sessionId: 'ses-v2',
      type: 'user',
      workspace: '/Users/test/v2-project',
      data: {
        model: { id: 'gpt-5.6', providerID: 'openai' },
        time: { created: Date.parse('2026-07-18T09:01:00Z') },
        tokens: { input: 999, output: 999, cache: { read: 0, write: 0 } },
      },
    }]);
    const malformedDb = new DatabaseSync(dbPath);
    try {
      malformedDb.prepare('INSERT INTO session_message (id, session_id, type, data) VALUES (?, ?, ?, ?)')
        .run('row-malformed', 'ses-v2', 'assistant', '{');
    } finally {
      malformedDb.close();
    }

    const options = { dataDir: tmpDir, legacyDir: join(tmpDir, 'legacy'), env: {} };
    const rows = (await scanOpencodeDates(['2026-07-18'], options)).get('2026-07-18')!;
    expect(rows).toEqual([
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.6',
        project: '/Users/test/v2-project',
        eventCount: 1,
        sessionCount: 1,
        inputTokens: 200,
        cachedInputTokens: 60,
        cacheWriteTokens: 20,
        outputTokens: 40,
        reasoningOutputTokens: 10,
        costUSD: 0.42,
      }),
    ]);
    expect(await discoverOpenCodeUsageDates(options)).toEqual(new Set(['2026-07-18']));
  });

  it('deduplicates v2/v1 dual writes and merges multiple channel databases', async () => {
    const defaultDb = join(tmpDir, 'opencode.db');
    const channelDb = join(tmpDir, 'opencode-stable.db');
    createDualWriteDatabase(defaultDb);
    createV1Database(channelDb, {
      rowId: 'row-channel',
      messageId: 'msg-channel',
      sessionId: 'ses-channel',
      workspace: '/Users/test/channel-project',
      data: {
        role: 'assistant',
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        cost: 0.25,
        time: { created: Date.parse('2026-07-18T10:00:00Z') },
        tokens: { input: 50, output: 5, cache: { read: 10, write: 2 } },
      },
    });

    const rows = (await scanOpencodeDates(['2026-07-18'], {
      dataDir: tmpDir,
      legacyDir: join(tmpDir, 'legacy'),
      env: {},
    })).get('2026-07-18')!;

    expect(rows.reduce((sum, row) => sum + row.eventCount, 0)).toBe(2);
    expect(rows.reduce((sum, row) => sum + (row.costUSD ?? 0), 0)).toBeCloseTo(0.75);
    expect(rows.find(row => row.model === 'gpt-5')?.eventCount).toBe(1);
    expect(rows.find(row => row.model === 'claude-sonnet-4-6')?.eventCount).toBe(1);
  });

  it('keeps distinct fallback row ids across channel databases', async () => {
    const defaultDb = join(tmpDir, 'opencode.db');
    const channelDb = join(tmpDir, 'opencode-nightly.db');
    const common = {
      sessionId: 'ses-no-id',
      workspace: '/Users/test/no-id-project',
      data: {
        role: 'assistant',
        modelID: 'gpt-5',
        providerID: 'openai',
        time: { created: Date.parse('2026-07-18T11:00:00Z') },
        tokens: { input: 25, output: 5, cache: { read: 0, write: 0 } },
      },
    };
    createV1Database(defaultDb, { ...common, rowId: 'row-no-id-a' });
    createV1Database(channelDb, { ...common, rowId: 'row-no-id-b' });

    const rows = (await scanOpencodeDates(['2026-07-18'], {
      dataDir: tmpDir,
      legacyDir: join(tmpDir, 'legacy'),
      env: {},
    })).get('2026-07-18')!;

    expect(rows).toEqual([
      expect.objectContaining({ eventCount: 2, inputTokens: 50, outputTokens: 10 }),
    ]);
  });
});

interface V2Fixture {
  rowId: string;
  messageId?: string;
  sessionId: string;
  type: string;
  workspace: string;
  data: Record<string, unknown>;
}

type V1Fixture = Omit<V2Fixture, 'type'>;

function createV2Database(path: string, fixtures: V2Fixture[]): void {
  ensureParent(path);
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);');
    db.exec('CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, data TEXT);');
    const sessionInsert = db.prepare('INSERT OR IGNORE INTO session (id, directory) VALUES (?, ?)');
    const messageInsert = db.prepare('INSERT INTO session_message (id, session_id, type, data) VALUES (?, ?, ?, ?)');
    for (const fixture of fixtures) {
      sessionInsert.run(fixture.sessionId, fixture.workspace);
      messageInsert.run(fixture.rowId, fixture.sessionId, fixture.type, JSON.stringify({
        id: fixture.messageId,
        sessionID: fixture.sessionId,
        ...fixture.data,
      }));
    }
  } finally {
    db.close();
  }
}

function createV1Database(path: string, fixture: V1Fixture): void {
  ensureParent(path);
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);');
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);');
    db.prepare('INSERT INTO session (id, directory) VALUES (?, ?)').run(fixture.sessionId, fixture.workspace);
    db.prepare('INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)').run(
      fixture.rowId,
      fixture.sessionId,
      JSON.stringify({ id: fixture.messageId, sessionID: fixture.sessionId, ...fixture.data }),
    );
  } finally {
    db.close();
  }
}

function createDualWriteDatabase(path: string): void {
  ensureParent(path);
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);');
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);');
    db.exec('CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, data TEXT);');
    db.prepare('INSERT INTO session (id, directory) VALUES (?, ?)').run('ses-dual', '/Users/test/dual-project');
    const common = {
      id: 'msg-dual',
      sessionID: 'ses-dual',
      cost: 0.5,
      time: { created: Date.parse('2026-07-18T08:00:00Z') },
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } },
    };
    db.prepare('INSERT INTO session_message (id, session_id, type, data) VALUES (?, ?, ?, ?)').run(
      'row-v2',
      'ses-dual',
      'assistant',
      JSON.stringify({ ...common, model: { id: 'gpt-5', providerID: 'openai' } }),
    );
    db.prepare('INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)').run(
      'row-v1',
      'ses-dual',
      JSON.stringify({ ...common, role: 'assistant', modelID: 'gpt-5', providerID: 'openai' }),
    );
  } finally {
    db.close();
  }
}

function ensureParent(path: string): void {
  // Test paths are created under mkdtemp; synchronous SQLite only needs the parent to exist.
  if (dirname(path) !== tmpDir) throw new Error('fixture database must stay inside the temporary directory');
}
