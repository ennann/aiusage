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

vi.mock('../config.js', () => ({
  readConfig: async () => ({ deviceId: 'dev-1', targets: [] }),
  getConfigPath: () => '/tmp/aiusage-test-config.json',
}));

vi.mock('../api.js', () => ({
  fetchHealth: async () => ({ siteId: 'site-1' }),
}));

vi.mock('../schedule.js', () => ({
  getScheduleStatus: async () => ({ enabled: false }),
}));

let homeDir: string;

beforeEach(async () => {
  homeDir = join(tmpdir(), `aiusage-doctor-${Date.now()}`);
  mockHomedir.mockReturnValue(homeDir);
  await mkdir(homeDir, { recursive: true });
  await writeFile('/tmp/aiusage-test-config.json', '{}');
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  await rm('/tmp/aiusage-test-config.json', { force: true });
});

describe('runDoctor', () => {
  it('checks for Cursor local state data', async () => {
    await mkdir(join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage'), { recursive: true });
    await writeFile(
      join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
      'sqlite-placeholder',
    );

    const { runDoctor } = await import('../doctor.js');
    const checks = await runDoctor('en');

    expect(checks).toContainEqual(
      expect.objectContaining({
        group: 'Tools',
        name: 'Cursor',
        status: 'ok',
        message: '1 session found',
      }),
    );
  });
});
