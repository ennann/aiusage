import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from './ui/chart';
import type { OverviewPayload } from '../hooks/use-overview';
import type { Locale } from '../i18n';
import { TOKEN_SERIES, TOKEN_CONFIG } from '../constants';
import { formatCompact, formatNumber, shortDate, longDate } from '../utils/format';
import { EmptyState } from './chart-helpers';

export function TokenCompositionChart({ data, locale }: { data: OverviewPayload['tokenComposition']; locale: Locale }) {
  if (!data.length) return <EmptyState label="No data" />;
  const barW = data.length <= 7 ? 52 : data.length <= 30 ? 26 : 11;
  return (
    <ChartContainer config={TOKEN_CONFIG} className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, left: 4, right: 12, bottom: 0 }} barSize={barW}>
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
            cursor={{ fill: '#f8fafc' }}
            content={
              <ChartTooltipContent
                labelFormatter={longDate}
                formatter={(v) => formatNumber(Number(v))}
              />
            }
          />
          {TOKEN_SERIES.map((s, i) => (
            <Bar
              key={s.key} dataKey={s.key} stackId="tok" fill={s.color}
              radius={i === TOKEN_SERIES.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
