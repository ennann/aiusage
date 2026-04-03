import { stat } from 'node:fs/promises';
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
    noUsage: 'No usage detected',
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
    noUsage: '未检测到使用记录',
    schedule: '定时同步',
    scheduleEvery: '每',
    scheduleEnabled: '已启用',
    scheduleOff: '未启用，可执行 aiusage schedule on',
  },
} as const;

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

  // 扫描目录 — 覆盖全部支持的工具
  const home = homedir();
  const scannerDirs: Array<[string, string]> = [
    [join(home, '.claude', 'projects'), 'Claude Code'],
    [join(home, '.codex'), 'Codex CLI'],
    [join(home, '.copilot', 'session-state'), 'Copilot CLI'],
    [join(home, '.gemini', 'tmp'), 'Gemini CLI'],
    [join(home, '.qwen', 'tmp'), 'Qwen Code'],
    [join(home, '.kimi', 'sessions'), 'Kimi Code'],
    [join(home, '.local', 'share', 'amp', 'threads'), 'Amp'],
    [join(home, '.factory', 'sessions'), 'Droid'],
    [join(home, '.local', 'share', 'opencode'), 'OpenCode'],
    [join(home, '.pi', 'agent', 'sessions'), 'Pi'],
  ];
  for (const [dir, label] of scannerDirs) {
    try {
      await stat(dir);
      checks.push({ name: label, status: 'ok', message: dir });
    } catch {
      checks.push({ name: label, status: 'warn', message: s.noUsage });
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
