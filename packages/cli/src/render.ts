import type { LocalReport } from './report.js';
import type { Lang } from './i18n.js';
import { t } from './i18n.js';

export interface RenderOptions {
  lang: Lang;
  emoji: boolean;
  detail: boolean;
}

export function renderReport(report: LocalReport, opts: RenderOptions): string {
  const s = t(opts.lang);
  const lines: string[] = [];

  // Header
  const title = opts.emoji ? `\u{1F4CA} ${s.reportTitle}` : s.reportTitle;
  lines.push(title);
  lines.push('\u2500'.repeat(stripAnsi(title).length));

  const rangeLabel = getRangeLabel(report.range, opts.lang);
  const periodStart = report.startDate ? fmtDateShort(report.startDate) : '-';
  const periodEnd = report.endDate ? fmtDateShort(report.endDate) : '-';
  lines.push(`${s.period.padEnd(10)}${rangeLabel} (${periodStart} \u2013 ${periodEnd})`);
  lines.push(`${s.events.padEnd(10)}${fmtInt(report.totals.eventCount)}`);
  lines.push(`${s.tokens.padEnd(10)}${fmtToken(report.totals.totalTokens)}`);
  lines.push(`${s.cost.padEnd(10)}${fmtUsd(report.totals.estimatedCostUsd, opts.detail)}`);

  if (report.daysWithData === 0) {
    lines.push('');
    lines.push(s.noData);
    return lines.join('\n');
  }

  // Sources
  lines.push('');
  lines.push(s.sources);
  if (opts.detail) {
    lines.push(renderTable(
      [s.hdrSource, s.hdrEvents, s.hdrInput, s.hdrCacheRead, s.hdrCacheWrite, s.hdrOutput, s.hdrReasoning, s.hdrTotal, s.hdrCost],
      report.bySource.map((r) => [
        r.source, fmtInt(r.eventCount),
        fmtToken(r.inputTokens), fmtToken(r.cachedInputTokens), fmtToken(r.cacheWriteTokens),
        fmtToken(r.outputTokens), fmtToken(r.reasoningOutputTokens),
        fmtToken(r.totalTokens), fmtUsd(r.estimatedCostUsd, true),
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    ));
  } else {
    lines.push(renderTable(
      [s.hdrSource, s.hdrEvents, s.hdrInput, s.hdrCache, s.hdrOutput, s.hdrTotal, s.hdrCost],
      report.bySource.map((r) => [
        r.source, fmtInt(r.eventCount),
        fmtToken(r.inputTokens),
        fmtToken(r.cachedInputTokens + r.cacheWriteTokens),
        fmtToken(r.outputTokens),
        fmtToken(r.totalTokens), fmtUsd(r.estimatedCostUsd, false),
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    ));
  }

  // Daily
  lines.push('');
  lines.push(s.daily);
  if (opts.detail) {
    lines.push(renderTable(
      [s.hdrDate, s.hdrEvents, s.hdrInput, s.hdrCacheRead, s.hdrCacheWrite, s.hdrOutput, s.hdrReasoning, s.hdrTotal, s.hdrCost],
      report.daily.map((r) => [
        r.usageDate, fmtInt(r.eventCount),
        fmtToken(r.inputTokens), fmtToken(r.cachedInputTokens), fmtToken(r.cacheWriteTokens),
        fmtToken(r.outputTokens), fmtToken(r.reasoningOutputTokens),
        fmtToken(r.totalTokens), fmtUsd(r.estimatedCostUsd, true),
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    ));
  } else {
    lines.push(renderTable(
      [s.hdrDate, s.hdrEvents, s.hdrInput, s.hdrCache, s.hdrOutput, s.hdrTotal, s.hdrCost],
      report.daily.map((r) => [
        r.usageDate, fmtInt(r.eventCount),
        fmtToken(r.inputTokens),
        fmtToken(r.cachedInputTokens + r.cacheWriteTokens),
        fmtToken(r.outputTokens),
        fmtToken(r.totalTokens), fmtUsd(r.estimatedCostUsd, false),
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    ));
  }

  // Top Models (detail only)
  if (opts.detail && report.byModel.length > 0) {
    lines.push('');
    lines.push(s.topModels);
    lines.push(renderTable(
      [s.hdrModel, s.hdrSource, s.hdrEvents, s.hdrTotal, s.hdrInput, s.hdrOutput, s.hdrCost],
      report.byModel.slice(0, 12).map((r) => [
        r.model, r.source, fmtInt(r.eventCount),
        fmtToken(r.totalTokens), fmtToken(r.inputTokens),
        fmtToken(r.outputTokens), fmtUsd(r.estimatedCostUsd, true),
      ]),
      ['left', 'left', 'right', 'right', 'right', 'right', 'right'],
    ));
  }

  // Pricing Notes (detail only)
  if (opts.detail && report.pricingWarnings.length > 0) {
    lines.push('');
    lines.push(s.pricingNotes);
    for (const w of report.pricingWarnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join('\n');
}

// ── Helpers ──

function getRangeLabel(range: string, lang: Lang): string {
  const s = t(lang);
  switch (range) {
    case '7d': return s.rangeLast7d;
    case '1m': return s.rangeLast1m;
    case '3m': return s.rangeLast3m;
    case 'all': return s.rangeAll;
    default: return range;
  }
}

function renderTable(
  headers: string[],
  rows: string[][],
  aligns: Array<'left' | 'right'>,
): string {
  if (rows.length === 0) return '(no data)';

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );

  const fmtRow = (row: string[]) =>
    row
      .map((val, i) => {
        const cell = val ?? '';
        return aligns[i] === 'right'
          ? cell.padStart(widths[i])
          : cell.padEnd(widths[i]);
      })
      .join('  ');

  const divider = widths.map((w) => '\u2500'.repeat(w)).join('  ');
  return [fmtRow(headers), divider, ...rows.map(fmtRow)].join('\n');
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtToken(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1_000) return fmtInt(n);
  if (abs < 1_000_000) return fmtCompact(n / 1_000, 'K');
  if (abs < 1_000_000_000) return fmtCompact(n / 1_000_000, 'M');
  return fmtCompact(n / 1_000_000_000, 'B');
}

function fmtCompact(value: number, suffix: string): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : 2;
  const text = value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  return `${text}${suffix}`;
}

function fmtUsd(value: number, detail: boolean): string {
  return `$${value.toFixed(detail ? 4 : 2)}`;
}

function fmtDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function stripAnsi(str: string): string {
  // Simple passthrough for title underline length calculation
  return str;
}
