import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanDates } from '../scan.js';

const mockHomedir = vi.fn();

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => mockHomedir() };
});

let homeDir: string;

beforeEach(async () => {
  homeDir = join(tmpdir(), `aiusage-scan-test-${Date.now()}`);
  mockHomedir.mockReturnValue(homeDir);
  await mkdir(homeDir, { recursive: true });
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('scanDates', () => {
  it('includes Kiro breakdowns when data exists', async () => {
    const day = '2026-04-01';
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
      join(dir, 'sample.chat'),
      JSON.stringify({
        metadata: {
          startTime: `${day}T10:00:00.000Z`,
          modelId: 'gpt-4.1',
          executionId: 'scan-exec-1',
        },
      }),
      'utf-8',
    );

    const results = await scanDates([day]);
    const [result] = results;

    expect(result.usageDate).toBe(day);
    expect(result.breakdowns).toContainEqual(
      expect.objectContaining({
        provider: 'kiro',
        product: 'kiro',
        model: 'gpt-4.1',
        eventCount: 1,
      }),
    );
  });
});
