import type { ChartConfig } from './components/ui/chart';

export const TOKEN_SERIES = [
  { key: 'inputTokens' as const, label: 'Input', color: '#0f172a' },
  { key: 'cachedInputTokens' as const, label: 'Cached', color: '#334155' },
  { key: 'cacheWriteTokens' as const, label: 'Cache Write', color: '#64748b' },
  { key: 'outputTokens' as const, label: 'Output', color: '#94a3b8' },
  { key: 'reasoningOutputTokens' as const, label: 'Reasoning', color: '#cbd5e1' },
];

export const CHART_COLORS = [
  '#0f172a', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0',
];

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#0f172a',
  openai: '#1e293b',
  google: '#334155',
  github: '#475569',
  sourcegraph: '#64748b',
  moonshot: '#94a3b8',
  alibaba: '#cbd5e1',
  droid: '#e2e8f0',
  opencode: '#f1f5f9',
  openclaw: '#f8fafc',
};

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  github: 'GitHub',
  sourcegraph: 'Sourcegraph',
  moonshot: 'Moonshot',
  alibaba: 'Alibaba',
  droid: 'Droid',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

export const TOKEN_CONFIG = Object.fromEntries(
  TOKEN_SERIES.map((s) => [s.key, { label: s.label, color: s.color }]),
) satisfies ChartConfig;

export function formatProductLabel(raw: string): string {
  return raw
    .split('-')
    .map((w) => (w === 'cli' ? 'CLI' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
