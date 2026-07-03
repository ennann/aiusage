import { useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from './ui/chart';
import type { OverviewPayload } from '../hooks/use-overview';
import type { Locale } from '../i18n';
import { TOKEN_SERIES, getTokenConfig, getTokenColor } from '../constants';
import { formatCompact, formatTokens, shortDate, longDate } from '../utils/format';
import { EmptyState } from './chart-helpers';
import { useIsDark } from '../hooks/use-dark';

type TokenLegendItem = {
  key: typeof TOKEN_SERIES[number]['key'];
  label: string;
  color: string;
  value: string;
};

export function TokenTrendChart({
  data,
  locale,
  totalLabel = 'Total',
  legendItems = [],
}: {
  data: OverviewPayload['tokenComposition'];
  locale: Locale;
  totalLabel?: string;
  legendItems?: TokenLegendItem[];
}) {
  const isDark = useIsDark();
  const [activeKey, setActiveKey] = useState<TokenLegendItem['key'] | null>(null);
  if (!data.length) return <EmptyState label="No data" />;
  return (
    <div>
      <ChartContainer config={getTokenConfig(isDark)} className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, left: 4, right: 12, bottom: 0 }}>
            <CartesianGrid vertical={false} className="stroke-slate-100 dark:stroke-white/[0.06]" />
            <XAxis
              dataKey="usageDate" tickLine={false} axisLine={false}
              tickMargin={12} tickFormatter={shortDate} minTickGap={36}
              className="fill-slate-400 dark:fill-slate-500" fontSize={11}
            />
            <YAxis
              tickLine={false} axisLine={false} width={52} tickMargin={8}
              tickFormatter={(v) => formatCompact(Number(v), locale)} className="fill-slate-400 dark:fill-slate-500" fontSize={11}
            />
            <ChartTooltip
              cursor={{ stroke: isDark ? '#334155' : '#e2e8f0' }}
              content={
                <ChartTooltipContent
                  labelFormatter={longDate}
                  formatter={(v) => formatTokens(Number(v), locale)}
                  showTotal
                  totalLabel={totalLabel}
                  totalFormatter={(v) => formatTokens(v, locale)}
                />
              }
            />
            {TOKEN_SERIES.map((s) => {
              const color = getTokenColor(s, isDark);
              const isActive = activeKey === s.key;
              const isDimmed = activeKey !== null && !isActive;
              return (
                <Area
                  key={s.key} dataKey={s.key} type="bump" stackId="tok"
                  fill={color}
                  fillOpacity={isDimmed ? 0.08 : isActive ? 0.92 : 0.85}
                  stroke={color}
                  strokeOpacity={isDimmed ? 0.12 : 1}
                  strokeWidth={isActive ? 1.6 : 0.5}
                  isAnimationActive={false}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>

      {legendItems.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {legendItems.map((item) => {
            const isActive = activeKey === item.key;
            const isDimmed = activeKey !== null && !isActive;
            return (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => setActiveKey(item.key)}
                onMouseLeave={() => setActiveKey(null)}
                onFocus={() => setActiveKey(item.key)}
                onBlur={() => setActiveKey(null)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-all duration-150 ${
                  isActive
                    ? 'border-slate-300 bg-slate-50 text-slate-900 shadow-sm dark:border-slate-600 dark:bg-white/[0.06] dark:text-slate-200'
                    : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-400 dark:hover:border-white/[0.08] dark:hover:bg-white/[0.04]'
                } ${isDimmed ? 'opacity-45' : 'opacity-100'}`}
                aria-label={`${item.label}${item.value ? ` ${item.value}` : ''}`}
              >
                <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
                {item.value && <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{item.value}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
