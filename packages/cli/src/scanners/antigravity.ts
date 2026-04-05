import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
} from './utils.js';

interface AntigravityBrowserMetadata {
  highlights?: Array<{
    start_time?: string;
    end_time?: string;
  }>;
}

interface AntigravityArtifactMetadata {
  updatedAt?: string;
}

export async function scanAntigravityDates(
  targetDates: string[],
  baseDir?: string,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? join(homedir(), '.gemini', 'antigravity');
  const grouped = initDateMap(dates);
  const sessionDates = new Map<string, Date>();

  await collectBrainSessionDates(join(dir, 'brain'), sessionDates);
  await collectBrowserSessionDates(join(dir, 'browser_recordings'), sessionDates);

  if (sessionDates.size === 0) return emptyResult(dates);

  for (const timestamp of sessionDates.values()) {
    const dayMap = grouped.get(dateKey(timestamp));
    if (!dayMap) continue;

    accumulate(
      dayMap,
      'unknown|unknown',
      {
        provider: 'google',
        product: 'antigravity',
        channel: 'ide',
        model: 'unknown',
        project: 'unknown',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    );
  }

  return finalize(grouped);
}

async function collectBrainSessionDates(dir: string, sessionDates: Map<string, Date>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const taskMetadata = await readJson<AntigravityArtifactMetadata>(join(dir, entry.name, 'task.md.metadata.json'));
    const timestamp = parseTs(taskMetadata?.updatedAt);
    if (!timestamp) continue;

    upsertSessionDate(sessionDates, entry.name, timestamp);
  }
}

async function collectBrowserSessionDates(dir: string, sessionDates: Map<string, Date>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metadata = await readJson<AntigravityBrowserMetadata>(join(dir, entry.name, 'metadata.json'));
    const timestamp = parseTs(metadata?.highlights?.[0]?.start_time ?? metadata?.highlights?.[0]?.end_time);
    if (!timestamp) continue;

    upsertSessionDate(sessionDates, entry.name, timestamp);
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function upsertSessionDate(sessionDates: Map<string, Date>, sessionId: string, timestamp: Date): void {
  const existing = sessionDates.get(sessionId);
  if (!existing || timestamp < existing) {
    sessionDates.set(sessionId, timestamp);
  }
}
