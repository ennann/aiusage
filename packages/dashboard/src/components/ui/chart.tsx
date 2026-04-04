import * as React from 'react';
import { Tooltip, type TooltipProps } from 'recharts';
import { cn } from '../../lib/utils';

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    color?: string;
  }
>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart(): { config: ChartConfig } {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('Chart components must be used inside <ChartContainer />');
  }
  return context;
}

export function ChartContainer({
  config,
  className,
  children,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  config: ChartConfig;
}): React.JSX.Element {
  const cssVariables = Object.fromEntries(
    Object.entries(config).flatMap(([key, value]) => (value.color ? [[`--color-${key}`, value.color]] : [])),
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        className={cn(
          'w-full [contain:inline-size] tabular-nums text-xs [&_.recharts-cartesian-axis-tick_text]:fill-slate-500 [&_.recharts-cartesian-grid_horizontal_line]:stroke-slate-200/80 [&_.recharts-cartesian-grid_vertical_line]:stroke-slate-200/60 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-slate-300 [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-slate-100/70 [&_.recharts-reference-line_line]:stroke-slate-300 [&_.recharts-sector:focus]:outline-none [&_.recharts-surface]:overflow-visible',
          className,
        )}
        style={{ ...cssVariables, ...style }}
        {...props}
      >
        {children}
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = Tooltip;

interface ChartTooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: TooltipProps<number, string>['active'];
  payload?: TooltipProps<number, string>['payload'];
  label?: TooltipProps<number, string>['label'];
  hideLabel?: boolean;
  indicator?: 'dot' | 'line';
  labelFormatter?: (label: string) => React.ReactNode;
  formatter?: (value: number | string, name: string) => React.ReactNode;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
  indicator = 'dot',
  labelFormatter,
  formatter,
  className,
  ...props
}: ChartTooltipContentProps): React.JSX.Element | null {
  const { config } = useChart();

  if (!active || !payload?.length) return null;

  return (
    <div
      className={cn(
        'min-w-[188px] rounded-2xl border border-slate-200/90 bg-white/96 px-3.5 py-3 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur dark:border-white/10 dark:bg-[#1a1a1a]/96 dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]',
        className,
      )}
      {...props}
    >
      {!hideLabel && label != null ? (
        <div className="mb-2 text-[11px] font-semibold tracking-[0.02em] text-slate-950 dark:text-slate-300">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </div>
      ) : null}
      <div className="grid gap-2">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? 'value');
          const itemConfig = config[key];
          const tone = item.color ?? item.stroke ?? itemConfig?.color ?? 'currentColor';
          const itemLabel = itemConfig?.label ?? item.name ?? key;

          return (
            <div key={`${key}-${item.value}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
              <span
                className={cn('rounded-full bg-current', indicator === 'line' ? 'h-2 w-6' : 'h-2.5 w-2.5')}
                style={{ color: tone }}
              />
              <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{itemLabel}</span>
              <span className="text-[11px] font-semibold text-slate-950 dark:text-slate-300">
                {formatter ? formatter(item.value ?? 0, String(itemLabel)) : String(item.value ?? 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
