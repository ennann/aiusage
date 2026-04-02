#!/usr/bin/env node
/**
 * Reads local AI usage data via the controller CLI and generates
 * a demo-data.ts file that the dashboard uses when the API is unreachable.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../../controller/dist/cli.js');
const OUT = resolve(__dirname, '../src/demo-data.ts');

function run(args) {
  const out = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out);
}

// 1. Get the monthly report
console.log('Fetching report...');
const report = run(['report', '--range', '1m', '--json']);

// 2. Scan each day for breakdown details (channel, project, etc.)
console.log(`Scanning ${report.daily.length} days...`);
const allBreakdowns = [];
for (const day of report.daily) {
  try {
    const scan = run(['scan', '--date', day.usageDate, '--json']);
    for (const b of scan.breakdowns) {
      allBreakdowns.push({ ...b, usageDate: day.usageDate });
    }
  } catch {
    // skip days that fail to scan
  }
}

// 3. Build OverviewResponse
const { totals } = report;

// dailyTrend
const dailyTrend = report.daily.map((d) => ({
  usageDate: d.usageDate,
  eventCount: d.eventCount,
  estimatedCostUsd: d.estimatedCostUsd,
}));

// tokenComposition
const tokenComposition = report.daily.map((d) => ({
  usageDate: d.usageDate,
  inputTokens: d.inputTokens,
  cachedInputTokens: d.cachedInputTokens,
  cacheWriteTokens: d.cacheWriteTokens,
  outputTokens: d.outputTokens,
  reasoningOutputTokens: d.reasoningOutputTokens,
  totalTokens: d.totalTokens,
}));

// modelCostShare
const modelCostShare = report.byModel
  .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
  .map((m) => ({
    value: m.model,
    label: m.model,
    estimatedCostUsd: m.estimatedCostUsd,
    eventCount: m.eventCount,
  }));

// channelCostShare — aggregate from breakdowns
const channelMap = new Map();
for (const b of allBreakdowns) {
  const key = b.channel;
  const prev = channelMap.get(key) || { value: key, label: key.toUpperCase(), estimatedCostUsd: 0, eventCount: 0 };
  // Approximate cost by proportion of tokens (we don't have per-breakdown cost)
  prev.eventCount += b.eventCount;
  prev.estimatedCostUsd += b.inputTokens + b.cachedInputTokens + b.cacheWriteTokens + b.outputTokens + b.reasoningOutputTokens;
  channelMap.set(key, prev);
}
// Convert token-based proportions to cost-based
const channelTotalTokens = [...channelMap.values()].reduce((s, c) => s + c.estimatedCostUsd, 0);
const channelCostShare = [...channelMap.values()]
  .map((c) => ({
    ...c,
    label: c.value === 'cli' ? 'CLI' : c.value === 'ide' ? 'IDE' : c.value === 'web' ? 'Web' : c.value === 'api' ? 'API' : c.value,
    estimatedCostUsd: channelTotalTokens > 0 ? +((c.estimatedCostUsd / channelTotalTokens) * totals.estimatedCostUsd).toFixed(4) : 0,
  }))
  .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

// sankey — Model → Project
const sankeyNodes = [];
const sankeyLinks = [];
const nodeSet = new Set();
const linkMap = new Map();

function ensureNode(id, label, layer) {
  if (!nodeSet.has(id)) {
    nodeSet.add(id);
    sankeyNodes.push({ id, label, layer, totalTokens: 0 });
  }
}

function addLink(source, target, value) {
  const key = `${source}→${target}`;
  linkMap.set(key, (linkMap.get(key) || 0) + value);
}

function fmtModel(raw) {
  if (!raw || raw === '<synthetic>') return 'Other';
  let s = raw.replace(/-\d{8}$/, '');
  s = s.replace(/(\d+)-(\d+)/g, '$1.$2');
  s = s.replace(/-/g, ' ');
  s = s.replace(/^claude\b/i, 'Claude');
  s = s.replace(/^gpt\s/i, 'GPT-');
  s = s.replace(/^o(\d)/i, 'O$1');
  s = s.replace(/(?<=\s)[a-z]/g, (c) => c.toUpperCase());
  return s;
}

// Pre-aggregate project tokens to find the top ones
const projectTokens = new Map();
for (const b of allBreakdowns) {
  const tokens = b.inputTokens + b.cachedInputTokens + b.cacheWriteTokens + b.outputTokens + b.reasoningOutputTokens;
  const proj = b.project || 'Unknown';
  projectTokens.set(proj, (projectTokens.get(proj) || 0) + tokens);
}
const TOP_PROJECTS = 7;
const sortedProjects = [...projectTokens.entries()].sort((a, b) => b[1] - a[1]);
const topProjectSet = new Set(sortedProjects.slice(0, TOP_PROJECTS).map(([p]) => p));

for (const b of allBreakdowns) {
  const tokens = b.inputTokens + b.cachedInputTokens + b.cacheWriteTokens + b.outputTokens + b.reasoningOutputTokens;
  const modelId = `model-${b.model}`;
  const rawProject = b.project || 'Unknown';
  const project = topProjectSet.has(rawProject) ? rawProject : 'Other';
  const projectId = `proj-${project}`;

  ensureNode(modelId, fmtModel(b.model), 0);
  ensureNode(projectId, project, 1);

  addLink(modelId, projectId, tokens);

  const nodeIdx = sankeyNodes.findIndex((n) => n.id === modelId);
  if (nodeIdx >= 0) sankeyNodes[nodeIdx].totalTokens += tokens;
}

for (const [key, value] of linkMap) {
  const [source, target] = key.split('→');
  sankeyLinks.push({ source, target, value });
}

// Derive provider cost from report.bySource ("anthropic/claude-code" → "anthropic")
const providerCostMap = new Map();
for (const s of report.bySource) {
  const provider = s.source.split('/')[0];
  const prev = providerCostMap.get(provider) || 0;
  providerCostMap.set(provider, prev + s.estimatedCostUsd);
}

// filters
function uniqueFacets(field) {
  const map = new Map();
  for (const b of allBreakdowns) {
    const v = b[field];
    const prev = map.get(v) || { value: v, label: v, estimatedCostUsd: 0, eventCount: 0 };
    prev.eventCount += b.eventCount;
    map.set(v, prev);
  }
  return [...map.values()];
}

const hostname = (() => {
  try { return execFileSync('hostname', { encoding: 'utf-8', timeout: 3000 }).trim(); } catch { return 'local'; }
})();

const filters = {
  selection: { range: '30d', deviceId: null, provider: null, product: null, channel: null, model: null, project: null },
  options: {
    devices: [{ value: hostname, label: hostname, estimatedCostUsd: totals.estimatedCostUsd, eventCount: totals.eventCount }],
    providers: uniqueFacets('provider').map((f) => ({
      ...f,
      label: f.value === 'anthropic' ? 'Anthropic' : f.value === 'openai' ? 'OpenAI' : f.value,
      estimatedCostUsd: providerCostMap.get(f.value) || 0,
    })),
    products: uniqueFacets('product').map((f) => ({
      ...f,
      label: f.value === 'claude-code' ? 'Claude Code' : f.value === 'codex' ? 'Codex' : f.value,
    })),
    channels: uniqueFacets('channel').map((f) => ({
      ...f,
      label: f.value === 'cli' ? 'CLI' : f.value === 'ide' ? 'IDE' : f.value === 'web' ? 'Web' : f.value === 'api' ? 'API' : f.value,
    })),
    models: uniqueFacets('model'),
    projects: uniqueFacets('project'),
  },
};

const overview = {
  ok: true,
  totalDays: report.requestedDays,
  activeDays: report.daysWithData,
  totalEvents: totals.eventCount,
  totalCostUsd: totals.estimatedCostUsd,
  averageDailyCostUsd: report.daysWithData > 0 ? +(totals.estimatedCostUsd / report.daysWithData).toFixed(4) : 0,
  dailyTrend,
  tokenComposition,
  modelCostShare,
  channelCostShare,
  sankey: { nodes: sankeyNodes, links: sankeyLinks },
  filters,
};

// 4. Write TypeScript file
const ts = `import type { OverviewResponse } from '@aiusage/shared';

/**
 * Auto-generated from local usage data on ${new Date().toISOString().slice(0, 10)}.
 * Re-generate: pnpm --filter @aiusage/dashboard generate-demo
 */

export const DEMO_OVERVIEW: OverviewResponse & { ok: boolean } = ${JSON.stringify(overview, null, 2)};

export const DEMO_HEALTH = {
  ok: true,
  siteId: 'demo',
  version: '0.1.0',
};
`;

writeFileSync(OUT, ts, 'utf-8');
console.log(`Written ${OUT} (${report.daysWithData} days, $${totals.estimatedCostUsd.toFixed(2)} total)`);
