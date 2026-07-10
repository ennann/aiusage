import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from './ui/chart';
import type { OverviewPayload } from '../hooks/use-overview';
import { getChartColors, providerLabel } from '../constants';
import { formatUsd, formatUsdFull, shortDate, longDate } from '../utils/format';
import { pivotProviderTrend } from '../utils/data';
import { EmptyState, ChartLegend } from './chart-helpers';
import { useIsDark } from '../hooks/use-dark';
import type { CurrencyMode } from '../hooks/use-cny-rate';

export function CostTrendChart({
  data,
  providerTrend,
  currency = 'auto',
}: {
  data: OverviewPayload['dailyTrend'];
  providerTrend: OverviewPayload['providerDailyTrend'];
  currency?: CurrencyMode;
}) {
  const isDark = useIsDark();
  if (!data.length) return <EmptyState label="No data" />;

  const { data: pivoted, providers } = useMemo(
    () => pivotProviderTrend(data, providerTrend),
    [data, providerTrend],
  );

  const barW = data.length <= 7 ? 94 : data.length <= 30 ? 47 : 20;
  const colors = getChartColors(isDark);

  const config = Object.fromEntries(
    providers.map((p, i) => [p, { label: providerLabel(p), color: colors[i % colors.length] }]),
  ) satisfies ChartConfig;

  return (
    <>
      <ChartContainer config={config} className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pivoted} margin={{ top: 12, left: 4, right: 12, bottom: 0 }} barSize={barW}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-white/[0.06]" />
            <XAxis
              dataKey="usageDate" tickLine={false} axisLine={false}
              tickMargin={12} tickFormatter={shortDate} minTickGap={36}
              className="fill-slate-400 dark:fill-slate-500" fontSize={11}
            />
            <YAxis
              tickLine={false} axisLine={false} width={48} tickMargin={8}
              tickFormatter={(v) => formatUsd(Number(v), currency)} className="fill-slate-400 dark:fill-slate-500" fontSize={11}
            />
            <ChartTooltip
              cursor={{ fill: isDark ? 'rgba(51,65,85,0.3)' : '#f8fafc' }}
              content={
                <ChartTooltipContent
                  labelFormatter={longDate}
                  formatter={(v) => formatUsdFull(Number(v), currency)}
                />
              }
            />
            {providers.map((p, i) => (
              <Bar
                key={p}
                dataKey={p}
                stackId="cost"
                fill={colors[i % colors.length]}
                radius={i === providers.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
      {providers.length > 1 && (
        <ChartLegend
          items={providers.map((p, i) => ({
            label: providerLabel(p),
            color: colors[i % colors.length],
          }))}
        />
      )}
    </>
  );
}
