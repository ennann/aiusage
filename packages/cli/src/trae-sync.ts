import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
// ws is a runtime dependency; the package intentionally keeps no separate declaration dependency.
// @ts-expect-error The ws package does not ship declarations.
import WebSocket from 'ws';
import {
  normalizeTraeModel,
  resolveTraeNativeCacheDir,
  type TraeCachedSession,
  type TraeCachedUsageEvent,
} from './scanners/trae.js';

const execFileAsync = promisify(execFile);
const DEFAULT_DEBUG_PORT = 9230;
const DEFAULT_APP_PATH = '/Applications/TRAE.app';
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

interface DevtoolsTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface RawSyncedEvent {
  messageId?: string;
  timestamp?: string | number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens?: number;
}

interface RawSyncedSession {
  sessionId?: string;
  project?: string;
  events?: RawSyncedEvent[];
}

interface RawSyncResult {
  accounts?: number;
  sessions?: RawSyncedSession[];
  errors?: Array<{ code?: number; message?: string }>;
}

export interface TraeSyncOptions {
  port?: number;
  appPath?: string;
  userDataDir?: string;
  launch?: boolean;
  timeoutMs?: number;
  cacheDir?: string;
}

export interface TraeSyncResult {
  cacheDir: string;
  accounts: number;
  sessions: number;
  events: number;
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  };
  warnings: string[];
}

/**
 * Sync Trae CN history through Trae's own local ai-agent RPC.
 *
 * The SQLCipher database is never opened directly. Only numeric token counters,
 * timestamps, session ids and workspace paths are cached; conversation content and
 * authentication tokens are not persisted.
 */
export async function syncTraeCnUsage(options: TraeSyncOptions = {}): Promise<TraeSyncResult> {
  const timeoutMs = clampTimeout(options.timeoutMs);
  const userDataDir = options.userDataDir ?? resolveTraeCnUserDataDir();
  const cacheDir = options.cacheDir ?? resolveTraeNativeCacheDir();
  const appPath = options.appPath ?? DEFAULT_APP_PATH;
  let port = normalizePort(options.port) ?? DEFAULT_DEBUG_PORT;
  let target = await findWorkbenchTarget(port);
  let launched = false;

  try {
    if (!target) {
      if (options.launch === false) {
        throw new Error(`未连接到 Trae CN 本地调试接口 (127.0.0.1:${port})`);
      }
      if (process.platform !== 'darwin') {
        throw new Error('Trae CN 自动同步目前仅支持 macOS；其他系统可用 --port 连接已开启调试端口的 Trae');
      }
      if (await isTraeRunning()) {
        throw new Error('检测到 Trae CN 正在运行但未开放本地读取接口。请先退出 Trae，再执行 aiusage trae sync');
      }
      if (!existsSync(appPath)) throw new Error(`未找到 Trae CN: ${appPath}`);

      if (options.port == null && !(await isPortAvailable(port))) port = await findFreePort();
      await launchTrae(appPath, port);
      launched = true;
      target = await waitForWorkbench(port, timeoutMs);
    }

    const userIds = await waitForTraeUserIds(userDataDir, timeoutMs);
    if (userIds.length === 0) {
      throw new Error('未能从 Trae CN 本地日志识别账号，请确认 Trae 已登录后重试');
    }

    const raw = await readTraeUsageWithRetry(port, target, userIds, timeoutMs);
    const normalized = normalizeSyncResult(raw);
    if (normalized.sessions.length === 0 && (raw.errors?.length ?? 0) > 0) {
      throw new Error(`Trae CN 本地读取失败: ${sanitizeMessage(raw.errors?.[0]?.message)}`);
    }

    await writeCache(normalized.sessions, cacheDir);
    const totals = normalized.sessions.flatMap(session => session.events).reduce(
      (sum, event) => {
        sum.inputTokens += event.inputTokens;
        sum.cachedInputTokens += event.cachedInputTokens;
        sum.cacheWriteTokens += event.cacheWriteTokens;
        sum.outputTokens += event.outputTokens;
        sum.reasoningOutputTokens += event.reasoningOutputTokens;
        sum.totalTokens += event.inputTokens + event.cachedInputTokens + event.cacheWriteTokens
          + event.outputTokens + event.reasoningOutputTokens;
        return sum;
      },
      {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      },
    );

    return {
      cacheDir,
      accounts: raw.accounts ?? userIds.length,
      sessions: normalized.sessions.length,
      events: normalized.sessions.reduce((sum, session) => sum + session.events.length, 0),
      totals,
      warnings: (raw.errors ?? []).map(error => sanitizeMessage(error.message)).filter(Boolean),
    };
  } finally {
    if (launched) await quitTrae();
  }
}

export function normalizeTraeCnUsage(raw: RawSyncedEvent): TraeCachedUsageEvent | null {
  const prompt = tokenValue(raw.promptTokens);
  const completion = tokenValue(raw.completionTokens);
  const cached = Math.min(tokenValue(raw.cacheReadInputTokens), prompt);
  const cacheWrite = Math.min(tokenValue(raw.cacheCreationInputTokens), Math.max(0, prompt - cached));
  const reportedTotal = tokenValue(raw.totalTokens);
  const reportedReasoning = tokenValue(raw.reasoningTokens);
  // Trae's reasoning_tokens is not consistently exclusive of completion_tokens.
  // Anchor to total_tokens and only classify the amount beyond prompt + completion
  // as a separate reasoning bucket, preventing double counting.
  let reasoning = reportedTotal > 0 && prompt + completion > 0
    ? Math.max(0, reportedTotal - prompt - completion)
    : reportedReasoning;
  let input = Math.max(0, prompt - cached - cacheWrite);
  let output = completion;

  if (prompt + completion + reportedReasoning === 0 && reportedTotal > 0) {
    input = reportedTotal;
    reasoning = 0;
  }
  if (input + cached + cacheWrite + output + reasoning === 0) return null;

  const messageId = stringValue(raw.messageId);
  const timestamp = raw.timestamp;
  if (!messageId || timestamp == null || timestamp === '') return null;

  return {
    messageId,
    timestamp,
    model: normalizeTraeModel(stringValue(raw.model)),
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
  };
}

function normalizeSyncResult(raw: RawSyncResult): { sessions: TraeCachedSession[] } {
  const syncedAt = new Date().toISOString();
  const sessions: TraeCachedSession[] = [];
  const seenMessages = new Set<string>();

  for (const rawSession of raw.sessions ?? []) {
    const sessionId = stringValue(rawSession.sessionId);
    if (!sessionId) continue;
    const events: TraeCachedUsageEvent[] = [];
    for (const rawEvent of rawSession.events ?? []) {
      const event = normalizeTraeCnUsage(rawEvent);
      if (!event || seenMessages.has(event.messageId)) continue;
      seenMessages.add(event.messageId);
      events.push(event);
    }
    if (events.length === 0) continue;
    sessions.push({
      schemaVersion: 1,
      source: 'trae-cn-local-rpc',
      syncedAt,
      sessionId,
      project: stringValue(rawSession.project) || 'unknown',
      events,
    });
  }
  return { sessions };
}

async function readTraeUsage(
  webSocketDebuggerUrl: string | undefined,
  userIds: string[],
  timeoutMs: number,
): Promise<RawSyncResult> {
  if (!webSocketDebuggerUrl) throw new Error('Trae CN 调试目标缺少 WebSocket 地址');
  const client = await CdpClient.connect(webSocketDebuggerUrl, timeoutMs);
  try {
    const result = await client.call('Runtime.evaluate', {
      expression: buildSyncExpression(userIds),
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    const exception = result?.exceptionDetails?.exception?.description ?? result?.exceptionDetails?.text;
    if (exception) throw new Error(sanitizeMessage(exception));
    return (result?.result?.value ?? {}) as RawSyncResult;
  } finally {
    client.close();
  }
}

async function readTraeUsageWithRetry(
  port: number,
  initialTarget: DevtoolsTarget,
  userIds: string[],
  timeoutMs: number,
): Promise<RawSyncResult> {
  const deadline = Date.now() + timeoutMs;
  let target = initialTarget;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(5_000, deadline - Date.now());
      return await readTraeUsage(target.webSocketDebuggerUrl, userIds, Math.min(60_000, remaining));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (Date.now() + 1_000 >= deadline) break;
      await delay(1_000);
      target = await findWorkbenchTarget(port) ?? target;
    }
  }
  throw lastError ?? new Error('Trae CN 本地服务未就绪');
}

function buildSyncExpression(userIds: string[]): string {
  return `(async()=>{
    const userIds=${JSON.stringify(userIds)};
    const connection=await vscode.ahaIpc.connect('ai-agent');
    let sequence=0;
    const rpc=(method,data,sessionId='')=>new Promise((resolve,reject)=>{
      const id='aiusage-trae-'+Date.now()+'-'+(++sequence);
      const timer=setTimeout(()=>{connection.off('message',handler);reject(new Error('Trae RPC timeout'))},15000);
      const handler=raw=>{
        let message;
        try{message=typeof raw==='string'?JSON.parse(raw):raw}catch{return}
        if(message.id!==id)return;
        clearTimeout(timer);
        connection.off('message',handler);
        const params=message.result&&message.result.params||{};
        let responseData=params.data;
        try{if(typeof responseData==='string')responseData=JSON.parse(responseData)}catch{}
        resolve({code:params.code,message:params.message,data:responseData||{}});
      };
      connection.on('message',handler);
      connection.send(JSON.stringify({jsonrpc:'2.0',id,method:'request',params:[{
        packet_type:'request',session_id:sessionId,channel_id:id,params:{
          service:'chat',method,data:JSON.stringify(data),common_params:{},
          user_info:{name:'',token:'',region:'',is_internal:false,user_id:'',scope:''},
          streamlined_common_params:{},client_info:{connect_session_id:''}
        }
      }]}));
    });
    const number=value=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?Math.floor(parsed):0};
    const errors=[];
    const sessionMap=new Map();
    const loadSession=async(session,userId)=>{
      const sessionId=String(session.session_id||session.id||'');
      if(!sessionId)return null;
      const loaded={
        sessionId,
        project:typeof session.main_folder==='string'?session.main_folder:'unknown',
        events:[]
      };
      const seenMessages=new Set();
      let messageCursor='';
      const seenMessageCursors=new Set();
      for(let messagePage=0;messagePage<100;messagePage++){
        const messageRequest={user_id:userId,session_id:sessionId,page_size:100};
        if(messageCursor)messageRequest.next_page_token=messageCursor;
        const messageResponse=await rpc('get_messages',messageRequest,sessionId);
        if(messageResponse.code!==0){errors.push({code:messageResponse.code,message:messageResponse.message});break}
        const messageData=messageResponse.data||{};
        for(const message of Array.isArray(messageData.messages)?messageData.messages:[]){
          const usage=message.token_usage;
          if(!usage)continue;
          const messageId=String(message.message_id||message.id||'');
          if(!messageId||seenMessages.has(messageId))continue;
          const meta=message.model_smart_selection_meta||{};
          loaded.events.push({
            messageId,
            timestamp:message.created_at||message.timestamp||session.update_at||session.created_at,
            model:typeof meta.config_name==='string'&&meta.config_name?meta.config_name:
              (typeof meta.mode==='string'&&meta.mode?'trae-'+meta.mode.toLowerCase():'trae-unknown'),
            promptTokens:number(usage.prompt_tokens||usage.prompt_tokens_total),
            completionTokens:number(usage.completion_tokens||usage.completion_tokens_total),
            reasoningTokens:number(usage.reasoning_tokens),
            cacheReadInputTokens:number(usage.cache_read_input_tokens),
            cacheCreationInputTokens:number(usage.cache_creation_input_tokens),
            totalTokens:number(usage.total_tokens)
          });
          seenMessages.add(messageId);
        }
        const next=typeof messageData.next_page_token==='string'?messageData.next_page_token:'';
        if(!next||seenMessageCursors.has(next))break;
        seenMessageCursors.add(next);
        messageCursor=next;
      }
      return loaded;
    };
    try{
      for(const userId of userIds){
        let sessionCursor='';
        const seenSessionCursors=new Set();
        for(let sessionPage=0;sessionPage<100;sessionPage++){
          const sessionRequest={user_id:userId,page_size:100};
          if(sessionCursor)sessionRequest.next_page_token=sessionCursor;
          const sessionResponse=await rpc('get_lite_sessions',sessionRequest);
          if(sessionResponse.code!==0){errors.push({code:sessionResponse.code,message:sessionResponse.message});break}
          const data=sessionResponse.data||{};
          const sessions=Array.isArray(data.sessions)?data.sessions:[];
          for(let index=0;index<sessions.length;index+=6){
            const loaded=await Promise.all(sessions.slice(index,index+6).map(session=>loadSession(session,userId)));
            for(const session of loaded){
              if(!session)continue;
              const existing=sessionMap.get(session.sessionId);
              if(!existing){sessionMap.set(session.sessionId,session);continue}
              const seen=new Set(existing.events.map(event=>event.messageId));
              for(const event of session.events)if(!seen.has(event.messageId))existing.events.push(event);
            }
          }
          const next=typeof data.next_page_token==='string'?data.next_page_token:'';
          if(!next||seenSessionCursors.has(next))break;
          seenSessionCursors.add(next);
          sessionCursor=next;
        }
      }
      return {accounts:userIds.length,sessions:[...sessionMap.values()],errors};
    }finally{connection.disconnect()}
  })()`;
}

class CdpClient {
  private sequence = 0;
  private readonly pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private constructor(private readonly socket: any) {
    socket.on('message', (raw: unknown) => {
      let message: any;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(sanitizeMessage(message.error.message)));
      else entry.resolve(message.result);
    });
    socket.on('error', (error: Error) => this.rejectAll(error));
    socket.on('close', () => this.rejectAll(new Error('Trae CN 本地连接已关闭')));
  }

  static async connect(url: string, timeoutMs: number): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('连接 Trae CN 本地接口超时'));
      }, timeoutMs);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (error: Error) => { clearTimeout(timer); reject(error); });
    });
    return new CdpClient(socket);
  }

  call(method: string, params: unknown, timeoutMs: number): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Trae CN 本地调用超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

async function findWorkbenchTarget(port: number): Promise<DevtoolsTarget | null> {
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${port}/json/list`, 1_500);
    if (!response.ok) return null;
    const targets = await response.json() as DevtoolsTarget[];
    return targets.find(target => target.type === 'page' && target.url?.includes('workbench.html')) ?? null;
  } catch {
    return null;
  }
}

async function waitForWorkbench(port: number, timeoutMs: number): Promise<DevtoolsTarget> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await findWorkbenchTarget(port);
    if (target) return target;
    await delay(500);
  }
  throw new Error('等待 Trae CN 启动超时');
}

async function waitForTraeUserIds(userDataDir: string, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = await findTraeUserIds(userDataDir);
    if (ids.length > 0) return ids;
    await delay(500);
  }
  return [];
}

async function findTraeUserIds(userDataDir: string): Promise<string[]> {
  const files = await findCompletionLogs(join(userDataDir, 'logs'));
  const candidates = files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 30);
  const ids = new Set<string>();

  const legacyTokenPath = join(homedir(), '.trae-cn', 'trae-jwt-token');
  if (existsSync(legacyTokenPath)) {
    try { collectJwtUserIds(await readFileTail(legacyTokenPath), ids); } catch { /* optional */ }
  }
  for (const candidate of candidates) {
    try { collectJwtUserIds(await readFileTail(candidate.path), ids); } catch { /* stale log */ }
    if (ids.size >= 10) break;
  }
  return [...ids];
}

async function findCompletionLogs(dir: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findCompletionLogs(path));
    else if (entry.name === 'completion.log' && path.includes('trae.ai-code-completion')) {
      try { files.push({ path, mtimeMs: (await stat(path)).mtimeMs }); } catch { /* raced with rotation */ }
    }
  }
  return files;
}

async function readFileTail(path: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const size = (await handle.stat()).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, size - length));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function collectJwtUserIds(content: string, ids: Set<string>): void {
  for (const token of content.match(JWT_PATTERN) ?? []) {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) continue;
    try {
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
        data?: { id?: string | number };
      };
      const id = payload.data?.id;
      if ((typeof id === 'string' || typeof id === 'number') && String(id).trim()) ids.add(String(id));
    } catch { /* unrelated JWT */ }
  }
}

async function writeCache(sessions: TraeCachedSession[], cacheDir: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  for (const session of sessions) {
    const hash = createHash('sha256').update(session.sessionId).digest('hex').slice(0, 32);
    const destination = join(cacheDir, `${hash}.json`);
    const temporary = join(cacheDir, `.${hash}.${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, destination);
  }
}

async function launchTrae(appPath: string, port: number): Promise<void> {
  await execFileAsync('open', [
    '-g',
    '-j',
    '-na',
    appPath,
    '--args',
    `--remote-debugging-port=${port}`,
  ]);
}

async function quitTrae(): Promise<void> {
  if (process.platform !== 'darwin') return;
  try {
    await execFileAsync('osascript', ['-e', 'tell application id "cn.trae.app" to quit']);
  } catch { /* best-effort cleanup for the instance we launched */ }
}

async function isTraeRunning(): Promise<boolean> {
  try {
    await execFileAsync('pgrep', ['-x', 'TRAE']);
    return true;
  } catch {
    return false;
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function resolveTraeCnUserDataDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Trae CN');
  if (process.platform === 'win32') {
    return join(process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming'), 'Trae CN');
  }
  return join(process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config'), 'Trae CN');
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizePort(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : undefined;
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return 120_000;
  return Math.min(180_000, Math.max(5_000, Math.floor(value!)));
}

function sanitizeMessage(value: unknown): string {
  return String(value ?? '')
    .replace(/eyJ[A-Za-z0-9_.-]+/g, '<token>')
    .replace(/[A-Za-z0-9_-]{24,}/g, '<id>')
    .slice(0, 300);
}

function tokenValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
