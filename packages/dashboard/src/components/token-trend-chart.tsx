import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from './ui/chart';
import type { OverviewPayload } from '../hooks/use-overview';
import type { Locale } from '../i18n';
import { TOKEN_SERIES, TOKEN_CONFIG } from '../constants';
import { formatCompact, formatNumber, shortDate, longDate } from '../utils/format';
import { EmptyState } from './chart-helpers';

export function TokenTrendChart({ data, locale }: { data: OverviewPayload['tokenComposition']; locale: Locale }) {
  if (!data.length) return <EmptyState label="No data" />;
  return (
    <ChartContainer config={TOKEN_CONFIG} className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, left: 4, right: 12, bottom: 0 }}>
          <CartesianGrid vertical={false} className="stroke-slate-100 dark:stroke-slate-800" />
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
            cursor={{ stroke: '#e2e8f0' }}
            content={
              <ChartTooltipContent
                labelFormatter={longDate}
                formatter={(v) => formatNumber(Number(v))}
              />
            }
          />
          {TOKEN_SERIES.map((s) => (
            <Area
              key={s.key} dataKey={s.key} type="monotone" stackId="tok"
              fill={s.color} fillOpacity={0.85} stroke={s.color} strokeWidth={0.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
