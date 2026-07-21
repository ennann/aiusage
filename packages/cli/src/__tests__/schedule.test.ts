import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseInterval, resolveCommandPaths } from '../schedule.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('schedule', () => {
  it('resolves volatile command shims to the stable package script', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiusage-schedule-'));
    tempDirs.push(root);

    const stableScript = join(root, 'node_modules', '@aiusage', 'cli', 'dist', 'cli.js');
    await mkdir(dirname(stableScript), { recursive: true });
    await writeFile(stableScript, '#!/usr/bin/env node\n', 'utf-8');

    const shimPath = join(root, 'fnm_multishells', '1234', 'bin', 'aiusage');
    await mkdir(dirname(shimPath), { recursive: true });
    await symlink(stableScript, shimPath);

    const originalArgv = process.argv;
    process.argv = [originalArgv[0] ?? 'node', shimPath];
    try {
      const paths = resolveCommandPaths();
      await expect(realpath(paths.scriptPath)).resolves.toBe(await realpath(stableScript));
    } finally {
      process.argv = originalArgv;
    }
  });

  it('parses schedule intervals', () => {
    expect(parseInterval('5m')).toEqual({ seconds: 300, label: '5m' });
    expect(parseInterval('2h')).toEqual({ seconds: 7200, label: '2h' });
  });
});
