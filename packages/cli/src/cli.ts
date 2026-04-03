import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { scanDate, scanDates } from './scan.js';
import { buildLocalReport, parseReportRange } from './report.js';
import { renderReport } from './render.js';
import {
  type SyncTarget,
  detectDeviceId,
  getConfigPath,
  normalizeServerUrl,
  readConfig,
  setConfigValue,
  upsertTarget,
  writeConfig,
} from './config.js';
import { defaultLookbackDays, enrollDevice, fetchHealth, uploadDailyUsage } from './api.js';
import { disableSchedule, enableSchedule, formatInterval, getScheduleStatus, parseInterval } from './schedule.js';
import { runDoctor } from './doctor.js';
import { getVersion } from './version.js';

const argv = process.argv.slice(2);
const command = argv[0];

try {
  if (command === '--version' || command === '-v') {
    console.log(getVersion());
  } else if (command === 'scan') {
    const parsed = parseArgs(argv.slice(1));
    const date = typeof parsed.flags.date === 'string' ? parsed.flags.date : getYesterdayDate();
    await runScan(date, Boolean(parsed.flags.json));
  } else if (command === 'report') {
    const parsed = parseArgs(argv.slice(1));
    await runReport(parsed.flags);
  } else if (command === 'health') {
    const parsed = parseArgs(argv.slice(1));
    await runHealth(parsed.flags.server);
  } else if (command === 'enroll') {
    const parsed = parseArgs(argv.slice(1));
    await runEnroll(parsed.flags);
  } else if (command === 'sync') {
    const parsed = parseArgs(argv.slice(1));
    await runSync(parsed.flags);
  } else if (command === 'init') {
    const parsed = parseArgs(argv.slice(1));
    await runInit(parsed.flags);
  } else if (command === 'schedule') {
    const sub = argv[1];
    if (sub === 'off') {
      await runSchedule('off', {});
    } else if (sub === 'status') {
      await runSchedule('status', {});
    } else if (sub === 'on') {
      const parsed = parseArgs(argv.slice(2));
      await runSchedule('on', parsed.flags);
    } else {
      // 无子命令 → 默认启用 5m
      const parsed = parseArgs(argv.slice(1));
      await runSchedule('on', parsed.flags);
    }
  } else if (command === 'doctor') {
    await runDoctorCommand();
  } else if (command === 'config' && argv[1] === 'set') {
    await runConfigSet(argv.slice(2));
  } else if (command === 'setup') {
    console.log('To deploy the server, clone the repo and run the setup wizard:\n');
    console.log('  git clone https://github.com/ennann/aiusage.git');
    console.log('  cd aiusage && pnpm install');
    console.log('  pnpm setup\n');
    console.log('See: https://github.com/ennann/aiusage#deploy-your-own-server');
  } else {
    printHelp();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runScan(date: string, isJson: boolean) {
  const config = await readConfig();
  if (!isJson) console.log(`扫描日期: ${date}\n`);

  const result = await scanDate(date, { projectAliases: config.projectAliases });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.breakdowns.length === 0) {
    console.log('该日无数据。');
    return;
  }

  // 按 provider 分组展示
  const byProvider = new Map<string, typeof result.breakdowns>();
  for (const b of result.breakdowns) {
    const key = `${b.provider}/${b.product}`;
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key)!.push(b);
  }

  for (const [provider, breakdowns] of byProvider) {
    console.log(`── ${provider} ──`);
    for (const b of breakdowns.sort((a, c) => c.inputTokens - a.inputTokens)) {
      console.log(`  ${b.model} | ${b.project}`);
      console.log(`    事件: ${b.eventCount}  输入: ${fmt(b.inputTokens)}  缓存读: ${fmt(b.cachedInputTokens)}  缓存写: ${fmt(b.cacheWriteTokens)}  输出: ${fmt(b.outputTokens)}  推理: ${fmt(b.reasoningOutputTokens)}`);
    }
    console.log();
  }

  console.log('── 合计 ──');
  console.log(`  事件: ${result.totals.eventCount}  输入: ${fmt(result.totals.inputTokens)}  缓存读: ${fmt(result.totals.cachedInputTokens)}  缓存写: ${fmt(result.totals.cacheWriteTokens)}  输出: ${fmt(result.totals.outputTokens)}  推理: ${fmt(result.totals.reasoningOutputTokens)}`);
}

async function runReport(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const range = parseReportRange(flags.range);
  const report = await buildLocalReport(range, { projectAliases: config.projectAliases });

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const lang = (typeof flags.lang === 'string' ? flags.lang : config.lang) || 'en';
  if (lang !== 'en' && lang !== 'zh') throw new Error('--lang only supports en or zh');

  const emoji = flags['no-emoji'] === true ? false : (config.emoji ?? true);
  const detail = flags.detail === true;

  console.log(renderReport(report, { lang, emoji, detail }));
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

async function runHealth(serverFlag: string | boolean | undefined) {
  const config = await readConfig();
  const apiBaseUrl = resolveServer(serverFlag, config.apiBaseUrl);
  const health = await fetchHealth(apiBaseUrl);
  console.log(JSON.stringify(health, null, 2));
}

async function runEnroll(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const apiBaseUrl = resolveServer(flags.server, undefined);
  const siteId = resolveRequiredString(flags['site-id'] ?? flags.siteId, undefined, '缺少 --site-id');
  const enrollToken = resolveRequiredString(flags['enroll-token'], undefined, '缺少 --enroll-token');
  const deviceId = resolveOptionalString(flags['device-id'], config.deviceId) ?? detectDeviceId();
  const deviceAlias = resolveOptionalString(flags['device-name'] ?? flags['device-alias'], config.deviceAlias);
  const targetName = resolveOptionalString(flags.target ?? flags.name, undefined) ?? deriveTargetName(apiBaseUrl);

  const response = await enrollDevice(apiBaseUrl, { siteId, deviceId, deviceAlias, enrollToken });

  const target: SyncTarget = {
    name: targetName,
    apiBaseUrl,
    siteId,
    deviceToken: response.deviceToken,
    lastSuccessfulUploadAt: undefined,
  };

  let next = upsertTarget(config, target);
  next.deviceId = deviceId;
  next.deviceAlias = deviceAlias;
  next.lookbackDays = config.lookbackDays ?? 7;

  await writeConfig(next);

  console.log(JSON.stringify({
    target: targetName,
    siteId: response.siteId,
    deviceId: response.deviceId,
    issuedAt: response.issuedAt,
    configPath: getConfigPath(),
  }, null, 2));
}

async function runSync(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const apiBaseUrl = resolveServer(flags.server, config.apiBaseUrl);
  const siteId = resolveRequiredString(undefined, config.siteId, '缺少 siteId，请先执行 init 或 enroll');
  const deviceId = resolveRequiredString(undefined, config.deviceId, '缺少 deviceId，请先执行 init 或 enroll');
  const deviceToken = resolveRequiredString(undefined, config.deviceToken, '缺少 deviceToken，请先执行 enroll');

  const requestedDate = typeof flags.date === 'string' ? flags.date : undefined;
  const fromDate = typeof flags.from === 'string' ? flags.from : undefined;
  const toDate = typeof flags.to === 'string' ? flags.to : undefined;

  const includeToday = Boolean(flags.today);

  let targetDates: string[];
  if (requestedDate) {
    targetDates = [requestedDate];
  } else if (fromDate) {
    targetDates = buildDateRange(fromDate, toDate ?? getYesterdayDate());
  } else {
    const lookbackDays = typeof flags.lookback === 'string'
      ? parsePositiveInt(flags.lookback, '--lookback')
      : defaultLookbackDays(config);
    targetDates = getClosedDates(lookbackDays);
    if (includeToday) {
      targetDates.push(getTodayDate());
    }
  }

  console.log(`扫描 ${targetDates.length} 天 (${targetDates[0]} ~ ${targetDates[targetDates.length - 1]})${includeToday ? ' [含今日]' : ''} ...`);

  const results = await scanDates(targetDates, { projectAliases: config.projectAliases });
  const allDays = results
    .filter(r => r.breakdowns.length > 0)
    .map(r => ({ usageDate: r.usageDate, breakdowns: r.breakdowns }));

  if (allDays.length === 0) {
    console.log('没有可上传的数据。');
    return;
  }

  console.log(`发现 ${allDays.length} 天有数据，开始上传 ...`);

  const BATCH_SIZE = 30;
  let totalProcessed = 0;
  const allCostSummary: Record<string, { estimatedCostUsd: number; costStatus: string }> = {};

  for (let i = 0; i < allDays.length; i += BATCH_SIZE) {
    const batch = allDays.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allDays.length / BATCH_SIZE);
    if (totalBatches > 1) {
      console.log(`  批次 ${batchNum}/${totalBatches}: ${batch[0].usageDate} ~ ${batch[batch.length - 1].usageDate}`);
    }

    const response = await uploadDailyUsage(
      apiBaseUrl,
      { siteId, deviceId, deviceAlias: config.deviceAlias, deviceToken },
      batch,
    );
    totalProcessed += response.daysProcessed;
    Object.assign(allCostSummary, response.costSummary);
  }

  await writeConfig({
    ...config,
    apiBaseUrl,
    siteId,
    deviceId,
    deviceToken,
    lastSuccessfulUploadAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    uploadedDays: allDays.map(day => day.usageDate),
    daysProcessed: totalProcessed,
    costSummary: allCostSummary,
  }, null, 2));
}

async function runInit(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const next = {
    ...config,
    apiBaseUrl: typeof flags.server === 'string'
      ? normalizeServerUrl(flags.server)
      : config.apiBaseUrl,
    siteId: resolveOptionalString(flags['site-id'] ?? flags.siteId, config.siteId),
    deviceId: resolveOptionalString(flags['device-id'], config.deviceId) ?? detectDeviceId(),
    deviceAlias: resolveOptionalString(flags['device-name'] ?? flags['device-alias'], config.deviceAlias) ?? hostname(),
    lookbackDays: typeof flags.lookback === 'string'
      ? parsePositiveInt(flags.lookback, '--lookback')
      : config.lookbackDays ?? 7,
  };

  await writeConfig(next);
  console.log(JSON.stringify({ configPath: getConfigPath(), config: next }, null, 2));
}

async function runSchedule(sub: string | undefined, flags: Record<string, string | boolean>) {
  if (sub === 'on') {
    const every = typeof flags.every === 'string' ? flags.every : '5m';
    const { seconds } = parseInterval(every);
    const status = await enableSchedule(seconds);
    console.log(`定时同步已启用，每 ${status.intervalLabel} 执行一次（含今日数据）。`);
    if (status.path) console.log(`配置: ${status.path}`);
    console.log(`日志: ~/.aiusage/sync.log`);
  } else if (sub === 'off') {
    await disableSchedule();
    console.log('定时同步已关闭。');
  } else {
    const status = await getScheduleStatus();
    if (status.enabled) {
      console.log(`状态: 已启用`);
      if (status.intervalLabel) console.log(`间隔: 每 ${status.intervalLabel}`);
      if (status.path) console.log(`配置: ${status.path}`);
    } else {
      console.log('状态: 未启用');
      console.log('启用: aiusage schedule [--every 5m]');
    }
  }
}

async function runDoctorCommand() {
  const checks = await runDoctor();
  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    console.log(`${icon} ${check.name}: ${check.message}`);
  }
  const failures = checks.filter((c) => c.status === 'fail');
  if (failures.length > 0) process.exitCode = 1;
}

async function runConfigSet(args: string[]) {
  const [keyPath, ...values] = args;
  if (!keyPath) throw new Error('config set 缺少配置项');
  const config = await readConfig();
  const next = setConfigValue(config, keyPath, values);
  await writeConfig(next);
  console.log(JSON.stringify({ configPath: getConfigPath(), updated: keyPath }, null, 2));
}

function printHelp() {
  const initialized = existsSync(getConfigPath());
  console.log(`aiusage v${getVersion()}\n`);
  console.log('Usage: aiusage <command>');
  console.log('');
  console.log('Commands:');
  console.log('  aiusage init [--server URL] [--site-id ID] [--device-id ID] [--device-name NAME] [--lookback N]');
  console.log('  aiusage health [--server URL]');
  console.log('  aiusage enroll --server URL --site-id ID --enroll-token TOKEN [--device-id ID] [--device-name NAME]');
  console.log('  aiusage sync [--date YYYY-MM-DD] [--from YYYY-MM-DD [--to YYYY-MM-DD]] [--lookback N] [--today] [--server URL]');
  console.log('  aiusage scan [--date YYYY-MM-DD] [--json]');
  console.log('  aiusage report [--range 7d|1m|3m|all] [--detail] [--lang en|zh] [--no-emoji] [--json]');
  console.log('  aiusage schedule [on|off|status] [--every 5m]');
  console.log('  aiusage doctor');
  console.log('  aiusage config set <key> <value...>');
  console.log('');
  console.log(`配置文件: ${getConfigPath()}${initialized ? '' : ' (尚未初始化)'}`);
}

function parseArgs(args: string[]): { flags: Record<string, string | boolean>; positionals: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const trimmed = arg.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex >= 0) {
      flags[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[trimmed] = true;
      continue;
    }

    flags[trimmed] = next;
    index += 1;
  }

  return { flags, positionals };
}

function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function buildDateRange(from: string, to: string): string[] {
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  if (isNaN(start.getTime())) throw new Error(`--from 日期格式错误: ${from}`);
  if (isNaN(end.getTime())) throw new Error(`--to 日期格式错误: ${to}`);
  if (start > end) throw new Error('--from 不能晚于 --to');

  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getClosedDates(lookbackDays: number): string[] {
  const dates: string[] = [];
  for (let offset = lookbackDays; offset >= 1; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    dates.push(day.toISOString().split('T')[0]);
  }
  return dates;
}

function deriveTargetName(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split('.')[0] || 'default';
  } catch {
    return 'default';
  }
}

function resolveServer(flagValue: string | boolean | undefined, configValue?: string): string {
  const value = resolveOptionalString(flagValue, configValue);
  if (!value) throw new Error('缺少服务端地址，请传 --server 或先执行 init');
  return normalizeServerUrl(value);
}

function resolveRequiredString(
  flagValue: string | boolean | undefined,
  configValue: string | undefined,
  message: string,
): string {
  const value = resolveOptionalString(flagValue, configValue);
  if (!value) throw new Error(message);
  return value;
}

function resolveOptionalString(
  flagValue: string | boolean | undefined,
  fallback: string | undefined,
): string | undefined {
  return typeof flagValue === 'string' ? flagValue : fallback;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return parsed;
}
