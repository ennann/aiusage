import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig, getConfigPath } from './config.js';
import { fetchHealth } from './api.js';
import { getScheduleStatus } from './schedule.js';
import type { Lang } from './i18n.js';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

const msgs = {
  en: {
    config: 'Config',
    configMissing: 'Not found, run aiusage init first',
    deviceId: 'Device ID',
    deviceIdMissing: 'Not configured, run aiusage init',
    targetMissing: 'Not configured, run aiusage enroll',
    targets: 'Targets',
    deviceToken: 'Device token',
    tokenMissing: 'Not registered',
    server: 'Server',
    lastSync: 'Last sync',
    lastSyncNone: 'No record',
    notInstalled: 'Not installed',
    installedNoData: 'Installed, no usage data yet',
    hasData: (n: number) => `${n} session${n > 1 ? 's' : ''} found`,
    schedule: 'Schedule',
    scheduleEvery: 'every',
    scheduleEnabled: 'Enabled',
    scheduleOff: 'Not enabled, run aiusage schedule on',
  },
  zh: {
    config: '配置文件',
    configMissing: '未找到，请先执行 aiusage init',
    deviceId: '设备 ID',
    deviceIdMissing: '未配置，请执行 aiusage init',
    targetMissing: '未配置，请执行 aiusage enroll',
    targets: '上报目标',
    deviceToken: '设备令牌',
    tokenMissing: '未注册',
    server: '服务端',
    lastSync: '上次同步',
    lastSyncNone: '暂无记录',
    notInstalled: '未安装',
    installedNoData: '已安装，暂无使用数据',
    hasData: (n: number) => `发现 ${n} 个会话`,
    schedule: '定时同步',
    scheduleEvery: '每',
    scheduleEnabled: '已启用',
    scheduleOff: '未启用，可执行 aiusage schedule on',
  },
} as const;

/** 递归统计目录下指定扩展名的文件数（含子目录），上限 cap */
async function countFiles(dir: string, exts: string[], cap = 1000): Promise<number> {
  let count = 0;
  const queue = [dir];
  while (queue.length > 0 && count < cap) {
    const current = queue.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (count >= cap) break;
      const full = join(current, e.name);
      if (e.isDirectory()) {
        queue.push(full);
      } else if (exts.some(ext => e.name.endsWith(ext))) {
        count++;
      }
    }
  }
  return count;
}

// 每个工具的数据目录、检测的文件扩展名
interface ToolDef {
  dir: string;
  label: string;
  exts: string[];
}

export async function runDoctor(lang: Lang = 'zh'): Promise<Check[]> {
  const s = msgs[lang];
  const checks: Check[] = [];
  const config = await readConfig();

  // 配置文件
  const configPath = getConfigPath();
  try {
    await stat(configPath);
    checks.push({ name: s.config, status: 'ok', message: configPath });
  } catch {
    checks.push({ name: s.config, status: 'fail', message: s.configMissing });
  }

  // 设备 ID
  if (config.deviceId) {
    checks.push({ name: s.deviceId, status: 'ok', message: config.deviceId });
  } else {
    checks.push({ name: s.deviceId, status: 'warn', message: s.deviceIdMissing });
  }

  // 按 target 检查
  const targets = config.targets ?? [];
  if (targets.length === 0) {
    checks.push({ name: s.targets, status: 'warn', message: s.targetMissing });
  } else {
    for (const target of targets) {
      const prefix = `[${target.name}]`;

      if (target.deviceToken) {
        checks.push({ name: `${prefix} ${s.deviceToken}`, status: 'ok', message: `${target.deviceToken.slice(0, 12)}…` });
      } else {
        checks.push({ name: `${prefix} ${s.deviceToken}`, status: 'fail', message: s.tokenMissing });
      }

      try {
        const health = await fetchHealth(target.apiBaseUrl);
        checks.push({ name: `${prefix} ${s.server}`, status: 'ok', message: health.siteId });
      } catch (err) {
        checks.push({ name: `${prefix} ${s.server}`, status: 'fail', message: err instanceof Error ? err.message : String(err) });
      }

      if (target.lastSuccessfulUploadAt) {
        checks.push({ name: `${prefix} ${s.lastSync}`, status: 'ok', message: target.lastSuccessfulUploadAt });
      } else {
        checks.push({ name: `${prefix} ${s.lastSync}`, status: 'warn', message: s.lastSyncNone });
      }
    }
  }

  // 扫描工具 — 三态检测：未安装 / 已安装无数据 / 有数据
  const home = homedir();
  const tools: ToolDef[] = [
    { dir: join(home, '.claude', 'projects'), label: 'Claude Code', exts: ['.jsonl'] },
    { dir: join(home, '.codex'), label: 'Codex CLI', exts: ['.jsonl'] },
    { dir: join(home, '.copilot', 'session-state'), label: 'Copilot CLI', exts: ['.jsonl'] },
    { dir: join(home, '.gemini', 'tmp'), label: 'Gemini CLI', exts: ['.json'] },
    { dir: join(home, '.qwen', 'tmp'), label: 'Qwen Code', exts: ['.jsonl'] },
    { dir: join(home, '.kimi', 'sessions'), label: 'Kimi Code', exts: ['.jsonl'] },
    { dir: join(home, '.local', 'share', 'amp', 'threads'), label: 'Amp', exts: ['.json'] },
    { dir: join(home, '.factory', 'sessions'), label: 'Droid', exts: ['.jsonl', '.json'] },
    { dir: join(home, '.local', 'share', 'opencode'), label: 'OpenCode', exts: ['.json'] },
    { dir: join(home, '.pi', 'agent', 'sessions'), label: 'Pi', exts: ['.jsonl'] },
  ];

  for (const tool of tools) {
    try {
      await stat(tool.dir);
    } catch {
      checks.push({ name: tool.label, status: 'warn', message: s.notInstalled });
      continue;
    }
    const n = await countFiles(tool.dir, tool.exts);
    if (n > 0) {
      checks.push({ name: tool.label, status: 'ok', message: s.hasData(n) });
    } else {
      checks.push({ name: tool.label, status: 'warn', message: s.installedNoData });
    }
  }

  // 定时同步
  const schedule = await getScheduleStatus();
  if (schedule.enabled) {
    checks.push({
      name: s.schedule,
      status: 'ok',
      message: schedule.intervalLabel ? `${s.scheduleEvery} ${schedule.intervalLabel}` : s.scheduleEnabled,
    });
  } else {
    checks.push({ name: s.schedule, status: 'warn', message: s.scheduleOff });
  }

  return checks;
}
