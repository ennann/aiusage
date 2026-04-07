import { useEffect, useRef, useMemo } from 'react';
import { parseEmbedParams } from './parse-params';
import type { EmbedTheme } from './types';
import type { ThemeMode } from '../theme';
import { applyTheme } from '../theme';
import { I18N, type Locale, type T } from '../i18n';
import { useOverview, type OverviewPayload } from '../hooks/use-overview';
import { TOKEN_SERIES, getChartColors, getTokenColor, providerLabel } from '../constants';
import { useIsDark } from '../hooks/use-dark';
import {
  formatUsd, formatCompact, formatNumber, formatPercent, formatModelName, arrSum,
} from '../utils/format';

import { KpiCard } from '../components/kpi-card';
import { CostTrendChart } from '../components/cost-trend-chart';
import { TokenTrendChart } from '../components/token-trend-chart';
import { TokenCompositionChart } from '../components/token-composition-chart';
import { FlowChart } from '../components/flow-chart';
import { DonutSection } from '../components/donut-section';
import {
  ChartBoundary, SectionHeader, ChartLegend, EmptyState, Skeleton,
} from '../components/chart-helpers';

/* ── Auto-resize: notify parent iframe of height changes ── */

function useAutoResize(widget: string | null) {
  const lastHeight = useRef(0);

  useEffect(() => {
    if (!widget || window.parent === window) return;

    const root = document.querySelector('.embed-root') as HTMLElement | null;
    if (!root) return;

    const notify = () => {
      const h = Math.ceil(root.scrollHeight);
      if (h === lastHeight.current) return;
      lastHeight.current = h;
      window.parent.postMessage(
        { source: 'aiusage-embed', widget, height: h },
        '*',
      );
    };

    const ro = new ResizeObserver(notify);
    ro.observe(root);
    // Fire once after first paint
    notify();

    return () => ro.disconnect();
  }, [widget]);
}

/* ── Helpers ── */

function embedThemeToMode(et: EmbedTheme): ThemeMode {
  return et === 'auto' ? 'system' : et;
}

const tokenLegendLabels: Record<string, keyof T> = {
  inputTokens: 'input',
  cachedInputTokens: 'cached',
  cacheWriteTokens: 'cacheWrite',
  outputTokens: 'output',
  reasoningOutputTokens: 'reasoning',
};

/* ── Stats Row ── */

function StatsRow({
  cards,
  items,
}: {
  cards: Array<{ label: string; value: string; highlight?: boolean; suffix?: string }>;
  items: number[] | null;
}) {
  const visible = items ? cards.filter((_, i) => items.includes(i)) : cards;
  if (!visible.length) return null;
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}
    >
      {visible.map((c) => (
        <div key={c.label} className="card">
          <KpiCard label={c.label} value={c.value} highlight={c.highlight} suffix={c.suffix} />
        </div>
      ))}
    </div>
  );
}

/* ── Loading skeleton ── */

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-6 w-1/3" />
    </div>
  );
}

/* ── Widget renderer ── */

function WidgetRenderer({
  widget,
  items,
  overview,
  kpis,
  metricAvailability,
  t,
  locale,
}: {
  widget: string;
  items: number[] | null;
  overview: OverviewPayload | null;
  kpis: ReturnType<typeof useOverview>['kpis'];
  metricAvailability: ReturnType<typeof useOverview>['metricAvailability'];
  t: T;
  locale: Locale;
}) {
  const isDark = useIsDark();
  const unavailable = metricAvailability.tokenMetricsUnavailable;
  // token legend (shared by token-trend / token-composition)
  const tokenLegend = useMemo(() => {
    if (!overview) return [];
    const tc = overview.tokenComposition;
    return TOKEN_SERIES.map((s) => ({
      label: t[tokenLegendLabels[s.key] ?? 'input'],
      color: getTokenColor(s, isDark),
      value: formatCompact(arrSum(tc.map((d) => Number(d[s.key] || 0))), locale),
    }));
  }, [overview, t, locale, isDark]);

  switch (widget) {
    /* ── KPI Row 1 ── */
    case 'stats-row1': {
      const cards = [
        { label: t.estimatedCost, value: unavailable ? t.unavailable : formatUsd(overview?.totalCostUsd ?? 0), highlight: true },
        { label: t.totalTokens, value: unavailable ? t.unavailable : formatCompact(kpis?.totalTokens ?? 0, locale) },
        { label: t.inputTokens, value: unavailable ? t.unavailable : formatCompact(kpis?.inputTokens ?? 0, locale) },
        { label: t.outputTokens, value: unavailable ? t.unavailable : formatCompact(kpis?.outputTokens ?? 0, locale) },
        { label: t.cachedTokens, value: unavailable ? t.unavailable : formatCompact(kpis?.cachedTokens ?? 0, locale) },
      ];
      return <StatsRow cards={cards} items={items} />;
    }

    /* ── KPI Row 2 ── */
    case 'stats-row2': {
      const cards = [
        { label: t.activeDays, value: String(overview?.activeDays ?? 0), suffix: ` / ${overview?.totalDays ?? 0}` },
        { label: t.sessions, value: formatNumber((overview?.totalSessions ?? 0) > 0 ? overview!.totalSessions : (overview?.totalEvents ?? 0)) },
        { label: t.costPerSession, value: unavailable ? t.unavailable : formatUsd(kpis?.costPerSession ?? 0) },
        { label: t.avgDailyCost, value: unavailable ? t.unavailable : formatUsd(overview?.averageDailyCostUsd ?? 0) },
        { label: t.cacheHitRate, value: unavailable ? t.unavailable : formatPercent(kpis?.cacheHitRate ?? 0) },
      ];
      return <StatsRow cards={cards} items={items} />;
    }

    /* ── Cost Trend ── */
    case 'cost-trend':
      return (
        <>
          <SectionHeader title={t.costTrend} stat={unavailable ? t.unavailable : formatUsd(overview?.totalCostUsd ?? 0)} />
          {unavailable ? (
            <EmptyState label={t.costUnavailable} />
          ) : (
            <ChartBoundary name="Cost Trend">
              <CostTrendChart
                data={overview?.dailyTrend ?? []}
                providerTrend={overview?.providerDailyTrend ?? []}
              />
            </ChartBoundary>
          )}
        </>
      );

    /* ── Token Trend ── */
    case 'token-trend':
      return (
        <>
          <SectionHeader title={t.tokenTrend} stat={unavailable ? t.unavailable : formatCompact(kpis?.totalTokens ?? 0, locale)} />
          {unavailable ? (
            <EmptyState label={t.tokenUnavailable} />
          ) : (
            <>
              <ChartBoundary name="Token Trend">
                <TokenTrendChart data={overview?.tokenComposition ?? []} locale={locale} />
              </ChartBoundary>
              <ChartLegend items={tokenLegend} />
            </>
          )}
        </>
      );

    /* ── Token Composition ── */
    case 'token-composition':
      return (
        <>
          <SectionHeader title={t.tokenComposition} stat={unavailable ? t.unavailable : formatCompact(kpis?.totalTokens ?? 0, locale)} />
          {unavailable ? (
            <EmptyState label={t.tokenUnavailable} />
          ) : (
            <>
              <ChartBoundary name="Token Composition">
                <TokenCompositionChart data={overview?.tokenComposition ?? []} locale={locale} />
              </ChartBoundary>
              <ChartLegend items={tokenLegend} />
            </>
          )}
        </>
      );

    /* ── Flow (Sankey) ── */
    case 'flow':
      return (
        <>
          <SectionHeader title={t.tokenFlow} />
          {unavailable ? (
            <EmptyState label={t.tokenUnavailable} />
          ) : (
            <ChartBoundary name="Flow">
              <FlowChart data={overview?.sankey} />
            </ChartBoundary>
          )}
        </>
      );

    /* ── Share (Donuts) ── */
    case 'share': {
      const providerData = (overview?.filters.options.providers ?? []).map((p) => ({
        value: p.value,
        label: providerLabel(p.value),
        estimatedCostUsd: p.estimatedCostUsd,
        eventCount: p.eventCount,
      }));
      const modelData = (overview?.modelCostShare ?? []).map((m) => ({
        ...m,
        label: formatModelName(m.label),
      }));
      const deviceData = (overview?.filters.options.devices ?? []).map((d) => ({
        value: d.value,
        label: d.label,
        estimatedCostUsd: d.estimatedCostUsd,
        eventCount: d.eventCount,
      }));

      const centerLabel = formatUsd(overview?.totalCostUsd ?? 0);
      const colors = getChartColors(isDark);

      const sections = [
        { idx: 0, title: t.providerShare, data: providerData, colors },
        { idx: 1, title: t.modelShare, data: modelData, colors },
        { idx: 2, title: t.deviceShare, data: deviceData, colors },
      ];

      const visible = items ? sections.filter((s) => items.includes(s.idx)) : sections;
      const divider = <div className="my-5 border-t border-slate-100 dark:border-white/[0.08]" />;

      if (unavailable) {
        return <EmptyState label={t.shareUnavailable} />;
      }

      return (
        <>
          {visible.map((sec, i) => (
            <div key={sec.idx}>
              {i > 0 && divider}
              <DonutSection
                title={sec.title}
                data={sec.data}
                colors={sec.colors}
                centerLabel={centerLabel}
              />
            </div>
          ))}
        </>
      );
    }

    default:
      return <div className="p-4 text-sm text-slate-400">Missing ?widget= parameter</div>;
  }
}

/* ── Main component ── */

export function EmbedApp() {
  const params = useMemo(() => parseEmbedParams(window.location.search), []);
  const locale = params.locale;
  const t = I18N[locale] as T;

  // Auto-resize: post height to parent on every content change
  useAutoResize(params.widget);

  // Apply theme
  useEffect(() => {
    applyTheme(embedThemeToMode(params.theme));
  }, [params.theme]);

  // Transparent background
  useEffect(() => {
    if (params.transparent) {
      document.body.style.background = 'transparent';
      document.body.classList.add('embed-transparent');
    }
    return () => {
      if (params.transparent) {
        document.body.style.background = '';
        document.body.classList.remove('embed-transparent');
      }
    };
  }, [params.transparent]);

  // Data
  const filters = useMemo(
    () => ({ range: params.range, deviceId: params.deviceId, product: params.product }),
    [params.range, params.deviceId, params.product],
  );
  const { overview, kpis, metricAvailability, loading, error } = useOverview(filters);

  // No widget
  if (!params.widget) {
    return <div className="p-4 text-sm text-slate-400">Missing ?widget= parameter</div>;
  }

  // Error
  if (error) {
    return <div className="p-4 text-sm text-red-400">{error}</div>;
  }

  // Loading (only show skeleton on first load)
  if (loading && !overview) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="embed-root">
      <WidgetRenderer
        widget={params.widget}
        items={params.items}
        overview={overview}
        kpis={kpis}
        metricAvailability={metricAvailability}
        t={t}
        locale={locale}
      />
    </div>
  );
}
