import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { RotateCw, Github, Heart, Sun, Moon, Monitor } from 'lucide-react';
import { useScrollMorph } from './hooks/use-scroll-morph';
import { usePinchTextZoom } from './hooks/use-pinch-text-zoom';
import { ZoomIndicator } from './components/zoom-indicator';
import type { Locale, T } from './i18n';
import { I18N, getStoredLocale } from './i18n';
import type { ThemeMode } from './theme';
import { getStoredTheme, applyTheme } from './theme';
import { TOKEN_SERIES, getChartColors, getTokenColor, providerLabel, formatProductLabel } from './constants';
import { useIsDark } from './hooks/use-dark';
import {
  formatUsd, formatUsdFull, formatCompact, formatNumber, formatPercent,
  formatModelName, shortDate, longDate, arrSum, foldItems,
} from './utils/format';
import type { FiltersState, FacetOption } from './hooks/use-overview';
import { useOverview } from './hooks/use-overview';
import { ChartBoundary, EmptyState, Skeleton, SectionHeader, ChartLegend } from './components/chart-helpers';
import { KpiCard, CostKpiCard } from './components/kpi-card';
import { useFetchCnyRate, useCurrencyStore } from './hooks/use-cny-rate';
import { CostTrendChart } from './components/cost-trend-chart';
import { TokenTrendChart } from './components/token-trend-chart';
import { TokenCompositionChart } from './components/token-composition-chart';
import { FlowChart } from './components/flow-chart';
import { DonutSection } from './components/donut-section';
import { ActivityHeatmap } from './components/activity-heatmap';
import { buildActivityHeatmapData } from './utils/activity-heatmap-data';

// ────────────────────────────────────────
// Constants
// ────────────────────────────────────────

function getRanges(t: T) {
  return [
    { value: 'all', label: t.all },
    { value: '7d', label: t.range7d },
    { value: '30d', label: t.range30d },
    { value: '90d', label: t.range90d },
  ] as const;
}

// ────────────────────────────────────────
// Theme & Language Toggles
// ────────────────────────────────────────

const THEME_OPTIONS: { value: ThemeMode; icon: typeof Sun }[] = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
];

const THEME_LABELS: Record<ThemeMode, { en: string; zh: string }> = {
  system: { en: 'System', zh: '系统' },
  light: { en: 'Light', zh: '日间' },
  dark: { en: 'Dark', zh: '夜间' },
};

function ThemeToggle({ value, onChange, locale }: { value: ThemeMode; onChange: (v: ThemeMode) => void; locale: Locale }) {
  return (
    <div className="inline-flex items-center rounded-md bg-slate-100/80 p-0.5 dark:bg-[#1a1a1a]/80">
      {THEME_OPTIONS.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-all duration-150 ${
              value === o.value
                ? 'bg-white text-slate-900 shadow-sm dark:bg-[#222222] dark:text-slate-300'
                : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
            }`}
            aria-label={o.value}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{THEME_LABELS[o.value][locale]}</span>
          </button>
        );
      })}
    </div>
  );
}

function LangToggle({ value, onChange }: { value: Locale; onChange: (v: Locale) => void }) {
  return (
    <div className="inline-flex items-center rounded-md bg-slate-100/80 p-0.5 dark:bg-[#1a1a1a]/80">
      {(['en', 'zh'] as const).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`rounded px-2 py-1 text-[11px] font-medium transition-all duration-150 ${
            value === l
              ? 'bg-white text-slate-900 shadow-sm dark:bg-[#222222] dark:text-slate-300'
              : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
          }`}
        >
          {l === 'en' ? 'EN' : '中'}
        </button>
      ))}
    </div>
  );
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
    <div className="inline-flex items-center rounded-lg bg-slate-100/80 p-0.5 dark:bg-[#1a1a1a]/80" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-[#222222] dark:text-slate-300'
              : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterTabs({
  value,
  options,
  onChange,
  allLabel = 'All',
}: {
  value: string;
  options: FacetOption[];
  onChange: (v: string) => void;
  allLabel?: string;
}) {
  if (!options.length) return null;
  const activeClass = 'bg-white text-slate-900 shadow-sm dark:bg-[#222222] dark:text-slate-300';
  const inactiveClass = 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300';
  return (
    <div className="inline-flex items-center rounded-lg bg-slate-100/80 p-0.5 dark:bg-[#1a1a1a]/80 flex-nowrap">
      <button
        onClick={() => onChange('')}
        className={`shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-all duration-150 ${
          !value ? activeClass : inactiveClass
        }`}
      >
        {allLabel}
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value === value ? '' : o.value)}
          className={`shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-all duration-150 ${
            value === o.value ? activeClass : inactiveClass
          }`}
        >
          {formatProductLabel(o.label)}
        </button>
      ))}
    </div>
  );
}

function FilterChips({
  label,
  value,
  options,
  onChange,
  allLabel = 'All',
}: {
  label: string;
  value: string;
  options: FacetOption[];
  onChange: (v: string) => void;
  allLabel?: string;
}) {
  if (!options.length) return null;
  const active = 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900';
  const inactive = 'bg-white text-slate-500 border border-slate-200 dark:bg-[#1a1a1a] dark:text-slate-400 dark:border-white/10';
  return (
    <div className="flex items-center gap-2 min-w-0">
      {label && <span className="shrink-0 text-[12px] font-medium text-slate-400 dark:text-slate-500">{label}</span>}
      <div className="relative min-w-0 flex-1">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-1.5 w-max pr-4">
            {allLabel && (
              <button
                onClick={() => onChange('')}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium whitespace-nowrap transition-all duration-150 ${
                  !value ? active : inactive
                }`}
              >
                {allLabel}
              </button>
            )}
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => onChange(o.value === value ? '' : o.value)}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium whitespace-nowrap transition-all duration-150 ${
                  value === o.value ? active : inactive
                }`}
              >
                {formatProductLabel(o.label)}
              </button>
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#fafafa] dark:from-[#0a0a0a]" />
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// App
// ────────────────────────────────────────

export function App() {
  const [filters, setFilters] = useState<FiltersState>({
    range: '30d', deviceId: '', product: '',
  });

  const {
    overview,
    health,
    kpis,
    metricAvailability,
    fOpts,
    loading,
    error,
    isDemo,
    refresh,
  } = useOverview(filters);
  useFetchCnyRate();
  useCurrencyStore(); // subscribe to re-render on toggle
  const isDark = useIsDark();

  // Immersive reading
  const { containerRef: morphRef } = useScrollMorph();
  const { containerRef: zoomRef, zoomLevel, isGesturing, gesturePosition } = usePinchTextZoom();
  const mainRef = useCallback((node: HTMLElement | null) => {
    (morphRef as React.MutableRefObject<HTMLElement | null>).current = node;
    (zoomRef as React.MutableRefObject<HTMLElement | null>).current = node;
  }, [morphRef, zoomRef]);

  // Theme
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme);
  const isFirstRender = useRef(true);
  const setTheme = useCallback((m: ThemeMode) => { setThemeState(m); applyTheme(m); }, []);
  useEffect(() => {
    applyTheme(theme, !isFirstRender.current);
    isFirstRender.current = false;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Locale
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem('aiusage-locale', l); } catch {}
  }, []);
  const t: T = I18N[locale];

  // Token legend (locale-aware)
  const tokenLegendLabels: Record<string, keyof T> = {
    inputTokens: 'input', cachedInputTokens: 'cached',
    cacheWriteTokens: 'cacheWrite', outputTokens: 'output',
    reasoningOutputTokens: 'reasoning',
  };
  const tokenLegend = useMemo(() => {
    if (!overview) return [];
    const tc = overview.tokenComposition;
    return TOKEN_SERIES.map((s) => ({
      label: t[tokenLegendLabels[s.key] ?? 'input'],
      color: getTokenColor(s, isDark),
      value: formatCompact(arrSum(tc.map((d) => Number(d[s.key] || 0))), locale),
    }));
  }, [overview, t, locale, isDark]);
  const unavailable = metricAvailability.tokenMetricsUnavailable;
  const activityHeatmap = useMemo(() => buildActivityHeatmapData({
    heatmap: overview?.heatmap ?? [],
    dailyTrend: overview?.dailyTrend ?? [],
    tokenMetricsUnavailable: unavailable,
  }), [overview, unavailable]);

  return (
    <main ref={mainRef} className="prose-immersive mx-auto w-full max-w-[1200px] px-4 pb-16 sm:px-6 lg:px-8">

      {/* ── Header ── */}
      <header className="fade-up relative z-20 py-6 sm:py-8">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-slate-900 dark:text-slate-300">
            <a href="https://hubeiqiao.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 transition-opacity hover:opacity-70">
              <img src="/avatar.png" alt="Joe" className="h-7 w-7 rounded-full" />
              Joe's AI Usage
            </a>
          </h1>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle value={theme} onChange={setTheme} locale={locale} />
            <LangToggle value={locale} onChange={setLocale} />
            <button
              onClick={refresh}
              className="hidden sm:inline-flex items-center justify-center rounded-md bg-slate-100/80 p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:bg-[#1a1a1a]/80 dark:text-slate-500 dark:hover:text-slate-300"
              aria-label="Refresh"
            >
              <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

      </header>

        {/* ── Range + Filters (desktop) ── */}
        <div className="mt-2 mb-6 hidden sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
          <div className="flex items-center gap-2">
            <SegmentedControl
              value={filters.range === 'month' ? '' : filters.range}
              options={getRanges(t)}
              onChange={(v) => setFilters((f) => ({ ...f, range: v }))}
            />
            <button
              onClick={() => setFilters((f) => ({ ...f, range: 'month' }))}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                filters.range === 'month'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-[#222222] dark:text-slate-300'
                  : 'bg-slate-100/80 text-slate-400 hover:text-slate-600 dark:bg-[#1a1a1a]/80 dark:text-slate-500 dark:hover:text-slate-300'
              }`}
            >
              {t.thisMonth}
            </button>
          </div>
          {overview && fOpts.products.length > 1 && (
            <>
              <div className="h-5 w-px bg-slate-200 dark:bg-[#222222]" />
              <FilterTabs
                value={filters.product}
                options={fOpts.products}
                allLabel={t.all}
                onChange={(v) => setFilters((f) => ({ ...f, product: v }))}
              />
            </>
          )}
          {overview && fOpts.devices.length >= 1 && (
            <>
              <div className="h-5 w-px bg-slate-200 dark:bg-[#222222]" />
              <FilterTabs
                value={filters.deviceId}
                options={fOpts.devices}
                allLabel={t.all}
                onChange={(v) => setFilters((f) => ({ ...f, deviceId: v }))}
              />
            </>
          )}
        </div>

        {/* ── Filters (mobile) ── */}
        <div className="mt-1 mb-5 flex flex-col gap-3 sm:hidden">
          <FilterChips
            label=""
            value={filters.range}
            options={[...getRanges(t), { value: 'month', label: t.thisMonth }].map((r) => ({ value: r.value, label: r.label, eventCount: 0, estimatedCostUsd: 0 }))}
            allLabel=""
            onChange={(v) => setFilters((f) => ({ ...f, range: v || '30d' }))}
          />
          {overview && fOpts.products.length > 1 && (
            <FilterChips
              label={t.product ?? 'Product'}
              value={filters.product}
              options={fOpts.products}
              allLabel={t.all}
              onChange={(v) => setFilters((f) => ({ ...f, product: v }))}
            />
          )}
          {overview && fOpts.devices.length >= 1 && (
            <FilterChips
              label={t.device ?? 'Device'}
              value={filters.deviceId}
              options={fOpts.devices}
              allLabel={t.all}
              onChange={(v) => setFilters((f) => ({ ...f, deviceId: v }))}
            />
          )}
        </div>

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
          <div className="mb-1.5 text-[13px] text-slate-400 dark:text-slate-500">{t.failedToLoad}</div>
          <div className="text-[13px] text-red-500/80">{error}</div>
        </div>
      ) : (
        <div className="grid gap-4">

          {/* ── KPI Row 1 ── */}
          <div
            className="fade-up grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            style={{ animationDelay: '50ms' }}
          >
            <div className="card col-span-2 sm:col-span-1">
              <CostKpiCard
                label={t.estimatedCost}
                value={unavailable ? t.unavailable : formatUsd(overview?.totalCostUsd ?? 0)}
              />
            </div>
            <div className="card">
              <KpiCard label={t.totalTokens} value={unavailable ? t.unavailable : formatCompact(kpis?.totalTokens ?? 0, locale)} />
            </div>
            <div className="card">
              <KpiCard label={t.inputTokens} value={unavailable ? t.unavailable : formatCompact(kpis?.inputTokens ?? 0, locale)} />
            </div>
            <div className="card">
              <KpiCard label={t.outputTokens} value={unavailable ? t.unavailable : formatCompact(kpis?.outputTokens ?? 0, locale)} />
            </div>
            <div className="card">
              <KpiCard label={t.cachedTokens} value={unavailable ? t.unavailable : formatCompact(kpis?.cachedTokens ?? 0, locale)} />
            </div>
          </div>

          {/* ── KPI Row 2 ── */}
          <div
            className="fade-up grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            style={{ animationDelay: '100ms' }}
          >
            <div className="card col-span-2 sm:col-span-1">
              <KpiCard
                label={t.activeDays}
                value={String(overview?.activeDays ?? 0)}
                suffix={` / ${overview?.totalDays ?? 0}`}
              />
            </div>
            <div className="card">
              <KpiCard
                label={t.sessions}
                value={formatNumber((overview?.totalSessions ?? 0) > 0 ? overview!.totalSessions : (overview?.totalEvents ?? 0))}
                suffix={(overview?.totalSessions ?? 0) > 0 && overview!.totalSessions !== overview!.totalEvents ? ` / ${formatNumber(overview!.totalEvents)}` : undefined}
              />
            </div>
            <div className="card">
              <KpiCard label={t.costPerSession} value={unavailable ? t.unavailable : formatUsd(kpis?.costPerSession ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label={t.avgDailyCost} value={unavailable ? t.unavailable : formatUsd(overview?.averageDailyCostUsd ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label={t.cacheHitRate} value={unavailable ? t.unavailable : formatPercent(kpis?.cacheHitRate ?? 0)} />
            </div>
          </div>

          {unavailable && (
            <div className="fade-up rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-950/60 dark:bg-amber-950/20 dark:text-amber-200">
              <span className="font-medium">{t.eventOnlySource}.</span> {t.eventOnlyNotice}
            </div>
          )}

          {!unavailable && (filters.product === '' || filters.product === 'claude-code') && (
            <div className="fade-up rounded-xl border border-blue-200/80 bg-blue-50/70 px-4 py-3 text-[13px] text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200">
              {t.claudeCodeDataNotice}
            </div>
          )}

          {/* ── Activity Heatmap ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '120ms' }}>
            <SectionHeader title={locale === 'zh' ? '年度活跃热力图' : 'Activity Heatmap'} />
            <ActivityHeatmap days={activityHeatmap.days} metricLabel={activityHeatmap.metricLabel} />
          </div>

          {/* ── Cost Trend ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '150ms' }}>
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
          </div>

          {/* ── Token Trend ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '200ms' }}>
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
          </div>

          {/* ── Token Composition ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '250ms' }}>
            <SectionHeader title={t.tokenComposition} stat={unavailable ? t.unavailable : undefined} />
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
          </div>

          {/* ── Flow & Share ── */}
          <div className="fade-up grid gap-4 lg:grid-cols-5" style={{ animationDelay: '300ms' }}>
            <div className="card p-6 lg:col-span-3">
              <SectionHeader title={t.tokenFlow} />
              {unavailable ? (
                <EmptyState label={t.tokenUnavailable} />
              ) : (
                <ChartBoundary name="Token Flow">
                  <FlowChart data={overview?.sankey} />
                </ChartBoundary>
              )}
            </div>
            <div className="card flex flex-col p-6 lg:col-span-2">
              {unavailable ? (
                <EmptyState label={t.shareUnavailable} />
              ) : (
                <ChartBoundary name="Share">
                  <div className="flex flex-1 flex-col">
                    <DonutSection
                      title={t.providerShare}
                      data={(overview?.filters.options.providers ?? []).map((p) => ({
                        value: p.value,
                        label: providerLabel(p.value),
                        estimatedCostUsd: p.estimatedCostUsd,
                        eventCount: p.eventCount,
                      }))}
                      colors={getChartColors(isDark)}
                      centerLabel={formatUsd(overview?.totalCostUsd ?? 0)}
                    />
                    <div className="my-5 border-t border-slate-100 dark:border-white/[0.08]" />
                    <DonutSection
                      title={t.modelShare}
                      data={(overview?.modelCostShare ?? []).map((m) => ({ ...m, label: formatModelName(m.label) }))}
                      colors={getChartColors(isDark)}
                      centerLabel={formatUsd(overview?.totalCostUsd ?? 0)}
                    />
                    <div className="my-5 border-t border-slate-100 dark:border-white/[0.08]" />
                    <DonutSection
                      title={t.deviceShare}
                      data={(overview?.filters.options.devices ?? []).map((d) => ({
                        value: d.value,
                        label: d.label,
                        estimatedCostUsd: d.estimatedCostUsd,
                        eventCount: d.eventCount,
                      }))}
                      colors={getChartColors(isDark)}
                      centerLabel={formatUsd(overview?.totalCostUsd ?? 0)}
                    />
                  </div>
                </ChartBoundary>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── Footer ── */}
      <footer className="fade-up mt-16 border-t border-slate-100 dark:border-white/[0.08] pb-10 pt-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3 text-[12px] text-slate-400 dark:text-slate-500">
            <a href="https://hubeiqiao.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-medium text-slate-500 transition-opacity hover:opacity-70 dark:text-slate-400">
              <img src="/avatar.png" alt="Joe" className="h-3.5 w-3.5 rounded-full" />
              Joe's AI Usage
            </a>
            {health?.version && (
              <span className="rounded-full bg-slate-100 dark:bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                v{health.version}
              </span>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-[11px] text-slate-300 dark:text-slate-600">
            <div className="flex items-center gap-4">
              <a
                href="/pricing"
                className="text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                {t.pricing}
              </a>
              <span className="h-3 w-px bg-slate-200 dark:bg-[#222222]" />
              <a
                href="/embed/docs"
                className="text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                {t.embedWidgets}
              </a>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/ennann/aiusage"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                <Github className="h-3.5 w-3.5" />
                <span>GitHub</span>
              </a>
              <span className="h-3 w-px bg-slate-200 dark:bg-[#222222]" />
              <span className="flex items-center gap-1">
                Made with <Heart className="h-3 w-3 fill-red-300 text-red-300" /> by{' '}
                <a
                  href="https://x.com/qingnianxiaozhe"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                  qingnianxiaozhe
                </a>
              </span>
            </div>
          </div>
        </div>
      </footer>
      <ZoomIndicator zoomLevel={zoomLevel} isVisible={isGesturing} position={gesturePosition} />
    </main>
  );
}
