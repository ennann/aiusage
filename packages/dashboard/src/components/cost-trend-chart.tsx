import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from './ui/chart';
import type { OverviewPayload } from '../hooks/use-overview';
import { CHART_COLORS, providerLabel } from '../constants';
import { formatUsd, formatUsdFull, shortDate, longDate } from '../utils/format';
import { pivotProviderTrend } from '../utils/data';
import { EmptyState, ChartLegend } from './chart-helpers';

export function CostTrendChart({
  data,
  providerTrend,
}: {
  data: OverviewPayload['dailyTrend'];
  providerTrend: OverviewPayload['providerDailyTrend'];
}) {
  if (!data.length) return <EmptyState label="No data" />;

  const { data: pivoted, providers } = useMemo(
    () => pivotProviderTrend(data, providerTrend),
    [data, providerTrend],
  );

  const barW = data.length <= 7 ? 28 : data.length <= 30 ? 14 : 6;

  const config = Object.fromEntries(
    providers.map((p, i) => [p, { label: providerLabel(p), color: CHART_COLORS[i % CHART_COLORS.length] }]),
  ) satisfies ChartConfig;

  return (
    <>
      <ChartContainer config={config} className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pivoted} margin={{ top: 12, left: 4, right: 12, bottom: 0 }} barSize={barW}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
            <XAxis
              dataKey="usageDate" tickLine={false} axisLine={false}
              tickMargin={12} tickFormatter={shortDate} minTickGap={36}
              className="fill-slate-400 dark:fill-slate-500" fontSize={11}
            />
            <YAxis
              tickLine={false} axisLine={false} width={48} tickMargin={8}
              tickFormatter={(v) => formatUsd(Number(v))} className="fill-slate-400 dark:fill-slate-500" fontSize={11}
            />
            <ChartTooltip
              cursor={{ fill: '#f8fafc' }}
              content={
                <ChartTooltipContent
                  labelFormatter={longDate}
                  formatter={(v) => formatUsdFull(Number(v))}
                />
              }
            />
            {providers.map((p, i) => (
              <Bar
                key={p}
                dataKey={p}
                stackId="cost"
                fill={CHART_COLORS[i % CHART_COLORS.length]}
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
            color: CHART_COLORS[i % CHART_COLORS.length],
          }))}
        />
      )}
    </>
  );
}
