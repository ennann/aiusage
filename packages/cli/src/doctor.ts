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

  // 必要字段
  const fields: Array<[keyof typeof config, string, string]> = [
    ['apiBaseUrl', '服务端地址', '请执行 aiusage init --server <URL>'],
    ['siteId', '站点 ID', '请执行 aiusage init --site-id <ID>'],
    ['deviceId', '设备 ID', '请执行 aiusage init'],
    ['deviceToken', '设备令牌', '请执行 aiusage enroll'],
  ];
  for (const [key, label, hint] of fields) {
    const value = config[key];
    if (value) {
      const display = key === 'deviceToken' ? `${String(value).slice(0, 12)}…` : String(value);
      checks.push({ name: label, status: 'ok', message: display });
    } else {
      checks.push({
        name: label,
        status: key === 'deviceToken' ? 'fail' : 'warn',
        message: `未配置，${hint}`,
      });
    }
  }

  // 服务端连通性
  if (config.apiBaseUrl) {
    try {
      const health = await fetchHealth(config.apiBaseUrl);
      checks.push({ name: '服务端连通', status: 'ok', message: `${health.siteId} (v${health.version})` });
    } catch (err) {
      checks.push({ name: '服务端连通', status: 'fail', message: err instanceof Error ? err.message : String(err) });
    }
  } else {
    checks.push({ name: '服务端连通', status: 'warn', message: '跳过（未配置服务端地址）' });
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

  // 上次同步
  if (config.lastSuccessfulUploadAt) {
    checks.push({ name: '上次同步', status: 'ok', message: config.lastSuccessfulUploadAt });
  } else {
    checks.push({ name: '上次同步', status: 'warn', message: '暂无记录' });
  }

  return checks;
}
