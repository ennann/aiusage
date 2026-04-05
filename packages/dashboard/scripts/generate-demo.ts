#!/usr/bin/env -S pnpm exec tsx
/**
 * Reads local AI usage data directly from the CLI scanners and generates
 * a demo-data.ts file that the dashboard uses when the API is unreachable.
 *
 * Default window: last 400 days.
 * Override with AIUSAGE_DEMO_DAYS=<n>.
 */
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IngestBreakdown } from '../../shared/src/types.ts';
import { readConfig } from '../../cli/src/config.ts';
import { calculateBreakdownCost } from '../../cli/src/report.ts';
import { scanDates } from '../../cli/src/scan.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/demo-data.ts');

const DEFAULT_LOOKBACK_DAYS = 400;
const TOP_PROJECTS = 7;

function getLookbackDays(): number {
  const raw = process.env.AIUSAGE_DEMO_DAYS;
  if (!raw) return DEFAULT_LOOKBACK_DAYS;
  const days = Number.parseInt(raw, 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`AIUSAGE_DEMO_DAYS must be a positive integer, received: ${raw}`);
  }
  return days;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildTrailingDates(days: number): string[] {
  const today = new Date();
  const result: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const current = new Date(today);
    current.setDate(today.getDate() - offset);
    result.push(toDateKey(current));
  }
  return result;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(4));
}

function totalTokensOf(breakdown: IngestBreakdown): number {
  return (
    breakdown.inputTokens +
    breakdown.cachedInputTokens +
    breakdown.cacheWriteTokens +
    breakdown.outputTokens +
    breakdown.reasoningOutputTokens
  );
}

function makeFacetLabel(kind: 'provider' | 'product' | 'channel', value: string): string {
  if (kind === 'provider') {
    return ({
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
      github: 'GitHub',
      cursor: 'Cursor',
    } as Record<string, string>)[value] ?? value;
  }

  if (kind === 'product') {
    return ({
      'claude-code': 'Claude Code',
      codex: 'Codex',
      'copilot-cli': 'Copilot CLI',
      'copilot-vscode': 'Copilot VS Code',
      'gemini-cli': 'Gemini CLI',
      antigravity: 'Antigravity',
      cursor: 'Cursor',
      opencode: 'OpenCode',
      pi: 'Pi',
    } as Record<string, string>)[value] ?? value;
  }

  return ({
    cli: 'CLI',
    ide: 'IDE',
    web: 'Web',
    api: 'API',
  } as Record<string, string>)[value] ?? value;
}

function fmtModel(raw: string): string {
  if (!raw || raw === '<synthetic>') return 'Other';
  let model = raw.replace(/-\d{8}$/, '');
  model = model.replace(/(\d+)-(\d+)/g, '$1.$2');
  model = model.replace(/-/g, ' ');
  model = model.replace(/^claude\b/i, 'Claude');
  model = model.replace(/^gpt\s/i, 'GPT-');
  model = model.replace(/^o(\d)/i, 'O$1');
  model = model.replace(/(?<=\s)[a-z]/g, (char) => char.toUpperCase());
  return model;
}

interface AggregateEntry {
  estimatedCostUsd: number;
  eventCount: number;
}

async function main() {
  const lookbackDays = getLookbackDays();
  const requestedDates = buildTrailingDates(lookbackDays);
  const config = await readConfig();

  console.log(`Scanning ${lookbackDays} days...`);
  const results = await scanDates(requestedDates, { projectAliases: config.projectAliases });
  const warnings = new Set<string>();

  const dailyTrend: Array<{ usageDate: string; eventCount: number; estimatedCostUsd: number }> = [];
  const providerDailyTrendMap = new Map<string, number>();
  const tokenComposition: Array<{
    usageDate: string;
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  }> = [];
  const heatmap: Array<{ usageDate: string; totalTokens: number; estimatedCostUsd: number }> = [];

  const totals = {
    eventCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    estimatedCostUsd: 0,
  };

  const byModel = new Map<string, AggregateEntry>();
  const byChannel = new Map<string, AggregateEntry>();
  const providerFacets = new Map<string, AggregateEntry>();
  const productFacets = new Map<string, AggregateEntry>();
  const channelFacets = new Map<string, AggregateEntry>();
  const modelFacets = new Map<string, AggregateEntry>();
  const projectFacets = new Map<string, AggregateEntry>();
  const projectTokens = new Map<string, number>();
  const flowMap = new Map<string, number>();

  let activeDays = 0;

  for (const result of results) {
    let dayCost = 0;
    let dayTotalTokens = 0;

    for (const breakdown of result.breakdowns) {
      const estimatedCostUsd = calculateBreakdownCost(breakdown, warnings);
      const totalTokens = totalTokensOf(breakdown);
      const sourceKey = `${breakdown.provider}/${breakdown.product}|${breakdown.model}`;
      const providerDayKey = `${result.usageDate}|${breakdown.provider}`;
      const projectName = breakdown.project || 'Unknown';
      const flowKey = `${breakdown.model}\u2192${projectName}`;

      dayCost += estimatedCostUsd;
      dayTotalTokens += totalTokens;

      totals.eventCount += breakdown.eventCount;
      totals.inputTokens += breakdown.inputTokens;
      totals.cachedInputTokens += breakdown.cachedInputTokens;
      totals.cacheWriteTokens += breakdown.cacheWriteTokens;
      totals.outputTokens += breakdown.outputTokens;
      totals.reasoningOutputTokens += breakdown.reasoningOutputTokens;
      totals.estimatedCostUsd += estimatedCostUsd;

      byModel.set(sourceKey, {
        estimatedCostUsd: (byModel.get(sourceKey)?.estimatedCostUsd ?? 0) + estimatedCostUsd,
        eventCount: (byModel.get(sourceKey)?.eventCount ?? 0) + breakdown.eventCount,
      });

      byChannel.set(breakdown.channel, {
        estimatedCostUsd: (byChannel.get(breakdown.channel)?.estimatedCostUsd ?? 0) + estimatedCostUsd,
        eventCount: (byChannel.get(breakdown.channel)?.eventCount ?? 0) + breakdown.eventCount,
      });

      providerFacets.set(breakdown.provider, {
        estimatedCostUsd: (providerFacets.get(breakdown.provider)?.estimatedCostUsd ?? 0) + estimatedCostUsd,
        eventCount: (providerFacets.get(breakdown.provider)?.eventCount ?? 0) + breakdown.eventCount,
      });
      productFacets.set(breakdown.product, {
        estimatedCostUsd: (productFacets.get(breakdown.product)?.estimatedCostUsd ?? 0) + estimatedCostUsd,
        eventCount: (productFacets.get(breakdown.product)?.eventCount ?? 0) + breakdown.eventCount,
      });
      channelFacets.set(breakdown.channel, {
        estimatedCostUsd: (channelFacets.get(breakdown.channel)?.estimatedCostUsd ?? 0) + estimatedCostUsd,
        eventCount: (channelFacets.get(breakdown.channel)?.eventCount ?? 0) + breakdown.eventCount,
      });
      modelFacets.set(breakdown.model, {
        estimatedCostUsd: (modelFacets.get(breakdown.model)?.estimatedCostUsd ?? 0) + estimatedCostUsd,
        eventCount: (modelFacets.get(breakdown.model)?.eventCount ?? 0) + breakdown.eventCount,
      });
      projectFacets.set(projectName, {
        estimatedCostUsd: (projectFacets.get(projectName)?.estimatedCostUsd ?? 0) + estimatedCostUsd,
        eventCount: (projectFacets.get(projectName)?.eventCount ?? 0) + breakdown.eventCount,
      });

      providerDailyTrendMap.set(
        providerDayKey,
        (providerDailyTrendMap.get(providerDayKey) ?? 0) + estimatedCostUsd,
      );

      projectTokens.set(projectName, (projectTokens.get(projectName) ?? 0) + totalTokens);
      flowMap.set(flowKey, (flowMap.get(flowKey) ?? 0) + totalTokens);
    }

    const hasData = result.totals.eventCount > 0 || dayTotalTokens > 0 || dayCost > 0;
    if (hasData) activeDays += 1;

    dailyTrend.push({
      usageDate: result.usageDate,
      eventCount: result.totals.eventCount,
      estimatedCostUsd: roundUsd(dayCost),
    });

    tokenComposition.push({
      usageDate: result.usageDate,
      inputTokens: result.totals.inputTokens,
      cachedInputTokens: result.totals.cachedInputTokens,
      cacheWriteTokens: result.totals.cacheWriteTokens,
      outputTokens: result.totals.outputTokens,
      reasoningOutputTokens: result.totals.reasoningOutputTokens,
      totalTokens: dayTotalTokens,
    });

    heatmap.push({
      usageDate: result.usageDate,
      totalTokens: dayTotalTokens,
      estimatedCostUsd: roundUsd(dayCost),
    });
  }

  const providerDailyTrend = [...providerDailyTrendMap.entries()]
    .map(([key, estimatedCostUsd]) => {
      const [usageDate, provider] = key.split('|');
      return { usageDate, provider, estimatedCostUsd: roundUsd(estimatedCostUsd) };
    })
    .sort((a, b) => a.usageDate.localeCompare(b.usageDate) || a.provider.localeCompare(b.provider));

  const modelCostShare = [...byModel.entries()]
    .map(([key, summary]) => {
      const [, model] = key.split('|');
      return {
        value: model,
        label: model,
        estimatedCostUsd: roundUsd(summary.estimatedCostUsd),
        eventCount: summary.eventCount,
      };
    })
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.eventCount - a.eventCount);

  const channelCostShare = [...byChannel.entries()]
    .map(([value, summary]) => ({
      value,
      label: makeFacetLabel('channel', value),
      estimatedCostUsd: roundUsd(summary.estimatedCostUsd),
      eventCount: summary.eventCount,
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.eventCount - a.eventCount);

  const topProjectSet = new Set(
    [...projectTokens.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_PROJECTS)
      .map(([project]) => project),
  );

  const sankeyNodes: Array<{ id: string; label: string; layer: number; totalTokens: number }> = [];
  const nodeMap = new Map<string, { id: string; label: string; layer: number; totalTokens: number }>();
  const sankeyLinks = new Map<string, number>();

  for (const [key, value] of flowMap.entries()) {
    const [rawModel, rawProject] = key.split('\u2192');
    const project = topProjectSet.has(rawProject) ? rawProject : 'Other';
    const modelId = `model-${rawModel}`;
    const projectId = `project-${project}`;

    if (!nodeMap.has(modelId)) {
      const node = { id: modelId, label: fmtModel(rawModel), layer: 0, totalTokens: 0 };
      nodeMap.set(modelId, node);
      sankeyNodes.push(node);
    }
    if (!nodeMap.has(projectId)) {
      const node = { id: projectId, label: project, layer: 1, totalTokens: 0 };
      nodeMap.set(projectId, node);
      sankeyNodes.push(node);
    }

    nodeMap.get(modelId)!.totalTokens += value;
    sankeyLinks.set(`${modelId}\u2192${projectId}`, (sankeyLinks.get(`${modelId}\u2192${projectId}`) ?? 0) + value);
  }

  const overview = {
    ok: true,
    totalDays: requestedDates.length,
    activeDays,
    totalEvents: totals.eventCount,
    totalCostUsd: roundUsd(totals.estimatedCostUsd),
    averageDailyCostUsd: activeDays > 0 ? roundUsd(totals.estimatedCostUsd / activeDays) : 0,
    dailyTrend,
    providerDailyTrend,
    tokenComposition,
    modelCostShare,
    channelCostShare,
    sankey: {
      nodes: sankeyNodes,
      links: [...sankeyLinks.entries()].map(([key, value]) => {
        const [source, target] = key.split('\u2192');
        return { source, target, value };
      }),
    },
    heatmap,
    filters: {
      selection: {
        range: 'all',
        deviceId: null,
        provider: null,
        product: null,
        channel: null,
        model: null,
        project: null,
      },
      options: {
        devices: [{
          value: hostname(),
          label: hostname(),
          estimatedCostUsd: roundUsd(totals.estimatedCostUsd),
          eventCount: totals.eventCount,
        }],
        providers: [...providerFacets.entries()]
          .map(([value, summary]) => ({
            value,
            label: makeFacetLabel('provider', value),
            estimatedCostUsd: roundUsd(summary.estimatedCostUsd),
            eventCount: summary.eventCount,
          }))
          .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.eventCount - a.eventCount),
        products: [...productFacets.entries()]
          .map(([value, summary]) => ({
            value,
            label: makeFacetLabel('product', value),
            estimatedCostUsd: roundUsd(summary.estimatedCostUsd),
            eventCount: summary.eventCount,
          }))
          .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.eventCount - a.eventCount),
        channels: [...channelFacets.entries()]
          .map(([value, summary]) => ({
            value,
            label: makeFacetLabel('channel', value),
            estimatedCostUsd: roundUsd(summary.estimatedCostUsd),
            eventCount: summary.eventCount,
          }))
          .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.eventCount - a.eventCount),
        models: [...modelFacets.entries()]
          .map(([value, summary]) => ({
            value,
            label: value,
            estimatedCostUsd: roundUsd(summary.estimatedCostUsd),
            eventCount: summary.eventCount,
          }))
          .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.eventCount - a.eventCount),
        projects: [...projectFacets.entries()]
          .map(([value, summary]) => ({
            value,
            label: value,
            estimatedCostUsd: roundUsd(summary.estimatedCostUsd),
            eventCount: summary.eventCount,
          }))
          .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.eventCount - a.eventCount),
      },
    },
  };

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
  console.log(`Written ${OUT} (${activeDays}/${lookbackDays} active days, $${roundUsd(totals.estimatedCostUsd).toFixed(2)} total)`);
  if (warnings.size > 0) {
    console.log(`Pricing warnings: ${warnings.size}`);
  }
}

await main();
