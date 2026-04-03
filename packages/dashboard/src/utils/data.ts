import type { SankeyGraph } from '@aiusage/shared';
import type { OverviewPayload, FiltersState } from '../hooks/use-overview';
import { arrSum } from './format';
import { providerLabel } from '../constants';

/** Get all YYYY-MM-DD dates for the current month (1st to last day). */
export function currentMonthDates(): string[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const result: string[] = [];
  for (let d = 1; d <= last; d++) {
    result.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return result;
}

/** Filter overview data to current month and pad remaining days with zeros. */
export function padMonth(ov: OverviewPayload): OverviewPayload {
  const allDates = currentMonthDates();

  const trendMap = new Map(ov.dailyTrend.map((d) => [d.usageDate, d]));
  const compMap = new Map(ov.tokenComposition.map((d) => [d.usageDate, d]));

  const dailyTrend = allDates.map((date) => trendMap.get(date) ?? { usageDate: date, eventCount: 0, estimatedCostUsd: 0 });
  const tokenComposition = allDates.map((date) => compMap.get(date) ?? {
    usageDate: date, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0,
    outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0,
  });

  const monthTrend = dailyTrend.filter((d) => d.estimatedCostUsd > 0);
  const totalCostUsd = arrSum(monthTrend.map((d) => d.estimatedCostUsd));
  const totalEvents = arrSum(monthTrend.map((d) => d.eventCount));
  const activeDays = monthTrend.length;

  // Scale share/sankey data by cost ratio (month vs full range)
  const ratio = ov.totalCostUsd > 0 ? totalCostUsd / ov.totalCostUsd : 0;
  const eventRatio = ov.totalEvents > 0 ? totalEvents / ov.totalEvents : 0;

  function scaleShares<T extends { estimatedCostUsd: number; eventCount: number }>(items: T[]): T[] {
    return items.map((it) => ({
      ...it,
      estimatedCostUsd: +(it.estimatedCostUsd * ratio).toFixed(4),
      eventCount: Math.round(it.eventCount * eventRatio),
    }));
  }

  const sankey = ov.sankey.nodes.length ? {
    nodes: ov.sankey.nodes.map((n) => ({ ...n, totalTokens: Math.round(n.totalTokens * ratio) })),
    links: ov.sankey.links.map((l) => ({ ...l, value: Math.round(l.value * ratio) })),
  } : ov.sankey;

  // Filter provider daily trend to current month
  const monthDateSet = new Set(allDates);
  const providerDailyTrend = (ov.providerDailyTrend ?? []).filter(
    (item) => monthDateSet.has(item.usageDate),
  );

  return {
    ...ov,
    totalDays: allDates.length,
    activeDays,
    totalEvents,
    totalCostUsd,
    averageDailyCostUsd: activeDays > 0 ? totalCostUsd / activeDays : 0,
    dailyTrend,
    providerDailyTrend,
    tokenComposition,
    modelCostShare: scaleShares(ov.modelCostShare),
    channelCostShare: scaleShares(ov.channelCostShare),
    sankey,
    filters: {
      ...ov.filters,
      options: {
        ...ov.filters.options,
        providers: scaleShares(ov.filters.options.providers),
      },
    },
  };
}

export function buildQuery(f: FiltersState): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (!v) continue;
    // "month" is frontend-only; request 30d from API
    p.set(k, k === 'range' && v === 'month' ? '30d' : v);
  }
  return p.toString();
}

export function transformSankey(input?: SankeyGraph) {
  if (!input?.nodes.length || !input?.links.length) return null;

  // Fold small target nodes into "Other" if too many
  const MAX_TARGETS = 8;
  const targetIds = new Set(input.links.map((l) => l.target));
  const sourceIds = new Set(input.links.map((l) => l.source));
  const pureTargets = [...targetIds].filter((id) => !sourceIds.has(id));

  let nodes = input.nodes;
  let links = input.links;

  if (pureTargets.length > MAX_TARGETS) {
    const targetVolume = new Map<string, number>();
    for (const l of links) {
      if (pureTargets.includes(l.target)) {
        targetVolume.set(l.target, (targetVolume.get(l.target) || 0) + Number(l.value || 0));
      }
    }
    const sorted = [...targetVolume.entries()].sort((a, b) => b[1] - a[1]);
    const keepSet = new Set(sorted.slice(0, MAX_TARGETS - 1).map(([id]) => id));
    const otherId = '__other__';

    nodes = [
      ...input.nodes.filter((n) => !pureTargets.includes(n.id) || keepSet.has(n.id)),
      { id: otherId, label: 'Other', layer: Math.max(...input.nodes.map((n) => n.layer)), totalTokens: 0 },
    ];
    links = input.links.map((l) =>
      pureTargets.includes(l.target) && !keepSet.has(l.target)
        ? { ...l, target: otherId }
        : l,
    );
  }

  const nodeList = nodes.map((n) => ({
    name: n.id.startsWith('provider:') ? providerLabel(n.label || n.id) : (n.label || n.id),
  }));
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));

  // Merge duplicate links (same source→target after folding)
  const merged = new Map<string, { source: number; target: number; value: number }>();
  for (const l of links) {
    const si = idToIdx.get(l.source);
    const ti = idToIdx.get(l.target);
    if (si === undefined || ti === undefined || Number(l.value || 0) <= 0) continue;
    const key = `${si}-${ti}`;
    const prev = merged.get(key);
    if (prev) prev.value += Number(l.value);
    else merged.set(key, { source: si, target: ti, value: Number(l.value) });
  }

  const finalLinks = [...merged.values()];
  return finalLinks.length ? { nodes: nodeList, links: finalLinks } : null;
}

export function pivotProviderTrend(
  dailyTrend: OverviewPayload['dailyTrend'],
  providerTrend: OverviewPayload['providerDailyTrend'],
): { data: Record<string, unknown>[]; providers: string[] } {
  const providerSet = new Set<string>();
  const dateMap = new Map<string, Record<string, number>>();

  for (const r of providerTrend ?? []) {
    providerSet.add(r.provider);
    const existing = dateMap.get(r.usageDate) ?? {};
    existing[r.provider] = r.estimatedCostUsd;
    dateMap.set(r.usageDate, existing);
  }

  const providers = [...providerSet];
  const data = dailyTrend.map((d) => ({
    usageDate: d.usageDate,
    ...Object.fromEntries(providers.map((p) => [p, dateMap.get(d.usageDate)?.[p] ?? 0])),
  }));

  return { data, providers };
}
