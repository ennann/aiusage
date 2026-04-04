import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { RotateCw, Github, Heart, Sun, Moon, Monitor } from 'lucide-react';
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
            <span>{THEME_LABELS[o.value][locale]}</span>
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
    <div className="inline-flex items-center rounded-lg bg-slate-100/80 p-0.5 dark:bg-[#1a1a1a]/80">
      <button
        onClick={() => onChange('')}
        className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-all duration-150 ${
          !value ? activeClass : inactiveClass
        }`}
      >
        {allLabel}
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value === value ? '' : o.value)}
          className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-all duration-150 ${
            value === o.value ? activeClass : inactiveClass
          }`}
        >
          {formatProductLabel(o.label)}
        </button>
      ))}
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

  const { overview, health, kpis, fOpts, loading, error, isDemo, refresh } = useOverview(filters);
  useFetchCnyRate();
  useCurrencyStore(); // subscribe to re-render on toggle
  const isDark = useIsDark();

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

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 sm:px-6 lg:px-8">

      {/* ── Header ── */}
      <header className="fade-up relative z-20 py-6 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-slate-900 dark:text-slate-300">
            <svg viewBox="0 0 200 160" fill="none" className="h-7 w-7" aria-hidden="true">
              <path d="M22 112 C30 112 38 90 44 82 C50 74 54 78 58 88 C62 98 64 116 70 120 C76 124 80 108 86 84 C92 60 96 22 104 16 C112 10 116 36 120 64 C124 92 126 138 134 140 C142 142 146 108 152 72 C158 36 162 14 168 16 C174 18 178 50 182 68" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            AI Usage
          </h1>
          <div className="flex flex-wrap items-center gap-2">
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

        {/* ── Range + Filters ── */}
        <div className="mt-2 mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
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
              <div className="hidden h-5 w-px bg-slate-200 dark:bg-[#222222] sm:block" />
              <div className="overflow-x-auto">
                <FilterTabs
                  value={filters.product}
                  options={fOpts.products}
                  allLabel={t.all}
                  onChange={(v) => setFilters((f) => ({ ...f, product: v }))}
                />
              </div>
            </>
          )}
          {overview && fOpts.devices.length >= 1 && (
            <>
              <div className="hidden h-5 w-px bg-slate-200 dark:bg-[#222222] sm:block" />
              <div className="overflow-x-auto">
                <FilterTabs
                  value={filters.deviceId}
                  options={fOpts.devices}
                  allLabel={t.all}
                  onChange={(v) => setFilters((f) => ({ ...f, deviceId: v }))}
                />
              </div>
            </>
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
              <CostKpiCard label={t.estimatedCost} value={formatUsd(overview?.totalCostUsd ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label={t.totalTokens} value={formatCompact(kpis?.totalTokens ?? 0, locale)} />
            </div>
            <div className="card">
              <KpiCard label={t.inputTokens} value={formatCompact(kpis?.inputTokens ?? 0, locale)} />
            </div>
            <div className="card">
              <KpiCard label={t.outputTokens} value={formatCompact(kpis?.outputTokens ?? 0, locale)} />
            </div>
            <div className="card">
              <KpiCard label={t.cachedTokens} value={formatCompact(kpis?.cachedTokens ?? 0, locale)} />
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
              <KpiCard label={t.sessions} value={formatNumber(overview?.totalEvents ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label={t.costPerSession} value={formatUsd(kpis?.costPerSession ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label={t.avgDailyCost} value={formatUsd(overview?.averageDailyCostUsd ?? 0)} />
            </div>
            <div className="card">
              <KpiCard label={t.cacheHitRate} value={formatPercent(kpis?.cacheHitRate ?? 0)} />
            </div>
          </div>

          {/* ── Activity Heatmap ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '120ms' }}>
            <SectionHeader title={locale === 'zh' ? '年度活跃热力图' : 'Activity Heatmap'} />
            <ActivityHeatmap days={overview?.heatmap ?? []} />
          </div>

          {/* ── Cost Trend ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '150ms' }}>
            <SectionHeader title={t.costTrend} stat={formatUsd(overview?.totalCostUsd ?? 0)} />
            <ChartBoundary name="Cost Trend">
              <CostTrendChart
                data={overview?.dailyTrend ?? []}
                providerTrend={overview?.providerDailyTrend ?? []}
              />
            </ChartBoundary>
          </div>

          {/* ── Token Trend ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '200ms' }}>
            <SectionHeader title={t.tokenTrend} stat={formatCompact(kpis?.totalTokens ?? 0, locale)} />
            <ChartBoundary name="Token Trend">
              <TokenTrendChart data={overview?.tokenComposition ?? []} locale={locale} />
            </ChartBoundary>
            <ChartLegend items={tokenLegend} />
          </div>

          {/* ── Token Composition ── */}
          <div className="card fade-up p-6" style={{ animationDelay: '250ms' }}>
            <SectionHeader title={t.tokenComposition} />
            <ChartBoundary name="Token Composition">
              <TokenCompositionChart data={overview?.tokenComposition ?? []} locale={locale} />
            </ChartBoundary>
            <ChartLegend items={tokenLegend} />
          </div>

          {/* ── Flow & Share ── */}
          <div className="fade-up grid gap-4 lg:grid-cols-5" style={{ animationDelay: '300ms' }}>
            <div className="card p-6 lg:col-span-3">
              <SectionHeader title={t.tokenFlow} />
              <ChartBoundary name="Token Flow">
                <FlowChart data={overview?.sankey} />
              </ChartBoundary>
            </div>
            <div className="card flex flex-col p-6 lg:col-span-2">
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
            </div>
          </div>

        </div>
      )}

      {/* ── Footer ── */}
      <footer className="fade-up mt-16 border-t border-slate-100 dark:border-white/[0.08] pb-10 pt-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3 text-[12px] text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
              <svg viewBox="0 0 200 160" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M22 112 C30 112 38 90 44 82 C50 74 54 78 58 88 C62 98 64 116 70 120 C76 124 80 108 86 84 C92 60 96 22 104 16 C112 10 116 36 120 64 C124 92 126 138 134 140 C142 142 146 108 152 72 C158 36 162 14 168 16 C174 18 178 50 182 68" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              AI Usage
            </span>
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
    </main>
  );
}
