import { jsonError, jsonOk } from '../utils/response.js';
import { toPublicProjectName } from '../utils/privacy.js';
import type { Env } from '../types.js';

const TOTAL_TOKENS_SQL = `
  COALESCE(b.input_tokens, 0) +
  COALESCE(b.cached_input_tokens, 0) +
  COALESCE(b.cache_write_tokens, 0) +
  COALESCE(b.output_tokens, 0) +
  COALESCE(b.reasoning_output_tokens, 0)
`;

type FilterKey = 'deviceId' | 'provider' | 'product' | 'channel' | 'model' | 'project';

interface DashboardFilters {
  minDate: string | null;
  range: string;
  deviceId: string | null;
  provider: string | null;
  product: string | null;
  channel: string | null;
  model: string | null;
  project: string | null;
}

interface WhereParts {
  whereClause: string;
  params: (string | number)[];
}

interface FacetItem {
  value: string;
  label: string;
  estimatedCostUsd: number;
  eventCount: number;
}

export async function handleOverview(url: URL, env: Env): Promise<Response> {
  const filters = parseFilters(url);
  if (!filters) return jsonError(400, 'INVALID_PAYLOAD', 'Invalid range parameter', true);

  const where = buildWhere(filters);

  const [
    summary,
    trendRows,
    tokenRows,
    modelRows,
    channelRows,
    flowRows,
    devices,
    providers,
    products,
    channels,
    models,
    projects,
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(DISTINCT b.usage_date) AS active_days,
        COALESCE(SUM(b.event_count), 0) AS total_events,
        COALESCE(SUM(b.estimated_cost_usd), 0) AS total_cost_usd
      FROM daily_usage_breakdown b
      ${where.whereClause}
    `).bind(...where.params).first<{
      active_days: number;
      total_events: number;
      total_cost_usd: number;
    }>(),
    env.DB.prepare(`
      SELECT
        b.usage_date,
        COALESCE(SUM(b.event_count), 0) AS event_count,
        COALESCE(SUM(b.estimated_cost_usd), 0) AS estimated_cost_usd
      FROM daily_usage_breakdown b
      ${where.whereClause}
      GROUP BY b.usage_date
      ORDER BY b.usage_date
    `).bind(...where.params).all<{
      usage_date: string;
      event_count: number;
      estimated_cost_usd: number;
    }>(),
    env.DB.prepare(`
      SELECT
        b.usage_date,
        COALESCE(SUM(b.input_tokens), 0) AS input_tokens,
        COALESCE(SUM(b.cached_input_tokens), 0) AS cached_input_tokens,
        COALESCE(SUM(b.cache_write_tokens), 0) AS cache_write_tokens,
        COALESCE(SUM(b.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(b.reasoning_output_tokens), 0) AS reasoning_output_tokens
      FROM daily_usage_breakdown b
      ${where.whereClause}
      GROUP BY b.usage_date
      ORDER BY b.usage_date
    `).bind(...where.params).all<{
      usage_date: string;
      input_tokens: number;
      cached_input_tokens: number;
      cache_write_tokens: number;
      output_tokens: number;
      reasoning_output_tokens: number;
    }>(),
    env.DB.prepare(`
      SELECT
        b.model AS value,
        COALESCE(SUM(b.estimated_cost_usd), 0) AS estimated_cost_usd,
        COALESCE(SUM(b.event_count), 0) AS event_count
      FROM daily_usage_breakdown b
      ${where.whereClause}
      GROUP BY b.model
      HAVING b.model IS NOT NULL AND b.model != ''
      ORDER BY estimated_cost_usd DESC, value ASC
    `).bind(...where.params).all<{
      value: string;
      estimated_cost_usd: number;
      event_count: number;
    }>(),
    env.DB.prepare(`
      SELECT
        b.channel AS value,
        COALESCE(SUM(b.estimated_cost_usd), 0) AS estimated_cost_usd,
        COALESCE(SUM(b.event_count), 0) AS event_count
      FROM daily_usage_breakdown b
      ${where.whereClause}
      GROUP BY b.channel
      HAVING b.channel IS NOT NULL AND b.channel != ''
      ORDER BY estimated_cost_usd DESC, value ASC
    `).bind(...where.params).all<{
      value: string;
      estimated_cost_usd: number;
      event_count: number;
    }>(),
    env.DB.prepare(`
      SELECT
        b.provider,
        b.product,
        b.channel,
        COALESCE(SUM(${TOTAL_TOKENS_SQL}), 0) AS total_tokens
      FROM daily_usage_breakdown b
      ${where.whereClause}
      GROUP BY b.provider, b.product, b.channel
      HAVING COALESCE(SUM(${TOTAL_TOKENS_SQL}), 0) > 0
      ORDER BY total_tokens DESC, b.provider ASC, b.product ASC, b.channel ASC
    `).bind(...where.params).all<{
      provider: string;
      product: string;
      channel: string;
      total_tokens: number;
    }>(),
    loadFacetOptions('device_id', filters, env),
    loadFacetOptions('provider', filters, env),
    loadFacetOptions('product', filters, env),
    loadFacetOptions('channel', filters, env),
    loadFacetOptions('model', filters, env),
    loadFacetOptions('project', filters, env),
  ]);

  const activeDays = Number(summary?.active_days ?? 0);
  const totalEvents = Number(summary?.total_events ?? 0);
  const totalCostUsd = roundUsd(summary?.total_cost_usd ?? 0);

  return jsonOk({
    totalDays: activeDays,
    activeDays,
    totalEvents,
    totalCostUsd,
    averageDailyCostUsd: activeDays > 0 ? roundUsd(totalCostUsd / activeDays) : 0,
    dailyTrend: (trendRows.results ?? []).map(row => ({
      usageDate: row.usage_date,
      eventCount: Number(row.event_count ?? 0),
      estimatedCostUsd: roundUsd(row.estimated_cost_usd ?? 0),
    })),
    tokenComposition: (tokenRows.results ?? []).map(row => ({
      usageDate: row.usage_date,
      inputTokens: Number(row.input_tokens ?? 0),
      cachedInputTokens: Number(row.cached_input_tokens ?? 0),
      cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      reasoningOutputTokens: Number(row.reasoning_output_tokens ?? 0),
      totalTokens:
        Number(row.input_tokens ?? 0) +
        Number(row.cached_input_tokens ?? 0) +
        Number(row.cache_write_tokens ?? 0) +
        Number(row.output_tokens ?? 0) +
        Number(row.reasoning_output_tokens ?? 0),
    })),
    modelCostShare: (modelRows.results ?? []).map(row => ({
      value: row.value,
      label: row.value,
      estimatedCostUsd: roundUsd(row.estimated_cost_usd ?? 0),
      eventCount: Number(row.event_count ?? 0),
    })),
    channelCostShare: (channelRows.results ?? []).map(row => ({
      value: row.value,
      label: row.value,
      estimatedCostUsd: roundUsd(row.estimated_cost_usd ?? 0),
      eventCount: Number(row.event_count ?? 0),
    })),
    sankey: buildSankey(flowRows.results ?? []),
    filters: {
      selection: {
        range: filters.range,
        deviceId: filters.deviceId,
        provider: filters.provider,
        product: filters.product,
        channel: filters.channel,
        model: filters.model,
        project: filters.project,
      },
      options: {
        devices,
        providers,
        products,
        channels,
        models,
        projects,
      },
    },
  }, true);
}

function parseFilters(url: URL): DashboardFilters | null {
  const range = readTextParam(url, 'range') ?? '30d';
  const minDate = buildMinDate(range);
  if (minDate === undefined) return null;

  return {
    minDate,
    range,
    deviceId: readTextParam(url, 'deviceId'),
    provider: readTextParam(url, 'provider'),
    product: readTextParam(url, 'product'),
    channel: readTextParam(url, 'channel'),
    model: readTextParam(url, 'model'),
    project: readTextParam(url, 'project'),
  };
}

function readTextParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key);
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function buildWhere(filters: DashboardFilters, omit?: FilterKey): WhereParts {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.minDate) {
    clauses.push('b.usage_date >= ?');
    params.push(filters.minDate);
  }
  if (filters.deviceId && omit !== 'deviceId') {
    clauses.push('b.device_id = ?');
    params.push(filters.deviceId);
  }
  if (filters.provider && omit !== 'provider') {
    clauses.push('b.provider = ?');
    params.push(filters.provider);
  }
  if (filters.product && omit !== 'product') {
    clauses.push('b.product = ?');
    params.push(filters.product);
  }
  if (filters.channel && omit !== 'channel') {
    clauses.push('b.channel = ?');
    params.push(filters.channel);
  }
  if (filters.model && omit !== 'model') {
    clauses.push('b.model = ?');
    params.push(filters.model);
  }
  if (filters.project && omit !== 'project') {
    clauses.push('b.project = ?');
    params.push(filters.project);
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

async function loadFacetOptions(column: string, filters: DashboardFilters, env: Env): Promise<FacetItem[]> {
  const omit = toFilterKey(column);
  const where = buildWhere(filters, omit);
  const rows = await env.DB.prepare(`
    SELECT
      b.${column} AS value,
      COALESCE(SUM(b.estimated_cost_usd), 0) AS estimated_cost_usd,
      COALESCE(SUM(b.event_count), 0) AS event_count
    FROM daily_usage_breakdown b
    ${where.whereClause}
    GROUP BY b.${column}
    HAVING b.${column} IS NOT NULL AND b.${column} != ''
    ORDER BY estimated_cost_usd DESC, value ASC
    LIMIT 80
  `).bind(...where.params).all<{
    value: string;
    estimated_cost_usd: number;
    event_count: number;
  }>();

  return Promise.all((rows.results ?? []).map(async row => ({
    value: row.value,
    label: column === 'project' ? await toPublicProjectName(row.value, env) : row.value,
    estimatedCostUsd: roundUsd(row.estimated_cost_usd ?? 0),
    eventCount: Number(row.event_count ?? 0),
  })));
}

function toFilterKey(column: string): FilterKey {
  if (column === 'device_id') return 'deviceId';
  return column as FilterKey;
}

function buildSankey(rows: Array<{
  provider: string;
  product: string;
  channel: string;
  total_tokens: number;
}>): {
  nodes: Array<{ id: string; label: string; layer: number; totalTokens: number }>;
  links: Array<{ source: string; target: string; value: number }>;
} {
  const providerTotals = new Map<string, number>();
  const productTotals = new Map<string, number>();
  const channelTotals = new Map<string, number>();
  const leftLinks = new Map<string, number>();
  const rightLinks = new Map<string, number>();

  for (const row of rows) {
    const value = Number(row.total_tokens ?? 0);
    if (!value) continue;

    providerTotals.set(row.provider, (providerTotals.get(row.provider) ?? 0) + value);
    productTotals.set(row.product, (productTotals.get(row.product) ?? 0) + value);
    channelTotals.set(row.channel, (channelTotals.get(row.channel) ?? 0) + value);

    const leftKey = `${row.provider}\u0000${row.product}`;
    const rightKey = `${row.product}\u0000${row.channel}`;
    leftLinks.set(leftKey, (leftLinks.get(leftKey) ?? 0) + value);
    rightLinks.set(rightKey, (rightLinks.get(rightKey) ?? 0) + value);
  }

  const nodes = [
    ...sortedNodeEntries(providerTotals).map(([label, totalTokens]) => ({
      id: `provider:${label}`,
      label,
      layer: 0,
      totalTokens,
    })),
    ...sortedNodeEntries(productTotals).map(([label, totalTokens]) => ({
      id: `product:${label}`,
      label,
      layer: 1,
      totalTokens,
    })),
    ...sortedNodeEntries(channelTotals).map(([label, totalTokens]) => ({
      id: `channel:${label}`,
      label,
      layer: 2,
      totalTokens,
    })),
  ];

  const links = [
    ...sortedLinkEntries(leftLinks).map(([key, value]) => {
      const [provider, product] = key.split('\u0000');
      return {
        source: `provider:${provider}`,
        target: `product:${product}`,
        value,
      };
    }),
    ...sortedLinkEntries(rightLinks).map(([key, value]) => {
      const [product, channel] = key.split('\u0000');
      return {
        source: `product:${product}`,
        target: `channel:${channel}`,
        value,
      };
    }),
  ];

  return { nodes, links };
}

function sortedNodeEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], 'zh-CN');
  });
}

function sortedLinkEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function roundUsd(value: number): number {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function buildMinDate(range: string): string | null | undefined {
  if (range === 'all') return null;

  const now = new Date();
  let days: number;
  if (range === '7d') days = 7;
  else if (range === '30d') days = 30;
  else if (range === '3m' || range === '90d') days = 90;
  else return undefined;

  const min = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return min.toISOString().split('T')[0];
}
