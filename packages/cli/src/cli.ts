import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { hostname } from 'node:os';
import { scanDate, scanDates } from './scan.js';
import { scanAnthropicApiDates } from './scanners/anthropic-admin-api.js';
import { scanAnthropicCsvDates } from './scanners/anthropic-csv.js';
import { buildLocalReport, parseReportRange } from './report.js';
import { renderReport } from './render.js';
import {
  type AIUsageConfig,
  type SyncTarget,
  detectDeviceId,
  findTargetOrThrow,
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
import { discoverProjects } from './project.js';

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
    await runHealth(parsed.flags);
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
    const parsed = parseArgs(argv.slice(1));
    await runDoctorCommand(parsed.flags);
  } else if (command === 'config' && argv[1] === 'set') {
    await runConfigSet(argv.slice(2));
  } else if (command === 'project') {
    const sub = argv[1];
    if (sub === 'list') {
      const parsed = parseArgs(argv.slice(2));
      await runProjectList(parsed.flags);
    } else if (sub === undefined) {
      await runProjectList();
    } else if (sub === 'alias') {
      await runProjectAlias(argv.slice(2));
    } else {
      const zh = (await readConfig()).lang === 'zh';
      console.error(`${zh ? '未知子命令' : 'Unknown subcommand'}: project ${sub}`);
      console.log(zh
        ? '可用: aiusage project list, aiusage project alias <项目名> <别名>'
        : 'Available: aiusage project list, aiusage project alias <name> <alias>');
      process.exitCode = 1;
    }
  } else if (command === 'import') {
    const parsed = parseArgs(argv.slice(1));
    await runImport(parsed.flags, parsed.positionals);
  } else if (command === 'setup') {
    console.log('To deploy the server, clone the repo and run the setup wizard:\n');
    console.log('  git clone https://github.com/ennann/aiusage.git');
    console.log('  cd aiusage && pnpm install');
    console.log('  pnpm setup\n');
    console.log('See: https://github.com/ennann/aiusage#deploy-your-own-server');
  } else if (command === '--help' || command === '-h' || command === 'help') {
    const zh = (await readConfig()).lang === 'zh';
    printHelp(zh);
  } else {
    const config = await readConfig();
    const lang = config.lang || 'en';
    const zh = lang === 'zh';
    if (command) {
      console.error(`${zh ? '未知命令' : 'Unknown command'}: "${command}"\n`);
    }
    printUsageHint(zh);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runScan(date: string, isJson: boolean) {
  const config = await readConfig();
  const zh = config.lang === 'zh';
  if (!isJson) console.log(`${zh ? '扫描日期' : 'Scan date'}: ${date}\n`);

  const result = await scanDate(date, { projectAliases: config.projectAliases });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.breakdowns.length === 0) {
    console.log(zh ? '该日无数据。' : 'No data for this date.');
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
      console.log(`  ${b.model} | ${b.projectAlias ?? b.projectDisplay ?? b.project}`);
      console.log(`    事件: ${b.eventCount}  输入: ${fmt(b.inputTokens)}  缓存读: ${fmt(b.cachedInputTokens)}  缓存写: ${fmt(b.cacheWriteTokens)}  输出: ${fmt(b.outputTokens)}  推理: ${fmt(b.reasoningOutputTokens)}`);
    }
    console.log();
  }

  console.log('── 合计 ──');
  console.log(`  事件: ${result.totals.eventCount}  输入: ${fmt(result.totals.inputTokens)}  缓存读: ${fmt(result.totals.cachedInputTokens)}  缓存写: ${fmt(result.totals.cacheWriteTokens)}  输出: ${fmt(result.totals.outputTokens)}  推理: ${fmt(result.totals.reasoningOutputTokens)}`);
}

async function runReport(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const range = parseReportRange(flags.range, flags.today === true);
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

async function runHealth(flags: Record<string, string | boolean>) {
  const config = await readConfig();

  if (typeof flags.server === 'string') {
    const health = await fetchHealth(normalizeServerUrl(flags.server));
    console.log(JSON.stringify(health, null, 2));
    return;
  }

  const targetName = resolveOptionalString(flags.target, undefined);
  const target = findTargetOrThrow(config, targetName);
  const health = await fetchHealth(target.apiBaseUrl);
  console.log(JSON.stringify(health, null, 2));
}

async function runEnroll(flags: Record<string, string | boolean>) {
  const config = await readConfig();

  // 从 flags → config 已有 target → 交互式提示
  const existingTarget = config.targets?.[0];
  const apiBaseUrl = resolveOptionalString(flags.server, existingTarget?.apiBaseUrl)
    ?? await prompt('Server URL: ');
  if (!apiBaseUrl) throw new Error('缺少服务端地址');
  const normalizedUrl = normalizeServerUrl(apiBaseUrl);

  const siteId = resolveOptionalString(flags['site-id'] ?? flags.siteId, existingTarget?.siteId)
    ?? await prompt('Site ID: ');
  if (!siteId) throw new Error('缺少 site-id');

  const enrollToken = resolveOptionalString(flags['enroll-token'], undefined)
    ?? await prompt('Enroll Token: ');
  if (!enrollToken) throw new Error('缺少 enroll-token');

  const deviceId = resolveOptionalString(flags['device-id'], config.deviceId) ?? detectDeviceId();
  const deviceAlias = resolveOptionalString(flags['device-name'] ?? flags['device-alias'], config.deviceAlias)
    ?? (await prompt(`Device Name [${hostname()}]: `) || hostname());
  const targetName = resolveOptionalString(flags.target ?? flags.name, undefined) ?? deriveTargetName(normalizedUrl);

  const response = await enrollDevice(normalizedUrl, { siteId, deviceId, deviceAlias, enrollToken });

  const target: SyncTarget = {
    name: targetName,
    apiBaseUrl: normalizedUrl,
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

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runSync(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const allTargets = config.targets ?? [];
  if (allTargets.length === 0) {
    throw new Error('未配置任何上报目标，请先执行 aiusage enroll');
  }

  const deviceId = resolveRequiredString(undefined, config.deviceId, '缺少 deviceId，请先执行 enroll');

  // 确定目标列表
  const targetName = resolveOptionalString(flags.target, undefined);
  const targets = targetName
    ? [findTargetOrThrow(config, targetName)]
    : allTargets;

  // ── 日期解析（保持现有逻辑不变） ──
  const requestedDate = typeof flags.date === 'string' ? flags.date : undefined;
  const fromDate = typeof flags.from === 'string' ? flags.from : undefined;
  const toDate = typeof flags.to === 'string' ? flags.to : undefined;
  let targetDates: string[];
  if (requestedDate) {
    targetDates = [requestedDate];
  } else if (fromDate) {
    targetDates = buildDateRange(fromDate, toDate ?? getTodayDate());
  } else if (flags.today === true) {
    targetDates = [getTodayDate()];
  } else {
    const lookbackDays = typeof flags.lookback === 'string'
      ? parsePositiveInt(flags.lookback, '--lookback')
      : defaultLookbackDays(config);
    targetDates = getClosedDates(lookbackDays);
    targetDates.push(getTodayDate());
  }

  // 扫描一次，所有 target 共享结果
  console.log(`扫描 ${targetDates.length} 天 (${targetDates[0]} ~ ${targetDates[targetDates.length - 1]}) ...`);

  const results = await scanDates(targetDates, { projectAliases: config.projectAliases });
  const allDays = results
    .filter(r => r.breakdowns.length > 0)
    .map(r => ({ usageDate: r.usageDate, breakdowns: r.breakdowns }));

  if (allDays.length === 0) {
    console.log('没有可上传的数据。');
    return;
  }

  console.log(`发现 ${allDays.length} 天有数据，开始上传 ...`);

  // 逐 target 上传
  const uploadResults: Array<{ target: string; daysProcessed: number; costSummary: Record<string, { estimatedCostUsd: number; costStatus: string }> }> = [];

  for (const target of targets) {
    if (!target.deviceToken) {
      console.log(`跳过 "${target.name}"：未注册（缺少 deviceToken）`);
      continue;
    }
    if (targets.length > 1) {
      console.log(`上传至 "${target.name}" (${target.apiBaseUrl}) ...`);
    }

    const BATCH_SIZE = 30;
    let totalProcessed = 0;
    const allCostSummary: Record<string, { estimatedCostUsd: number; costStatus: string }> = {};

    for (let i = 0; i < allDays.length; i += BATCH_SIZE) {
      const batch = allDays.slice(i, i + BATCH_SIZE);
      const totalBatches = Math.ceil(allDays.length / BATCH_SIZE);
      if (totalBatches > 1) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        console.log(`  批次 ${batchNum}/${totalBatches}: ${batch[0].usageDate} ~ ${batch[batch.length - 1].usageDate}`);
      }

      const response = await uploadDailyUsage(
        target.apiBaseUrl,
        { siteId: target.siteId, deviceId, deviceAlias: config.deviceAlias, deviceToken: target.deviceToken },
        batch,
      );
      totalProcessed += response.daysProcessed;
      Object.assign(allCostSummary, response.costSummary);
    }

    // 更新该 target 的 lastSuccessfulUploadAt
    target.lastSuccessfulUploadAt = new Date().toISOString();

    uploadResults.push({ target: target.name, daysProcessed: totalProcessed, costSummary: allCostSummary });
  }

  // 回写配置（targets 已在循环中被 mutate）
  await writeConfig(config);

  console.log(JSON.stringify({
    targets: uploadResults.map(r => r.target),
    uploadedDays: allDays.map(day => day.usageDate),
    results: uploadResults,
  }, null, 2));
}

async function runImport(flags: Record<string, string | boolean>, positionals: string[] = []) {
  const config = await readConfig();

  const targetName = resolveOptionalString(flags.target, undefined);
  const allTargets = config.targets ?? [];
  if (allTargets.length === 0) throw new Error('未配置任何上报目标，请先执行 aiusage enroll');
  const targets = targetName ? [findTargetOrThrow(config, targetName)] : allTargets;
  const deviceId = resolveRequiredString(undefined, config.deviceId, '缺少 deviceId，请先执行 enroll');

  // Detect mode: CSV files passed as positional args vs Admin API
  const csvFiles = positionals.filter(p => p.endsWith('.csv'));

  let allDays: Array<{ usageDate: string; breakdowns: import('@aiusage/shared').IngestBreakdown[] }>;

  if (csvFiles.length > 0) {
    // CSV mode: scan all provided files and determine date range from flags or auto-detect
    console.log(`Importing from ${csvFiles.length} CSV file(s)...`);

    // Build date range: if --start/--end specified use those, else scan all dates in files
    const startDate = resolveOptionalString(flags.start, undefined);
    const endDate = resolveOptionalString(flags.end, undefined);

    // First pass: collect all dates present across all CSV files
    let dateRange: string[];
    if (startDate && endDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new Error('Dates must be in YYYY-MM-DD format');
      }
      if (startDate > endDate) throw new Error('--start must be before --end');
      dateRange = buildDateRange(startDate, endDate);
    } else {
      // Scan with a wide range covering all possible CSV dates (2020–2030)
      dateRange = buildDateRange('2020-01-01', '2030-12-31');
    }

    const csvResults = await scanAnthropicCsvDates(dateRange, csvFiles);
    allDays = dateRange
      .map(date => ({ usageDate: date, breakdowns: csvResults.get(date) ?? [] }))
      .filter(d => d.breakdowns.length > 0);

    if (allDays.length === 0) {
      console.log('No usage data found in the provided CSV files.');
      return;
    }
    console.log(`Found data for ${allDays.length} days across CSV files.`);
  } else {
    // Admin API mode
    const adminKey = resolveOptionalString(flags.key, config.anthropicAdminKey);
    if (!adminKey) {
      throw new Error(
        'Provide CSV files or an Anthropic Admin API key.\n' +
        '  CSV:  aiusage import /path/to/*.csv\n' +
        '  API:  aiusage import --key sk-ant-admin... --start DATE --end DATE\n' +
        '        aiusage config set anthropic-admin-key sk-ant-admin...\n' +
        '  Download CSVs at: https://platform.claude.com/usage?date=YYYY-MM\n' +
        '  Get Admin key at: console.anthropic.com → Settings → Admin Keys',
      );
    }

    const startDate = resolveOptionalString(flags.start, undefined);
    const endDate = resolveOptionalString(flags.end, undefined);
    if (!startDate) throw new Error('--start DATE is required (e.g. --start 2025-11-01)');
    if (!endDate) throw new Error('--end DATE is required (e.g. --end 2026-01-08)');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('Dates must be in YYYY-MM-DD format');
    }
    if (startDate > endDate) throw new Error('--start must be before --end');

    console.log(`Fetching Anthropic API usage: ${startDate} → ${endDate}`);

    const dateRange = buildDateRange(startDate, endDate);
    const apiResults = await scanAnthropicApiDates(dateRange, adminKey);

    allDays = dateRange
      .map(date => ({ usageDate: date, breakdowns: apiResults.get(date) ?? [] }))
      .filter(d => d.breakdowns.length > 0);

    if (allDays.length === 0) {
      console.log('No usage data returned from Anthropic API for the specified range.');
      return;
    }
    console.log(`Found data for ${allDays.length} days. Uploading...`);
  }

  for (const target of targets) {
    if (!target.deviceToken) {
      console.log(`Skipping "${target.name}": not enrolled (missing deviceToken)`);
      continue;
    }

    const BATCH_SIZE = 30;
    let totalProcessed = 0;

    for (let i = 0; i < allDays.length; i += BATCH_SIZE) {
      const batch = allDays.slice(i, i + BATCH_SIZE);
      const response = await uploadDailyUsage(
        target.apiBaseUrl,
        { siteId: target.siteId, deviceId, deviceAlias: config.deviceAlias, deviceToken: target.deviceToken },
        batch,
      );
      totalProcessed += response.daysProcessed;
    }

    console.log(`Uploaded ${totalProcessed} days to "${target.name}"`);
  }
}

async function runInit(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const next: AIUsageConfig = {
    ...config,
    deviceId: resolveOptionalString(flags['device-id'], config.deviceId) ?? detectDeviceId(),
    deviceAlias: resolveOptionalString(flags['device-name'] ?? flags['device-alias'], config.deviceAlias) ?? hostname(),
    lookbackDays: typeof flags.lookback === 'string'
      ? parsePositiveInt(flags.lookback, '--lookback')
      : config.lookbackDays ?? 7,
  };
  // 保存 server / site-id 到默认 target（方便后续 enroll 读取）
  const serverUrl = resolveOptionalString(flags.server, undefined);
  const siteId = resolveOptionalString(flags['site-id'] ?? flags.siteId, undefined);
  if (serverUrl || siteId) {
    const existing = next.targets?.[0];
    const target: SyncTarget = {
      name: existing?.name ?? 'default',
      apiBaseUrl: serverUrl ? normalizeServerUrl(serverUrl) : existing?.apiBaseUrl ?? '',
      siteId: siteId ?? existing?.siteId,
      deviceToken: existing?.deviceToken,
      lastSuccessfulUploadAt: existing?.lastSuccessfulUploadAt,
    };
    const targets = next.targets ?? [];
    const idx = targets.findIndex(t => t.name === target.name);
    if (idx >= 0) targets[idx] = target;
    else targets.push(target);
    next.targets = targets;
  }
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
      console.log(`含今日: ${status.includeToday ? '是' : '否'}`);
      if (status.command) console.log(`命令: ${status.command}`);
      if (status.path) console.log(`配置: ${status.path}`);
      if (status.logPath) console.log(`日志: ${status.logPath}`);
    } else {
      console.log('状态: 未启用');
      console.log('启用: aiusage schedule on [--every 5m]');
    }
  }
}

async function runDoctorCommand(flags: Record<string, string | boolean>) {
  const config = await readConfig();
  const lang = (typeof flags.lang === 'string' ? flags.lang : config.lang) || 'en';
  const checks = await runDoctor(lang as 'en' | 'zh');

  let lastGroup = '';
  for (const check of checks) {
    if (check.group !== lastGroup) {
      if (lastGroup) console.log('');
      console.log(`── ${check.group} ──`);
      lastGroup = check.group;
    }
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    console.log(`  ${icon} ${check.name}: ${check.message}`);
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

async function runProjectList(flags: Record<string, string | boolean> = {}) {
  const config = await readConfig();
  const lang = (typeof flags.lang === 'string' ? flags.lang : config.lang) || 'en';
  const zh = lang === 'zh';
  const projects = await discoverProjects(config.projectAliases);

  if (projects.length === 0) {
    console.log(zh ? '未发现任何项目。' : 'No projects found.');
    return;
  }

  // 计算列宽（考虑全角字符占 2 个显示宽度）
  const dw = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  const pad = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - dw(s)));

  const hName = zh ? '项目' : 'Project';
  const hAlias = zh ? '别名' : 'Alias';
  const hSource = zh ? '来源' : 'Source';

  const nameWidth = Math.max(dw(hName), ...projects.map(p => dw(p.name)));
  const aliasWidth = Math.max(dw(hAlias), ...projects.map(p => dw(p.alias ?? '-')));

  console.log(pad(hName, nameWidth + 2) + pad(hAlias, aliasWidth + 2) + hSource);
  console.log('-'.repeat(nameWidth + aliasWidth + 20));

  // 在 . 前插入零宽空格，阻止终端将文本识别为 URL 并自动添加 <> 导致错位
  const breakUrl = (s: string) => s.replace(/\./g, '\u200B.');

  for (const p of projects) {
    const line =
      pad(p.name, nameWidth + 2) +
      pad(p.alias ?? '-', aliasWidth + 2) +
      p.sources.join(', ');
    console.log(breakUrl(line));
  }

  console.log(`\n${zh ? '共' : 'Total:'} ${projects.length} ${zh ? '个项目' : 'projects'}`);
}

async function runProjectAlias(args: string[]) {
  const config = await readConfig();
  const zh = config.lang === 'zh';

  if (args.length === 0) {
    const aliases = config.projectAliases ?? {};
    const entries = Object.entries(aliases);
    if (entries.length === 0) {
      console.log(zh ? '尚未设置任何项目别名。' : 'No project aliases configured.');
      console.log(zh
        ? '用法: aiusage project alias <项目名> <别名>'
        : 'Usage: aiusage project alias <name> <alias>');
      return;
    }
    for (const [from, to] of entries) {
      console.log(`  ${from} → ${to}`);
    }
    return;
  }

  if (args[0] === '--remove') {
    const name = args.slice(1).join(' ').trim();
    if (!name) throw new Error(zh ? '请指定要移除别名的项目名' : 'Please specify the project name to remove');
    const aliases = { ...(config.projectAliases ?? {}) };
    if (!(name in aliases)) {
      throw new Error(zh ? `项目 "${name}" 未设置别名` : `No alias set for "${name}"`);
    }
    delete aliases[name];
    config.projectAliases = Object.keys(aliases).length > 0 ? aliases : undefined;
    await writeConfig(config);
    console.log(zh ? `已移除 "${name}" 的别名。` : `Removed alias for "${name}".`);
    return;
  }

  if (args.length < 2) {
    throw new Error(zh
      ? '用法: aiusage project alias <项目名> <别名>'
      : 'Usage: aiusage project alias <name> <alias>');
  }

  const name = args[0];
  const alias = args.slice(1).join(' ').trim();
  if (!alias) throw new Error(zh ? '别名不能为空' : 'Alias cannot be empty');

  config.projectAliases = { ...(config.projectAliases ?? {}), [name]: alias };
  await writeConfig(config);
  console.log(zh ? `已设置: ${name} → ${alias}` : `Set: ${name} → ${alias}`);
}

function printHelp(zh = false) {
  console.log(`aiusage v${getVersion()}\n`);
  const cmds = zh ? [
    ['scan [--date YYYY-MM-DD] [--json]',                    '扫描某日用量明细'],
    ['report [--range 7d|1m|3m|all] [--detail] [--json]',    '本地用量报告'],
    ['sync [--today] [--lookback N] [--date YYYY-MM-DD]',    '上传用量到服务端'],
    ['sync --from YYYY-MM-DD [--to YYYY-MM-DD]',             '上传指定日期范围'],
    ['project [list|alias]',                                  '项目管理与别名设置'],
    ['schedule [on|off|status] [--every 5m]',                '定时同步管理'],
    ['doctor',                                               '诊断检查'],
    ['config set <key> <value>',                             '修改配置'],
    ['init [--device-id ID] [--device-name NAME]',           '初始化本地配置'],
    ['enroll --server URL --site-id ID --enroll-token TOKEN','注册设备到服务端'],
    ['health [--server URL]',                                '测试服务端连通性'],
  ] : [
    ['scan [--date YYYY-MM-DD] [--json]',                    'Scan daily usage breakdown'],
    ['report [--range 7d|1m|3m|all] [--detail] [--json]',    'Local usage report'],
    ['sync [--today] [--lookback N] [--date YYYY-MM-DD]',    'Upload usage to server'],
    ['sync --from YYYY-MM-DD [--to YYYY-MM-DD]',             'Upload specific date range'],
    ['project [list|alias]',                                 'Project management & aliases'],
    ['schedule [on|off|status] [--every 5m]',                'Scheduled sync management'],
    ['doctor',                                               'Run diagnostics'],
    ['config set <key> <value>',                             'Update config'],
    ['init [--device-id ID] [--device-name NAME]',           'Initialize local config'],
    ['enroll --server URL --site-id ID --enroll-token TOKEN','Register device with server'],
    ['health [--server URL]',                                'Test server connectivity'],
  ];

  const dw = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  const pad = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - dw(s)));
  const maxCmd = Math.max(...cmds.map(c => dw(c[0])));
  console.log(zh ? '命令:' : 'Commands:');
  for (const [cmd, desc] of cmds) {
    console.log(`  ${pad(cmd, maxCmd + 2)} ${desc}`);
  }
  console.log('');
  console.log(`${zh ? '配置文件' : 'Config'}: ${getConfigPath()}`);
}

function printUsageHint(zh = false) {
  console.log(`aiusage v${getVersion()}\n`);
  const cmds = zh ? [
    ['scan [--date YYYY-MM-DD]',              '扫描某日用量明细'],
    ['report [--range 7d|1m|3m|all]',         '本地用量报告'],
    ['sync [--today]',                        '上传用量到服务端'],
    ['project [list|alias]',                  '项目管理与别名设置'],
    ['schedule [on|off|status]',              '定时同步管理'],
    ['doctor',                                '诊断检查'],
    ['config set <key> <value>',              '修改配置'],
  ] : [
    ['scan [--date YYYY-MM-DD]',              'Scan daily usage breakdown'],
    ['report [--range 7d|1m|3m|all]',         'Local usage report'],
    ['sync [--today]',                        'Upload usage to server'],
    ['project [list|alias]',                  'Project management & aliases'],
    ['schedule [on|off|status]',              'Scheduled sync management'],
    ['doctor',                                'Run diagnostics'],
    ['config set <key> <value>',              'Update config'],
  ];

  const dw2 = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  const pad2 = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - dw2(s)));
  const maxCmd2 = Math.max(...cmds.map(c => dw2(c[0])));
  console.log(zh ? '常用命令:' : 'Commands:');
  for (const [cmd, desc] of cmds) {
    console.log(`  ${pad2(cmd, maxCmd2 + 2)} ${desc}`);
  }
  console.log('');
  console.log(`${zh ? '配置文件' : 'Config'}: ${getConfigPath()}`);
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

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return localDateKey(yesterday);
}

function getTodayDate(): string {
  return localDateKey(new Date());
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
    dates.push(localDateKey(day));
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
