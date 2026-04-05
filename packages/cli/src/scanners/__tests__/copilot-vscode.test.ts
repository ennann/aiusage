import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanCopilotVscodeDates } from '../copilot-vscode.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-copilot-vscode-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeCopilotLog(lines: string[]): Promise<void> {
  const logDir = join(tmpDir, '20260212T093859', 'window1', 'exthost', 'GitHub.copilot-chat');
  await mkdir(logDir, { recursive: true });
  await writeFile(join(logDir, 'GitHub Copilot Chat.log'), `${lines.join('\n')}\n`);
}

async function writeWorkspaceSession(opts: {
  rootDir?: string;
  workspaceId: string;
  folderUri: string;
  sessionId: string;
  timestamp: number;
  modelId: string;
}): Promise<void> {
  const workspaceDir = join(opts.rootDir ?? tmpDir, opts.workspaceId);
  await mkdir(join(workspaceDir, 'chatSessions'), { recursive: true });
  await writeFile(
    join(workspaceDir, 'workspace.json'),
    JSON.stringify({ folder: opts.folderUri }, null, 2),
  );
  await writeFile(
    join(workspaceDir, 'chatSessions', `${opts.sessionId}.json`),
    JSON.stringify({
      version: 3,
      requests: [
        {
          requestId: `request_${opts.sessionId}`,
          response: [{ value: 'Done' }],
          timestamp: opts.timestamp,
          modelId: opts.modelId,
        },
      ],
      sessionId: opts.sessionId,
      creationDate: opts.timestamp - 1000,
      lastMessageDate: opts.timestamp,
    }, null, 2),
  );
}

describe('scanCopilotVscodeDates', () => {
  it('counts successful chat completions as IDE usage events', async () => {
    await writeCopilotLog([
      '2026-02-12 09:39:03.512 [info] Got Copilot token for hubeiqiao',
      '2026-02-12 09:39:05.000 [info] Open workspace file:///Users/test/project-one',
      '2026-02-12 09:40:20.336 [info] ccreq:4380bcbb.copilotmd | success | gpt-4.1 -> gpt-4.1-2025-04-14 | 2277ms | [settingsEditorSearchSuggestions]',
      '2026-02-12 09:40:30.000 [info] ccreq:4390bcbb.copilotmd | error | gpt-4.1 -> gpt-4.1-2025-04-14 | 300ms | [settingsEditorSearchSuggestions]',
      '2026-02-12 09:41:20.336 [info] ccreq:4490bcbb.copilotmd | success | claude-sonnet-4.5 | 199ms | [chat]',
    ]);

    const result = await scanCopilotVscodeDates(
      ['2026-02-12'],
      tmpDir,
      { '/Users/test/project-one': 'Project One' },
    );

    const breakdowns = result.get('2026-02-12') ?? [];
    expect(breakdowns).toHaveLength(2);

    expect(breakdowns).toContainEqual({
      provider: 'github',
      product: 'copilot-vscode',
      channel: 'ide',
      model: 'gpt-4.1-2025-04-14',
      project: 'Project One',
      eventCount: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });

    expect(breakdowns).toContainEqual({
      provider: 'github',
      product: 'copilot-vscode',
      channel: 'ide',
      model: 'claude-sonnet-4.5',
      project: 'Project One',
      eventCount: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });

  it('returns empty results when the logs contain no successful completions', async () => {
    await writeCopilotLog([
      '2026-02-12 09:39:03.512 [info] Got Copilot token for hubeiqiao',
      '2026-02-12 09:40:30.000 [info] ccreq:4390bcbb.copilotmd | error | gpt-4.1 -> gpt-4.1-2025-04-14 | 300ms | [settingsEditorSearchSuggestions]',
    ]);

    const result = await scanCopilotVscodeDates(['2026-02-12'], tmpDir);
    expect(result.get('2026-02-12')).toEqual([]);
  });

  it('reads persistent workspaceStorage chat sessions for older Copilot history', async () => {
    const workspaceStorageDir = join(tmpDir, 'workspaceStorage');
    await writeWorkspaceSession({
      rootDir: workspaceStorageDir,
      workspaceId: 'ws-1',
      folderUri: 'file:///Users/test/October%20Project',
      sessionId: 'session-oct',
      timestamp: Date.parse('2025-10-28T12:00:00.000Z'),
      modelId: 'copilot/claude-sonnet-4.5',
    });
    await writeWorkspaceSession({
      rootDir: workspaceStorageDir,
      workspaceId: 'ws-2',
      folderUri: 'file:///Users/test/November%20Project',
      sessionId: 'session-nov',
      timestamp: Date.parse('2025-11-15T12:00:00.000Z'),
      modelId: 'copilot/gpt-4.1',
    });
    await writeWorkspaceSession({
      rootDir: workspaceStorageDir,
      workspaceId: 'ws-3',
      folderUri: 'file:///Users/test/December%20Project',
      sessionId: 'session-dec',
      timestamp: Date.parse('2025-12-20T12:00:00.000Z'),
      modelId: 'copilot/claude-opus-4.5',
    });

    const result = await scanCopilotVscodeDates(
      ['2025-10-28', '2025-11-15', '2025-12-20'],
      tmpDir,
      {
        '/Users/test/October Project': 'October Project',
        '/Users/test/November Project': 'November Project',
        '/Users/test/December Project': 'December Project',
      },
      workspaceStorageDir,
    );

    expect(result.get('2025-10-28')).toEqual([
      expect.objectContaining({
        model: 'claude-sonnet-4.5',
        project: 'October Project',
        eventCount: 1,
      }),
    ]);
    expect(result.get('2025-11-15')).toEqual([
      expect.objectContaining({
        model: 'gpt-4.1',
        project: 'November Project',
        eventCount: 1,
      }),
    ]);
    expect(result.get('2025-12-20')).toEqual([
      expect.objectContaining({
        model: 'claude-opus-4.5',
        project: 'December Project',
        eventCount: 1,
      }),
    ]);
  });
});
