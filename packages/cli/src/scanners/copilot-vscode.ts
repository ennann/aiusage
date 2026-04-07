import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  dateKey,
  projectFromPath,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
} from './utils.js';

export async function scanCopilotVscodeDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
  workspaceStorageDir?: string,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? join(homedir(), 'Library', 'Application Support', 'Code', 'logs');
  const workspaceDir = workspaceStorageDir ?? join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  const logFiles = (await walkFiles(dir, '.log')).filter((filePath) => basename(filePath) === 'GitHub Copilot Chat.log');
  const sessionFiles = (await walkFiles(workspaceDir, '.json')).filter((filePath) => filePath.includes('/chatSessions/'));
  if (logFiles.length === 0 && sessionFiles.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);
  const seenEvents = new Set<string>();

  for (const filePath of logFiles) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let sessionProject = 'unknown';

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;

      const projectPath = extractFileUriPath(line);
      if (projectPath) {
        sessionProject = projectFromPath(projectPath, projectAliases);
      }

      const event = extractSuccessEvent(line);
      if (!event) continue;

      const dayMap = grouped.get(dateKey(event.timestamp));
      if (!dayMap) continue;

      const dedupeKey = `${event.requestId}|${event.timestamp.toISOString()}|${event.model}|${sessionProject}`;
      if (seenEvents.has(dedupeKey)) continue;
      seenEvents.add(dedupeKey);

      accumulate(
        dayMap,
        `${event.model}|${sessionProject}`,
        {
          provider: 'github',
          product: 'copilot-vscode',
          channel: 'ide',
          model: event.model,
          project: sessionProject,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
      );
    }
  }

  for (const filePath of sessionFiles) {
    await collectWorkspaceSessionEvents(filePath, grouped, seenEvents, projectAliases);
  }

  return finalize(grouped);
}

function extractSuccessEvent(line: string): { requestId: string; timestamp: Date; model: string } | null {
  if (!line.includes('ccreq:') || !line.includes('| success |')) return null;

  const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/);
  if (!timestampMatch) return null;

  const timestamp = new Date(timestampMatch[1].replace(' ', 'T'));
  if (Number.isNaN(timestamp.getTime())) return null;

  const parts = line.split('|').map((part) => part.trim());
  if (parts.length < 3 || parts[1] !== 'success') return null;

  const requestIdMatch = parts[0].match(/ccreq:([^.|\s]+)/);
  const requestId = requestIdMatch?.[1] ?? `${timestamp.getTime()}`;
  const model = normalizeModel(parts[2]);
  if (!model) return null;

  return { requestId, timestamp, model };
}

function normalizeModel(raw: string): string {
  const parts = raw.split('->').map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? raw.trim();
}

function extractFileUriPath(line: string): string | null {
  const match = line.match(/file:\/\/\/([^\s.]+(?:\.[^\s.]+)?)/);
  if (!match) return null;

  try {
    return decodeURIComponent(`/${match[1]}`);
  } catch {
    return `/${match[1]}`;
  }
}

interface CopilotWorkspaceSession {
  requests?: Array<{
    requestId?: string;
    timestamp?: number | string;
    modelId?: string;
    response?: unknown[];
    result?: {
      errorDetails?: {
        responseIsIncomplete?: boolean;
      };
    };
  }>;
}

interface WorkspaceDescriptor {
  folder?: string;
}

async function collectWorkspaceSessionEvents(
  filePath: string,
  grouped: Map<string, Map<string, IngestBreakdown>>,
  seenEvents: Set<string>,
  projectAliases?: Record<string, string>,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return;
  }

  let session: CopilotWorkspaceSession;
  try {
    session = JSON.parse(content) as CopilotWorkspaceSession;
  } catch {
    return;
  }

  const workspacePath = await readWorkspaceFolderPath(filePath);
  const project = workspacePath ? projectFromPath(workspacePath, projectAliases) : 'unknown';

  for (const request of session.requests ?? []) {
    if (!request.response?.length) continue;
    if (request.result?.errorDetails?.responseIsIncomplete) continue;

    const model = normalizeWorkspaceModel(request.modelId);
    if (!model) continue;

    const timestamp = new Date(request.timestamp ?? 0);
    if (Number.isNaN(timestamp.getTime())) continue;

    const dayMap = grouped.get(dateKey(timestamp));
    if (!dayMap) continue;

    const requestId = request.requestId ?? `${timestamp.getTime()}`;
    const dedupeKey = `${requestId}|${timestamp.toISOString()}|${model}|${project}`;
    if (seenEvents.has(dedupeKey)) continue;
    seenEvents.add(dedupeKey);

    accumulate(
      dayMap,
      `${model}|${project}`,
      {
        provider: 'github',
        product: 'copilot-vscode',
        channel: 'ide',
        model,
        project,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    );
  }
}

async function readWorkspaceFolderPath(sessionFilePath: string): Promise<string | null> {
  const workspaceJsonPath = join(dirname(sessionFilePath), '..', 'workspace.json');
  let content: string;
  try {
    content = await readFile(workspaceJsonPath, 'utf-8');
  } catch {
    return null;
  }

  try {
    const workspace = JSON.parse(content) as WorkspaceDescriptor;
    const raw = workspace.folder;
    if (!raw?.startsWith('file:///')) return null;
    return decodeURIComponent(raw.replace(/^file:\/\//, ''));
  } catch {
    return null;
  }
}

function normalizeWorkspaceModel(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/^copilot\//, '').trim();
}
