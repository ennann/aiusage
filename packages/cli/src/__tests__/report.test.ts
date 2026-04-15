import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockHomedir = vi.fn();

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => mockHomedir(),
  };
});

let homeDir: string;

beforeEach(async () => {
  homeDir = join(tmpdir(), `aiusage-report-${Date.now()}`);
  mockHomedir.mockReturnValue(homeDir);
  await mkdir(homeDir, { recursive: true });
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('buildLocalReport', () => {
  it('discovers Gemini logs, Copilot VS Code workspace sessions, and Antigravity metadata in all-history reports', async () => {
    await mkdir(join(homeDir, '.gemini', 'tmp', 'project-a'), { recursive: true });
    await writeFile(
      join(homeDir, '.gemini', 'tmp', 'project-a', 'logs.json'),
      JSON.stringify([
        { type: 'user', timestamp: '2025-06-30T12:38:58.048Z' },
      ], null, 2),
    );

    await writeFile(
      join(homeDir, '.gemini', 'tmp', 'project-a', 'session.json'),
      JSON.stringify({
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
      }, null, 2),
    );

    const workspaceDir = join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage', 'ws-1');
    await mkdir(join(workspaceDir, 'chatSessions'), { recursive: true });
    await writeFile(
      join(workspaceDir, 'workspace.json'),
      JSON.stringify({ folder: 'file:///Users/test/Copilot%20Project' }, null, 2),
    );
    await writeFile(
      join(workspaceDir, 'chatSessions', 'session-1.json'),
      JSON.stringify({
        requests: [
          {
            requestId: 'copilot-1',
            response: [{ value: 'Done' }],
            timestamp: Date.parse('2025-10-22T12:45:42.785Z'),
            modelId: 'copilot/claude-sonnet-4.5',
          },
        ],
      }, null, 2),
    );

    await mkdir(join(homeDir, '.gemini', 'antigravity', 'brain', 'session-a'), { recursive: true });
    await writeFile(
      join(homeDir, '.gemini', 'antigravity', 'brain', 'session-a', 'task.md.metadata.json'),
      JSON.stringify({ updatedAt: '2025-12-10T12:36:31.732646Z' }, null, 2),
    );

    const { buildLocalReport } = await import('../report.js');
    const report = await buildLocalReport('all');

    expect(report.daysWithData).toBe(4);
    expect(report.daily.map((day) => day.usageDate)).toEqual([
      '2025-06-30',
      '2025-09-17',
      '2025-10-22',
      '2025-12-10',
    ]);
  });

  it('discovers Kiro chats in all-history report aggregation', async () => {
    const day = '2025-08-01';
    const dir = join(
      homeDir,
      'Library',
      'Application Support',
      'Kiro',
      'User',
      'globalStorage',
      'kiro.kiroagent',
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'chat-01.chat'),
      JSON.stringify({
        metadata: {
          startTime: `${day}T09:00:00.000Z`,
          modelId: 'gpt-4.1',
          executionId: 'kiro-report-1',
        },
      }),
      'utf-8',
    );

    const { buildLocalReport } = await import('../report.js');
    const report = await buildLocalReport('all');

    expect(report.daily.map((d) => d.usageDate)).toContain(day);
    expect(report.bySource).toContainEqual(
      expect.objectContaining({
        source: 'kiro/kiro',
        eventCount: 1,
      }),
    );
  });
});
