import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from './ui/chart';
import { formatUsd, formatUsdFull, formatPercent, arrSum, foldItems } from '../utils/format';
import { EmptyState } from './chart-helpers';

export function ProviderBars({
  data,
}: {
  data: Array<{ label: string; estimatedCostUsd: number }>;
}) {
  if (!data.length) return <EmptyState label="No data" />;
  const max = Math.max(...data.map((d) => d.estimatedCostUsd), 1);
  return (
    <div>
      <h3 className="mb-4 text-[13px] font-semibold text-slate-900 dark:text-slate-100">Provider Share</h3>
      <div className="flex flex-col gap-3">
        {data.map((item) => {
          const pct = (item.estimatedCostUsd / max) * 100;
          return (
            <div key={item.label}>
              <div className="mb-1 flex items-baseline justify-between text-[12px]">
                <span className="font-medium text-slate-700 dark:text-slate-300">{item.label}</span>
                <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{formatUsd(item.estimatedCostUsd)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-slate-800 dark:bg-slate-300 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DonutSection({
  title,
  data,
  colors,
  centerLabel,
}: {
  title: string;
  data: Array<{ label: string; value: string; estimatedCostUsd: number; eventCount: number }>;
  colors: string[];
  centerLabel: string;
}) {
  const sorted = [...data].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  const folded = foldItems(sorted, 6);
  const total = arrSum(folded.map((d) => d.estimatedCostUsd));
  if (!folded.length) return <EmptyState label="No data" />;

  return (
    <div>
      <h3 className="mb-4 text-[13px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
        {/* Ring */}
        <div className="relative shrink-0">
          <ChartContainer config={{}} className="h-[120px] w-[120px] sm:h-[130px] sm:w-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={folded} dataKey="estimatedCostUsd" nameKey="label"
                  innerRadius="62%" outerRadius="86%" paddingAngle={2} stroke="none"
                >
                  {folded.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                </Pie>
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => formatUsdFull(Number(v))} />}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-[13px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">{centerLabel}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 w-full">
          {folded.map((item, i) => {
            const pct = total > 0 ? (item.estimatedCostUsd / total) * 100 : 0;
            return (
              <div key={item.value} className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: colors[i % colors.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{item.label}</span>
                <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">{formatPercent(pct)}</span>
                <span className="shrink-0 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {formatUsd(item.estimatedCostUsd)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
