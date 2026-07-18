import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  dateKey,
  inferProviderFromModel,
  parseTs,
  projectFromPath,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
  normalizeModelName,
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
  const [allLogs, allJson, allJsonl] = await Promise.all([
    walkFiles(dir, '.log'),
    walkFiles(workspaceDir, '.json'),
    walkFiles(workspaceDir, '.jsonl'),
  ]);
  const logFiles = allLogs.filter((filePath) => basename(filePath) === 'GitHub Copilot Chat.log');
  const sessionFiles = allJson.filter(isChatSessionFile);
  const crdtSessionFiles = allJsonl.filter(isChatSessionFile);
  if (logFiles.length === 0 && sessionFiles.length === 0 && crdtSessionFiles.length === 0) {
    return emptyResult(dates);
  }

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
  for (const filePath of crdtSessionFiles) {
    await collectWorkspaceJsonlEvents(filePath, grouped, seenEvents, projectAliases);
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

interface CopilotWorkspaceRequest {
  requestId?: string;
  timestamp?: number | string;
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  response?: unknown[];
  result?: {
    errorDetails?: { responseIsIncomplete?: boolean };
    metadata?: {
      promptTokens?: number;
      outputTokens?: number;
      resolvedModel?: string;
      toolCallRounds?: Array<{ thinking?: { tokens?: number } }>;
    };
  };
}

interface CopilotWorkspaceSession {
  requests?: CopilotWorkspaceRequest[];
}

interface WorkspaceDescriptor {
  folder?: string;
  workspace?: string;
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

async function collectWorkspaceJsonlEvents(
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

  const workspacePath = await readWorkspaceFolderPath(filePath);
  const project = workspacePath ? projectFromPath(workspacePath, projectAliases) : 'unknown';
  const sessionId = basename(filePath, '.jsonl');

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let record: { kind?: number; k?: unknown[]; v?: unknown };
    try {
      record = JSON.parse(line) as { kind?: number; k?: unknown[]; v?: unknown };
    } catch {
      continue;
    }

    let requests: CopilotWorkspaceRequest[] = [];
    if (record.kind === 0 && isRecord(record.v)) {
      const value = record.v.requests;
      if (Array.isArray(value)) requests = value.filter(isRecord) as CopilotWorkspaceRequest[];
    } else if (record.kind === 2 && record.k?.[0] === 'requests' && Array.isArray(record.v)) {
      requests = record.v.filter(isRecord) as CopilotWorkspaceRequest[];
    }

    for (const request of requests) {
      addTokenizedWorkspaceRequest(request, sessionId, project, grouped, seenEvents);
    }
  }
}

function addTokenizedWorkspaceRequest(
  request: CopilotWorkspaceRequest,
  sessionId: string,
  project: string,
  grouped: Map<string, Map<string, IngestBreakdown>>,
  seenEvents: Set<string>,
): void {
  const metadata = request.result?.metadata;
  const resolvedModel = metadata?.resolvedModel?.trim();
  const rawModelId = request.modelId?.trim();
  if (!resolvedModel && !rawModelId?.startsWith('copilot/')) return;

  const input = clampToken(request.promptTokens ?? metadata?.promptTokens);
  const output = clampToken(request.completionTokens ?? metadata?.outputTokens);
  if (input === 0 && output === 0) return;

  const timestamp = parseTs(request.timestamp);
  if (!timestamp) return;
  const dayMap = grouped.get(dateKey(timestamp));
  if (!dayMap) return;

  const model = normalizeTokenizedWorkspaceModel(resolvedModel || rawModelId) || 'auto';
  const reasoning = (metadata?.toolCallRounds ?? []).reduce(
    (sum, round) => sum + clampToken(round.thinking?.tokens),
    0,
  );
  const dedupeKey = `copilot-vscode|${sessionId}|${timestamp.getTime()}`;
  if (seenEvents.has(dedupeKey)) return;
  seenEvents.add(dedupeKey);

  const provider = inferProviderFromModel(model, 'github-copilot');
  accumulate(
    dayMap,
    `${provider}|${model}|${project}`,
    {
      provider,
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
    { input, cached: 0, cacheWrite: 0, output, reasoning },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampToken(value: number | undefined): number {
  return Math.max(Number.isFinite(value) ? value! : 0, 0);
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
    const raw = workspace.folder ?? workspace.workspace;
    if (!raw) return null;
    return decodeURIComponent(raw.replace(/^file:\/\//, ''));
  } catch {
    return null;
  }
}

function normalizeWorkspaceModel(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/^copilot\//, '').trim();
}

function isChatSessionFile(filePath: string): boolean {
  return basename(dirname(filePath)) === 'chatSessions';
}

function normalizeTokenizedWorkspaceModel(raw?: string): string {
  const normalized = normalizeModelName(normalizeWorkspaceModel(raw));
  // Copilot 的 Claude resolvedModel 同时存在 4.6 / 4-6 两种写法；
  // 只归一化 Claude，避免把 gpt-4.1 等正式模型名改坏。
  return /^claude[-.]/i.test(normalized) ? normalized.replace(/\./g, '-') : normalized;
}
