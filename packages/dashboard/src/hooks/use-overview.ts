import { useEffect, useMemo, useState } from 'react';
import type { OverviewResponse } from '@aiusage/shared';
import { DEMO_OVERVIEW, DEMO_HEALTH } from '../demo-data';
import { arrSum } from '../utils/format';
import { buildQuery, padMonth } from '../utils/data';
import { getMetricAvailability } from '../utils/metric-availability';

// ── Types ──

export interface FiltersState {
  range: string;
  deviceId: string;
  product: string;
}

export interface HealthPayload { ok: boolean; siteId: string; version: string; siteTitle?: string }
export interface OverviewPayload extends OverviewResponse { ok: boolean }
export interface FacetOption { value: string; label: string }

// ── Fetch helper ──

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error('Response is not JSON');
  }
  return r.json() as Promise<T>;
}

// ── Hook ──

export function useOverview(filters: FiltersState) {
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
    const costDivisor = overview.totalSessions > 0
      ? overview.totalSessions
      : (overview.costBearingEvents ?? overview.totalEvents);
    const costPerSession = costDivisor > 0
      ? overview.totalCostUsd / costDivisor : 0;
    return { totalTokens, inputTokens, outputTokens, cachedTokens, cacheHitRate, costPerSession };
  }, [overview]);

  const metricAvailability = useMemo(() => {
    if (!overview || !kpis) {
      return { mode: 'standard' as const, tokenMetricsUnavailable: false };
    }

    return getMetricAvailability({
      selectedProduct: overview.filters.selection.product,
      productOptions: overview.filters.options.products,
      totalEvents: overview.totalEvents,
      totalTokens: kpis.totalTokens,
    });
  }, [overview, kpis]);

  // Filter options
  const fOpts = useMemo(() => ({
    devices: overview?.filters.options.devices ?? [],
    products: overview?.filters.options.products ?? [],
  }), [overview]);

  const refresh = () => setTick((n) => n + 1);

  return {
    overview,
    health,
    kpis,
    metricAvailability,
    fOpts,
    loading,
    error,
    isDemo,
    refresh,
  };
}
