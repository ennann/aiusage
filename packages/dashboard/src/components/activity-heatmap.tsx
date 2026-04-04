import { useEffect, useMemo, useRef, useState } from 'react';
import type { HeatmapDay } from '@aiusage/shared';
import { useIsDark } from '../hooks/use-dark';

// ── 常量 ──

const CELL = 11;  // 格子固定尺寸 px
const GAP = 2;    // 间距 px
const STEP = CELL + GAP;
const DAYS = 7;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GAMMA = 0.7;
const MONTH_ROW = 14;
const LEGEND_ROW = 20;
// Less(~22px) gap 5格 gap More(~26px)
const LEGEND_W = 22 + GAP + 5 * STEP - GAP + GAP + 26;

// ── 颜色配置 ──

const LIGHT_LEVELS = ['#ebedf0', '#fdba74', '#f97316', '#c2410c', '#7c2d12'];
const DARK_LEVELS  = ['#161b22', '#431407', '#c2410c', '#f97316', '#fed7aa'];

function colorForValue(value: number, max: number, isDark: boolean): string {
  const levels = isDark ? DARK_LEVELS : LIGHT_LEVELS;
  if (value <= 0 || max <= 0) return levels[0];
  const ratio = Math.pow(value / max, GAMMA);
  const idx = Math.max(1, Math.min(4, Math.ceil(ratio * 4)));
  return levels[idx];
}

// ── 日期工具 ──

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ── 数字格式 ──

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── 监听容器宽度 ──

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    // 立即取一次，再监听变化
    setWidth(Math.floor(ref.current.getBoundingClientRect().width));
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.floor(w));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ── 主组件 ──

export function ActivityHeatmap({ days, className = '' }: {
  days: HeatmapDay[];
  className?: string;
}) {
  const isDark = useIsDark();
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);

  // 由容器宽度决定列数（至少 4 列）
  const weeks = containerWidth > 0 ? Math.max(4, Math.floor(containerWidth / STEP)) : 53;

  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    date: string; tokens: number; cost: number;
  } | null>(null);

  const { grid, monthMarks, maxTokens, activeDays, streak, totalTokens } = useMemo(() => {
    const byDate = new Map<string, HeatmapDay>();
    for (const d of days) byDate.set(d.usageDate, d);

    // 右侧固定对齐今天所在周的周六
    const today = new Date();
    const dayOfWeek = today.getDay();
    const endDate = addDays(today, 6 - dayOfWeek);
    const startDate = addDays(endDate, -(weeks * DAYS - 1));

    const startStr = toDateStr(startDate);
    const endStr = toDateStr(endDate);
    const visibleDays = days.filter(d => d.usageDate >= startStr && d.usageDate <= endStr);

    const maxTokens = Math.max(0, ...visibleDays.map(d => d.totalTokens));
    const totalTokens = visibleDays.reduce((s, d) => s + d.totalTokens, 0);
    const activeDays = visibleDays.filter(d => d.totalTokens > 0).length;

    let streak = 0;
    for (let i = 0; i < weeks * DAYS; i++) {
      const ds = toDateStr(addDays(today, -i));
      const d = byDate.get(ds);
      if (!d || d.totalTokens === 0) break;
      streak++;
    }

    const grid: Array<Array<{ dateStr: string; data?: HeatmapDay }>> = [];
    const monthMarks: Array<{ weekIdx: number; label: string }> = [];
    let lastMonth = -1;

    for (let w = 0; w < weeks; w++) {
      const col: Array<{ dateStr: string; data?: HeatmapDay }> = [];
      for (let d = 0; d < DAYS; d++) {
        const date = addDays(startDate, w * DAYS + d);
        const ds = toDateStr(date);
        col.push({ dateStr: ds, data: byDate.get(ds) });
        if (date.getDate() === 1 && date.getMonth() !== lastMonth) {
          monthMarks.push({ weekIdx: w, label: MONTH_LABELS[date.getMonth()] });
          lastMonth = date.getMonth();
        }
      }
      grid.push(col);
    }

    return { grid, monthMarks, maxTokens, activeDays, streak, totalTokens };
  }, [days, weeks]);

  // 内容宽度（格子部分，左对齐内坐标）
  const svgInnerW = weeks * STEP - GAP;
  const svgH = DAYS * STEP - GAP;
  const totalH = MONTH_ROW + svgH + LEGEND_ROW;

  // 右对齐偏移：让最新一列（最右格子）始终贴近容器右边
  const offsetX = containerWidth > 0 ? containerWidth - svgInnerW : 0;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* 统计摘要 */}
      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{activeDays}</span> active days
        </span>
        <span>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{streak}</span> day streak
        </span>
        <span>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtTokens(totalTokens)}</span> tokens total
        </span>
      </div>

      {/* SVG 热力图 */}
      <div ref={containerRef} className="relative w-full">
        {containerWidth > 0 && (
          <svg
            width={containerWidth}
            height={totalH}
            style={{ display: 'block' }}
            aria-label="Activity heatmap"
          >
            {/* 所有格子内容右对齐 */}
            <g transform={`translate(${offsetX}, 0)`}>
              {/* 月份标签 */}
              {monthMarks.map(({ weekIdx, label }) => (
                <text
                  key={label + weekIdx}
                  x={weekIdx * STEP}
                  y={MONTH_ROW - 4}
                  fontSize={9}
                  fill={isDark ? '#8b949e' : '#57606a'}
                  fontFamily="system-ui, sans-serif"
                >
                  {label}
                </text>
              ))}

              {/* 格子 */}
              <g transform={`translate(0, ${MONTH_ROW})`}>
                {grid.map((col, wi) =>
                  col.map(({ dateStr, data }, di) => {
                    const tokens = data?.totalTokens ?? 0;
                    const cost = data?.estimatedCostUsd ?? 0;
                    const fill = colorForValue(tokens, maxTokens, isDark);
                    const x = wi * STEP;
                    const y = di * STEP;
                    return (
                      <rect
                        key={dateStr}
                        x={x}
                        y={y}
                        width={CELL}
                        height={CELL}
                        rx={2}
                        fill={fill}
                        style={{ cursor: tokens > 0 ? 'pointer' : 'default' }}
                        onMouseEnter={() => {
                          setTooltip({
                            x: offsetX + x + CELL / 2,
                            y: MONTH_ROW + y,
                            date: dateStr,
                            tokens,
                            cost,
                          });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    );
                  })
                )}
              </g>
            </g>

            {/* 图例：右下角，基于 containerWidth 定位，不参与 offsetX */}
            <g transform={`translate(${containerWidth - LEGEND_W}, ${totalH - LEGEND_ROW + 4})`}>
              <text x={0} y={9} fontSize={9} fill={isDark ? '#8b949e' : '#57606a'} fontFamily="system-ui, sans-serif">Less</text>
              {[0, 1, 2, 3, 4].map((lvl) => {
                const levels = isDark ? DARK_LEVELS : LIGHT_LEVELS;
                return (
                  <rect
                    key={lvl}
                    x={24 + lvl * STEP}
                    y={0}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={levels[lvl]}
                  />
                );
              })}
              <text x={24 + 5 * STEP} y={9} fontSize={9} fill={isDark ? '#8b949e' : '#57606a'} fontFamily="system-ui, sans-serif">More</text>
            </g>
          </svg>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-slate-700 dark:bg-[#1a1a1a]"
            style={{
              left: Math.min(tooltip.x, containerWidth - 130),
              top: tooltip.y - 52,
            }}
          >
            <div className="font-medium text-slate-700 dark:text-slate-200">{tooltip.date}</div>
            {tooltip.tokens > 0 ? (
              <>
                <div className="text-slate-500 dark:text-slate-400">{fmtTokens(tooltip.tokens)} tokens</div>
                <div className="text-slate-500 dark:text-slate-400">${tooltip.cost.toFixed(4)}</div>
              </>
            ) : (
              <div className="text-slate-400 dark:text-slate-500">No activity</div>
            )}
          </div>
        )}
      </div>

      {/* 空状态 */}
      {days.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">No activity data in the past year.</p>
      )}
    </div>
  );
}
