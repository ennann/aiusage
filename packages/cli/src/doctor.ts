import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig, getConfigPath } from './config.js';
import { fetchHealth } from './api.js';
import { getScheduleStatus } from './schedule.js';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

export async function runDoctor(): Promise<Check[]> {
  const checks: Check[] = [];
  const config = await readConfig();

  // 配置文件
  const configPath = getConfigPath();
  try {
    await stat(configPath);
    checks.push({ name: '配置文件', status: 'ok', message: configPath });
  } catch {
    checks.push({ name: '配置文件', status: 'fail', message: '未找到，请先执行 aiusage init' });
  }

  // 设备 ID
  if (config.deviceId) {
    checks.push({ name: '设备 ID', status: 'ok', message: config.deviceId });
  } else {
    checks.push({ name: '设备 ID', status: 'warn', message: '未配置，请执行 aiusage init' });
  }

  // 按 target 检查
  const targets = config.targets ?? [];
  if (targets.length === 0) {
    checks.push({ name: '上报目标', status: 'warn', message: '未配置，请执行 aiusage enroll' });
  } else {
    for (const target of targets) {
      const prefix = `[${target.name}]`;

      if (target.deviceToken) {
        checks.push({ name: `${prefix} 设备令牌`, status: 'ok', message: `${target.deviceToken.slice(0, 12)}…` });
      } else {
        checks.push({ name: `${prefix} 设备令牌`, status: 'fail', message: '未注册' });
      }

      try {
        const health = await fetchHealth(target.apiBaseUrl);
        checks.push({ name: `${prefix} 服务端`, status: 'ok', message: `${health.siteId} (v${health.version})` });
      } catch (err) {
        checks.push({ name: `${prefix} 服务端`, status: 'fail', message: err instanceof Error ? err.message : String(err) });
      }

      if (target.lastSuccessfulUploadAt) {
        checks.push({ name: `${prefix} 上次同步`, status: 'ok', message: target.lastSuccessfulUploadAt });
      } else {
        checks.push({ name: `${prefix} 上次同步`, status: 'warn', message: '暂无记录' });
      }
    }
  }

  // 扫描目录
  const scannerDirs: Array<[string, string]> = [
    [join(homedir(), '.claude', 'projects'), 'Claude 日志'],
    [join(homedir(), '.codex'), 'Codex 日志'],
  ];
  for (const [dir, label] of scannerDirs) {
    try {
      await stat(dir);
      checks.push({ name: label, status: 'ok', message: dir });
    } catch {
      checks.push({ name: label, status: 'warn', message: '目录不存在（未使用可忽略）' });
    }
  }

  // 定时同步
  const schedule = await getScheduleStatus();
  if (schedule.enabled) {
    checks.push({
      name: '定时同步',
      status: 'ok',
      message: schedule.intervalLabel ? `每 ${schedule.intervalLabel}` : '已启用',
    });
  } else {
    checks.push({ name: '定时同步', status: 'warn', message: '未启用，可执行 aiusage schedule on' });
  }

  return checks;
}
