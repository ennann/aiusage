import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from './ui/chart';
import type { OverviewPayload } from '../hooks/use-overview';
import type { Locale } from '../i18n';
import { TOKEN_SERIES, getTokenConfig, getTokenColor } from '../constants';
import { formatCompact, formatNumber, shortDate, longDate } from '../utils/format';
import { EmptyState } from './chart-helpers';
import { useIsDark } from '../hooks/use-dark';

export function TokenTrendChart({ data, locale }: { data: OverviewPayload['tokenComposition']; locale: Locale }) {
  const isDark = useIsDark();
  if (!data.length) return <EmptyState label="No data" />;
  return (
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
                formatter={(v) => formatNumber(Number(v))}
              />
            }
          />
          {TOKEN_SERIES.map((s) => {
            const color = getTokenColor(s, isDark);
            return (
              <Area
                key={s.key} dataKey={s.key} type="bump" stackId="tok"
                fill={color} fillOpacity={0.85} stroke={color} strokeWidth={0.5}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
