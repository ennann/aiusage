import type { Locale } from '../i18n';
import { convertUsd } from '../hooks/use-cny-rate';

export function formatUsd(v: number): string {
  const { value: n, prefix } = convertUsd(Number(v || 0));
  if (n >= 100) return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 10) return `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  return `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsdFull(v: number): string {
  const { value: n, prefix } = convertUsd(Number(v || 0));
  return `${prefix}${n.toFixed(2)}`;
}

export function formatCompact(v: number, locale: Locale = 'en'): string {
  const n = Number(v || 0);
  if (locale === 'zh') {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
    return String(Math.round(n));
  }
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatNumber(v: number): string {
  return new Intl.NumberFormat('en-US').format(Number(v || 0));
}

export function formatPercent(v: number): string {
  return `${Number(v || 0).toFixed(1)}%`;
}

export function formatModelName(raw: string): string {
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

export function shortDate(v: string): string { return v.slice(5); }

export function longDate(v: string): string {
  const d = new Date(v + 'T00:00:00');
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function arrSum(arr: number[]): number {
  return arr.reduce((a, b) => a + Number(b || 0), 0);
}

export function foldItems<T extends { estimatedCostUsd: number; label: string; value: string }>(
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
