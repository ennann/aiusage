import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  Sankey, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from 'recharts';
import { RotateCw, SlidersHorizontal, Github, Heart } from 'lucide-react';
import type { OverviewResponse, SankeyGraph } from '@aiusage/shared';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from './components/ui/chart';
import { DEMO_OVERVIEW, DEMO_HEALTH } from './demo-data';

// ────────────────────────────────────────
// Constants
// ────────────────────────────────────────

const RANGES = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
] as const;

const TOKEN_SERIES = [
  { key: 'inputTokens' as const, label: 'Input', color: '#0f172a' },
  { key: 'cachedInputTokens' as const, label: 'Cached', color: '#334155' },
  { key: 'cacheWriteTokens' as const, label: 'Cache Write', color: '#64748b' },
  { key: 'outputTokens' as const, label: 'Output', color: '#94a3b8' },
  { key: 'reasoningOutputTokens' as const, label: 'Reasoning', color: '#cbd5e1' },
];

const CHART_COLORS = [
  '#0f172a', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0',
];

const COST_CONFIG = {
  estimatedCostUsd: { label: 'Cost', color: '#0f172a' },
} satisfies ChartConfig;

const TOKEN_CONFIG = Object.fromEntries(
  TOKEN_SERIES.map((s) => [s.key, { label: s.label, color: s.color }]),
) satisfies ChartConfig;

// ────────────────────────────────────────
// Types
// ────────────────────────────────────────

interface FiltersState {
  range: string;
  deviceId: string;
  provider: string;
  product: string;
  channel: string;
  model: string;
}

interface HealthPayload { ok: boolean; siteId: string; version: string }
interface OverviewPayload extends OverviewResponse { ok: boolean }
interface FacetOption { value: string; label: string }

// ────────────────────────────────────────
// Utilities
// ────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error('Response is not JSON');
  }
  return r.json() as Promise<T>;
}

function formatUsd(v: number): string {
  const n = Number(v || 0);
  if (n >= 100) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 10) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdFull(v: number): string {
  return `$${Number(v || 0).toFixed(4)}`;
}

function formatCompact(v: number): string {
  const n = Number(v || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatNumber(v: number): string {
  return new Intl.NumberFormat('en-US').format(Number(v || 0));
}

function formatPercent(v: number): string {
  return `${Number(v || 0).toFixed(1)}%`;
}

function formatModelName(raw: string): string {
  if (!raw || raw === '<synthetic>') return 'Other';
  let s = raw.replace(/-\d{8}$/, '');          // strip date suffix
  s = s.replace(/(\d+)-(\d+)/g, '$1.$2');      // version: 4-6 → 4.6
  s = s.replace(/-/g, ' ');                     // dashes → spaces
  s = s.replace(/^claude\b/i, 'Claude');
  s = s.replace(/^gpt\s/i, 'GPT-');            // keep GPT- brand dash
  s = s.replace(/^o(\d)/i, 'O$1');
  s = s.replace(/(?<=\s)[a-z]/g, (c) => c.toUpperCase());
  return s;
}

/** Get all YYYY-MM-DD dates for the current month (1st to last day). */
function currentMonthDates(): string[] {
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

function shortDate(v: string): string { return v.slice(5); }

function longDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Filter overview data to current month and pad remaining days with zeros. */
function padMonth(ov: OverviewPayload): OverviewPayload {
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

  return {
    ...ov,
    totalDays: allDates.length,
    activeDays,
    totalEvents,
    totalCostUsd,
    averageDailyCostUsd: activeDays > 0 ? totalCostUsd / activeDays : 0,
    dailyTrend,
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

function buildQuery(f: FiltersState): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (!v) continue;
    // "month" is frontend-only; request 30d from API
    p.set(k, k === 'range' && v === 'month' ? '30d' : v);
  }
  return p.toString();
}

function arrSum(arr: number[]): number {
  return arr.reduce((a, b) => a + Number(b || 0), 0);
}

function foldItems<T extends { estimatedCostUsd: number; label: string; value: string }>(
  items: T[],
  limit: number,
): T[] {
  if (items.length <= limit) return items;
  const head = items.slice(0, limit - 1);
  const tail = items.slice(limit - 1);
  const other = tail.reduce(
    (acc, it) => ({ ...acc, estimatedCostUsd: acc.estimatedCostUsd + Number(it.estimatedCostUsd || 0) }),
    { ...tail[0], value: 'other', label: 'Other', estimatedCostUsd: 0 },
  );
  return [...head, other];
}

function transformSankey(input?: SankeyGraph) {
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

  const nodeList = nodes.map((n) => ({ name: n.label || n.id }));
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

// ────────────────────────────────────────
// Primitives
// ────────────────────────────────────────

class ChartBoundary extends React.Component<
  { children: React.ReactNode; name: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; name: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) { console.error(`Chart [${this.props.name}]:`, err); }
  render() {
    if (this.state.hasError) {
      return <EmptyState label={`${this.props.name} failed to render`} />;
    }
    return this.props.children;
  }
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center text-[13px] text-slate-300">
      {label}
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
}

// ────────────────────────────────────────
// Controls
// ────────────────────────────────────────

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-slate-100/80 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterPopover({
  filters,
  options,
  onChange,
}: {
  filters: FiltersState;
  options: { devices: FacetOption[]; providers: FacetOption[]; products: FacetOption[]; channels: FacetOption[]; models: FacetOption[] };
  onChange: (patch: Partial<FiltersState>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeCount = [
    filters.deviceId, filters.provider, filters.product, filters.channel, filters.model,
  ].filter(Boolean).length;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dims = [
    { key: 'deviceId' as const, label: 'Device', opts: options.devices },
    { key: 'provider' as const, label: 'Provider', opts: options.providers },
    { key: 'product' as const, label: 'Product', opts: options.products },
    { key: 'channel' as const, label: 'Channel', opts: options.channels },
    { key: 'model' as const, label: 'Model', opts: options.models },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
          open || activeCount > 0
            ? 'bg-slate-900 text-white'
            : 'bg-slate-100/80 text-slate-500 hover:text-slate-700'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>Filters</span>
        {activeCount > 0 && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-semibold">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[300px] rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
          <div className="mb-3.5 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-900">Filters</span>
            {activeCount > 0 && (
              <button
                className="text-[12px] text-slate-400 transition-colors hover:text-slate-600"
                onClick={() => onChange({ deviceId: '', provider: '', product: '', channel: '', model: '' })}
              >
                Clear all
              </button>
            )}
          </div>
          <div className="grid gap-3">
            {dims.map((d) => (
              <div key={d.key}>
                <label className="mb-1 block text-[11px] font-medium tracking-wide text-slate-400">
                  {d.label}
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 outline-none transition-colors focus:border-slate-300"
                  value={filters[d.key]}
                  onChange={(e) => onChange({ [d.key]: e.target.value })}
                >
                  <option value="">All</option>
                  {d.opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// KPI
// ────────────────────────────────────────

function KpiCard({
  label,
  value,
  highlight = false,
  suffix,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  suffix?: string;
}) {
  return (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">
        {label}
      </div>
      <div
        className={`mt-1.5 text-[22px] font-semibold tracking-tight tabular-nums leading-none ${
          highlight ? 'text-emerald-600' : 'text-slate-900'
        }`}
      >
        {value}
        {suffix && <span className="text-slate-300">{suffix}</span>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// Section Header
// ────────────────────────────────────────

function SectionHeader({ title, stat }: { title: string; stat?: string }) {
  return (
    <div className="mb-5 flex items-baseline justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
      {stat && (
        <span className="text-[14px] font-semibold tabular-nums text-slate-900">{stat}</span>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// Chart Legend
// ────────────────────────────────────────

function ChartLegend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5 text-[12px]">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: it.color }} />
          <span className="text-slate-500">{it.label}</span>
          {it.value && <span className="ml-0.5 font-medium tabular-nums text-slate-700">{it.value}</span>}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────
// Charts
// ────────────────────────────────────────

function CostTrendChart({ data }: { data: OverviewPayload['dailyTrend'] }) {
  if (!data.length) return <EmptyState label="No data" />;
  return (
    <ChartContainer config={COST_CONFIG} className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, left: 4, right: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="cost-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f172a" stopOpacity={0.2} />
              <stop offset="60%" stopColor="#0f172a" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="usageDate" tickLine={false} axisLine={false}
            tickMargin={12} tickFormatter={shortDate} minTickGap={36}
            stroke="#94a3b8" fontSize={11}
          />
          <YAxis
            tickLine={false} axisLine={false} width={48} tickMargin={8}
            tickFormatter={(v) => formatUsd(Number(v))} stroke="#94a3b8" fontSize={11}
          />
          <ChartTooltip
            cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={longDate}
                formatter={(v) => formatUsdFull(Number(v))}
              />
            }
          />
          <Area
            dataKey="estimatedCostUsd" type="natural"
            fill="url(#cost-fill)" stroke="#0f172a" strokeWidth={2}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#0f172a' }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function TokenTrendChart({ data }: { data: OverviewPayload['tokenComposition'] }) {
  if (!data.length) return <EmptyState label="No data" />;
  return (
    <ChartContainer config={TOKEN_CONFIG} className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, left: 4, right: 12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="usageDate" tickLine={false} axisLine={false}
            tickMargin={12} tickFormatter={shortDate} minTickGap={36}
            stroke="#94a3b8" fontSize={11}
          />
          <YAxis
            tickLine={false} axisLine={false} width={52} tickMargin={8}
            tickFormatter={(v) => formatCompact(Number(v))} stroke="#94a3b8" fontSize={11}
          />
          <ChartTooltip
            cursor={{ stroke: '#e2e8f0' }}
            content={
              <ChartTooltipContent
                labelFormatter={longDate}
                formatter={(v) => formatNumber(Number(v))}
              />
            }
          />
          {TOKEN_SERIES.map((s) => (
            <Area
              key={s.key} dataKey={s.key} type="monotone" stackId="tok"
              fill={s.color} fillOpacity={0.85} stroke={s.color} strokeWidth={0.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function TokenCompositionChart({ data }: { data: OverviewPayload['tokenComposition'] }) {
  if (!data.length) return <EmptyState label="No data" />;
  const barW = data.length <= 7 ? 28 : data.length <= 30 ? 14 : 6;
  return (
    <ChartContainer config={TOKEN_CONFIG} className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, left: 4, right: 12, bottom: 0 }} barSize={barW}>
          <CartesianGrid vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="usageDate" tickLine={false} axisLine={false}
            tickMargin={12} tickFormatter={shortDate} minTickGap={36}
            stroke="#94a3b8" fontSize={11}
          />
          <YAxis
            tickLine={false} axisLine={false} width={52} tickMargin={8}
            tickFormatter={(v) => formatCompact(Number(v))} stroke="#94a3b8" fontSize={11}
          />
          <ChartTooltip
            cursor={{ fill: '#f8fafc' }}
            content={
              <ChartTooltipContent
                labelFormatter={longDate}
                formatter={(v) => formatNumber(Number(v))}
              />
            }
          />
          {TOKEN_SERIES.map((s, i) => (
            <Bar
              key={s.key} dataKey={s.key} stackId="tok" fill={s.color}
              radius={i === TOKEN_SERIES.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function SankeyNodeLabel({
  x, y, width, height, payload,
}: {
  x: number; y: number; width: number; height: number;
  payload: { name: string };
}) {
  const isLeft = x < 200;
  return (
    <text
      x={isLeft ? x + width + 8 : x - 8}
      y={y + height / 2}
      textAnchor={isLeft ? 'start' : 'end'}
      dominantBaseline="central"
      className="fill-slate-600 text-[11px]"
    >
      {payload.name}
    </text>
  );
}

function FlowChart({ data }: { data?: SankeyGraph }) {
  const sankeyData = transformSankey(data);
  if (!sankeyData) return <EmptyState label="No flow data" />;
  const nodeCount = sankeyData.nodes.length;
  const height = Math.max(320, nodeCount * 36);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={sankeyData}
          nodePadding={24}
          nodeWidth={8}
          margin={{ left: 0, right: 0, top: 8, bottom: 8 }}
          link={{ stroke: '#94a3b8', strokeOpacity: 0.3, fill: 'none' }}
          node={<SankeyNodeLabel x={0} y={0} width={0} height={0} payload={{ name: '' }} />}
        >
          <Tooltip
            wrapperClassName="!rounded-xl !border-slate-200/90 !bg-white/96 !shadow-[0_12px_40px_rgba(0,0,0,0.08)] !backdrop-blur"
            cursor={false}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

function ProviderBars({
  data,
}: {
  data: Array<{ label: string; estimatedCostUsd: number }>;
}) {
  if (!data.length) return <EmptyState label="No data" />;
  const max = Math.max(...data.map((d) => d.estimatedCostUsd), 1);
  return (
    <div>
      <h3 className="mb-4 text-[13px] font-semibold text-slate-900">Provider Share</h3>
      <div className="flex flex-col gap-3">
        {data.map((item) => {
          const pct = (item.estimatedCostUsd / max) * 100;
          return (
            <div key={item.label}>
              <div className="mb-1 flex items-baseline justify-between text-[12px]">
                <span className="font-medium text-slate-700">{item.label}</span>
                <span className="tabular-nums font-medium text-slate-900">{formatUsd(item.estimatedCostUsd)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-800 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DonutSection({
  title,
  data,
  colors,
  centerLabel,
}: {
  title: string;
  data: Array<{ label: string; value: string; estimatedCostUsd: number; eventCount: number }>;
  colors: string[];
  centerLabel: string;
}) {
  const sorted = [...data].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  const folded = foldItems(sorted, 6);
  const total = arrSum(folded.map((d) => d.estimatedCostUsd));
  if (!folded.length) return <EmptyState label="No data" />;

  return (
    <div>
      <h3 className="mb-4 text-[13px] font-semibold text-slate-900">{title}</h3>
      <div className="flex items-center gap-5">
        {/* Ring */}
        <div className="relative shrink-0">
          <ChartContainer config={{}} className="h-[130px] w-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={folded} dataKey="estimatedCostUsd" nameKey="label"
                  innerRadius="62%" outerRadius="86%" paddingAngle={2} stroke="none"
                >
                  {folded.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                </Pie>
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => formatUsdFull(Number(v))} />}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-[13px] font-semibold tabular-nums text-slate-900">{centerLabel}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {folded.map((item, i) => {
            const pct = total > 0 ? (item.estimatedCostUsd / total) * 100 : 0;
            return (
              <div key={item.value} className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: colors[i % colors.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-slate-500">{item.label}</span>
                <span className="shrink-0 tabular-nums text-slate-400">{formatPercent(pct)}</span>
                <span className="shrink-0 font-medium tabular-nums text-slate-900">
                  {formatUsd(item.estimatedCostUsd)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// App
// ────────────────────────────────────────

export function App() {
  const [filters, setFilters] = useState<FiltersState>({
    range: '30d', deviceId: '', provider: '', product: '', channel: '', model: '',
  });
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [isDemo, setIsDemo] = useState(false);

  // Fetch data — falls back to demo data when API is unreachable (local dev)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [ov, hp] = await Promise.all([
          fetchJson<OverviewPayload>(`/api/v1/public/overview?${buildQuery(filters)}`),
          fetchJson<HealthPayload>('/api/v1/health').catch(
            () => ({ ok: false, siteId: 'unknown', version: 'unknown' }),
          ),
        ]);
        if (cancelled) return;
        setOverview(filters.range === 'month' ? padMonth(ov) : ov);
        setHealth(hp);
        setIsDemo(false);
      } catch {
        if (cancelled) return;
        const demo = filters.range === 'month' ? padMonth(DEMO_OVERVIEW) : DEMO_OVERVIEW;
        setOverview(demo);
        setHealth(DEMO_HEALTH);
        setIsDemo(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters, tick]);

  // Derived KPIs
  const kpis = useMemo(() => {
    if (!overview) return null;
    const tc = overview.tokenComposition;
    const totalTokens = arrSum(tc.map((d) => d.totalTokens));
    const inputTokens = arrSum(tc.map((d) => d.inputTokens));
    const outputTokens = arrSum(tc.map((d) => d.outputTokens + d.reasoningOutputTokens));
    const cachedTokens = arrSum(tc.map((d) => d.cachedInputTokens));
    const denominator = inputTokens + cachedTokens;
    const cacheHitRate = denominator > 0 ? (cachedTokens / denominator) * 100 : 0;
    const costPerSession = overview.totalEvents > 0
      ? overview.totalCostUsd / overview.totalEvents : 0;
    return { totalTokens, inputTokens, outputTokens, cachedTokens, cacheHitRate, costPerSession };
  }, [overview]);

  // Filter options
  const fOpts = useMemo(() => ({
    devices: overview?.filters.options.devices ?? [],
    providers: overview?.filters.options.providers ?? [],
    products: overview?.filters.options.products ?? [],
    channels: overview?.filters.options.channels ?? [],
    models: (overview?.filters.options.models ?? []).map((m) => ({ ...m, label: formatModelName(m.label) })),
  }), [overview]);

  // Token legend
  const tokenLegend = useMemo(() => {
    if (!overview) return [];
    const tc = overview.tokenComposition;
    return TOKEN_SERIES.map((s) => ({
      label: s.label,
      color: s.color,
      value: formatCompact(arrSum(tc.map((d) => Number(d[s.key] || 0)))),
    }));
  }, [overview]);

  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6 lg:px-8">

      {/* ── Header ── */}
      <header className="fade-up relative z-20 flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-slate-900">
          <svg viewBox="0 0 200 160" fill="none" className="h-7 w-7" aria-hidden="true">
            <path d="M22 112 C30 112 38 90 44 82 C50 74 54 78 58 88 C62 98 64 116 70 120 C76 124 80 108 86 84 C92 60 96 22 104 16 C112 10 116 36 120 64 C124 92 126 138 134 140 C142 142 146 108 152 72 C158 36 162 14 168 16 C174 18 178 50 182 68" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          AI Usage
        </h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl
            value={filters.range === 'month' ? '' : filters.range}
            options={RANGES}
            onChange={(v) => setFilters((f) => ({ ...f, range: v }))}
          />
          <button
            onClick={() => setFilters((f) => ({ ...f, range: 'month' }))}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
              filters.range === 'month'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100/80 text-slate-400 hover:text-slate-600'
            }`}
          >
            This Month
          </button>
          <FilterPopover
            filters={filters}
            options={fOpts}
            onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          />
          <div className="hidden h-4 w-px bg-slate-200 sm:block" />
          <div className="hidden items-center gap-1.5 text-[12px] text-slate-400 sm:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${health?.ok ? (isDemo ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-slate-300'}`} />
            {isDemo ? 'Demo' : health?.ok ? health.siteId : '\u2026'}
          </div>
          <button
            onClick={() => setTick((t) => t + 1)}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Refresh"
          >
            <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* ── Content ── */}
      {loading && !overview ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`sa-${i}`} className="card px-5 py-5">
                <Skeleton className="mb-3 h-2.5 w-14" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`sb-${i}`} className="card px-5 py-5">
                <Skeleton className="mb-3 h-2.5 w-14" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
          <div className="card p-6"><Skeleton className="h-[280px]" /></div>
          <div className="card p-6"><Skeleton className="h-[280px]" /></div>
        </div>
      ) : error ? (
        <div className="card flex min-h-[320px] flex-col items-center justify-center p-8">
          <div className="mb-1.5 text-[13px] text-slate-400">Failed to load data</div>
          <div className="text-[13px] text-red-500/80">{error}</div>
        </div>
      ) : (
        <div className="grid gap-4">

          {/* ── KPI Row 1 ── */}
          <div
            className="fade-up grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            style={{ animationDelay: '50ms' }}
          >
            <div className="card">
              <KpiCard label="Estimated Cost" value={formatUsd(overview?.totalCostUsd ?? 0)} highlight />
            </div>
            <div className="card">
              <KpiCard label="Total Tokens" value={formatCompact(kpis?.totalTokens ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label="Input Tokens" value={formatCompact(kpis?.inputTokens ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label="Output Tokens" value={formatCompact(kpis?.outputTokens ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label="Cached Tokens" value={formatCompact(kpis?.cachedTokens ?? 0)} />
            </div>
          </div>

          {/* ── KPI Row 2 ── */}
          <div
            className="fade-up grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            style={{ animationDelay: '100ms' }}
          >
            <div className="card">
              <KpiCard
                label="Active Days"
                value={String(overview?.activeDays ?? 0)}
                suffix={` / ${overview?.totalDays ?? 0}`}
              />
            </div>
            <div className="card">
              <KpiCard label="Sessions" value={formatNumber(overview?.totalEvents ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label="Cost / Session" value={formatUsd(kpis?.costPerSession ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label="Avg Daily Cost" value={formatUsd(overview?.averageDailyCostUsd ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label="Cache Hit Rate" value={formatPercent(kpis?.cacheHitRate ?? 0)} />
            </div>
          </div>

          {/* ── Cost Trend ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '150ms' }}>
            <SectionHeader title="Cost Trend" stat={formatUsd(overview?.totalCostUsd ?? 0)} />
            <ChartBoundary name="Cost Trend">
              <CostTrendChart data={overview?.dailyTrend ?? []} />
            </ChartBoundary>
          </div>

          {/* ── Token Trend ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '200ms' }}>
            <SectionHeader title="Token Trend" stat={formatCompact(kpis?.totalTokens ?? 0)} />
            <ChartBoundary name="Token Trend">
              <TokenTrendChart data={overview?.tokenComposition ?? []} />
            </ChartBoundary>
            <ChartLegend items={tokenLegend} />
          </div>

          {/* ── Token Composition ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '250ms' }}>
            <SectionHeader title="Token Composition" />
            <ChartBoundary name="Token Composition">
              <TokenCompositionChart data={overview?.tokenComposition ?? []} />
            </ChartBoundary>
            <ChartLegend items={tokenLegend} />
          </div>

          {/* ── Flow & Share ── */}
          <div className="fade-up grid gap-4 lg:grid-cols-5" style={{ animationDelay: '300ms' }}>
            <div className="card p-6 lg:col-span-3">
              <SectionHeader title="Token Flow" />
              <ChartBoundary name="Token Flow">
                <FlowChart data={overview?.sankey} />
              </ChartBoundary>
            </div>
            <div className="card flex flex-col p-6 lg:col-span-2">
              <ChartBoundary name="Share">
                <div className="flex flex-1 flex-col">
                  <DonutSection
                    title="Provider Share"
                    data={(overview?.filters.options.providers ?? []).map((p) => ({
                      value: p.value,
                      label: p.label,
                      estimatedCostUsd: p.estimatedCostUsd,
                      eventCount: p.eventCount,
                    }))}
                    colors={['#0f172a', '#475569', '#94a3b8', '#cbd5e1']}
                    centerLabel={formatUsd(overview?.totalCostUsd ?? 0)}
                  />
                  <div className="my-5 border-t border-slate-100" />
                  <DonutSection
                    title="Model Share"
                    data={(overview?.modelCostShare ?? []).map((m) => ({ ...m, label: formatModelName(m.label) }))}
                    colors={CHART_COLORS}
                    centerLabel={formatUsd(overview?.totalCostUsd ?? 0)}
                  />
                  <div className="my-5 border-t border-slate-100" />
                  <DonutSection
                    title="Channel Share"
                    data={overview?.channelCostShare ?? []}
                    colors={['#1e3a5f', '#3b6fa0', '#6b9fd0', '#a8c5e2', '#cddff0', '#e8f0f8']}
                    centerLabel={formatNumber(overview?.totalEvents ?? 0)}
                  />
                </div>
              </ChartBoundary>
            </div>
          </div>

        </div>
      )}

      {/* ── Footer ── */}
      <footer className="fade-up mt-16 border-t border-slate-100 pb-10 pt-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3 text-[12px] text-slate-400">
            <span className="flex items-center gap-1.5 font-medium text-slate-500">
              <svg viewBox="0 0 200 160" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M22 112 C30 112 38 90 44 82 C50 74 54 78 58 88 C62 98 64 116 70 120 C76 124 80 108 86 84 C92 60 96 22 104 16 C112 10 116 36 120 64 C124 92 126 138 134 140 C142 142 146 108 152 72 C158 36 162 14 168 16 C174 18 178 50 182 68" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              AI Usage
            </span>
            {health?.version && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                v{health.version}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-300">
            <a
              href="https://github.com/ennann/aiusage"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-slate-400 transition-colors hover:text-slate-600"
            >
              <Github className="h-3.5 w-3.5" />
              <span>Source</span>
            </a>
            <span className="h-3 w-px bg-slate-200" />
            <span className="flex items-center gap-1">
              Made with <Heart className="h-3 w-3 fill-red-300 text-red-300" /> by{' '}
              <a
                href="https://x.com/qingnianxiaozhe"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 transition-colors hover:text-slate-600"
              >
                qingnianxiaozhe
              </a>
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
