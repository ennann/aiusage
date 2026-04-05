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
  homeDir = join(tmpdir(), `aiusage-project-${Date.now()}`);
  mockHomedir.mockReturnValue(homeDir);
  await mkdir(homeDir, { recursive: true });
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('discoverProjects', () => {
  it('discovers Cursor, Copilot VS Code, and Antigravity projects from local metadata', async () => {
    await mkdir(join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage'), { recursive: true });
    await writeFile(
      join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'storage.json'),
      JSON.stringify({
        profileAssociations: {
          workspaces: {
            'file:///Users/test/Cursor/My%20Cursor%20App': '__default__profile__',
          },
        },
      }),
    );

    const copilotLogDir = join(homeDir, 'Library', 'Application Support', 'Code', 'logs', '20260212T093859', 'window1', 'exthost', 'GitHub.copilot-chat');
    await mkdir(copilotLogDir, { recursive: true });
    await writeFile(
      join(copilotLogDir, 'GitHub Copilot Chat.log'),
      [
        '2026-02-12 10:53:04.796 [error] CodeSearchWorkspaceDiff: Failed to get new diff for file:///Users/test/VS%20Code/Copilot%20Workspace.',
      ].join('\n'),
    );

    const antigravityKnowledgeDir = join(homeDir, '.gemini', 'antigravity', 'knowledge', 'project_alpha');
    await mkdir(antigravityKnowledgeDir, { recursive: true });
    await writeFile(
      join(antigravityKnowledgeDir, 'metadata.json'),
      JSON.stringify({
        title: 'Project Alpha',
        references: [
          { type: 'conversation_id', value: 'abc' },
        ],
      }),
    );

    const { discoverProjects } = await import('../project.js');
    const projects = await discoverProjects();

    expect(projects).toContainEqual({
      name: 'My Cursor App',
      alias: undefined,
      sources: ['cursor'],
    });

    expect(projects).toContainEqual({
      name: 'Copilot Workspace',
      alias: undefined,
      sources: ['copilot-vscode'],
    });

    expect(projects).toContainEqual({
      name: 'Project Alpha',
      alias: undefined,
      sources: ['antigravity'],
    });
  });
});
