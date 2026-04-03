import { useEffect, useMemo, useRef, useState } from 'react';
import type { HeatmapDay } from '@aiusage/shared';
import { useIsDark } from '../hooks/use-dark';

// ── 常量 ──

const GAP = 2;       // 格子间距 px
const DAYS = 7;
const WEEKS = 53;
const CELL_MIN = 8;  // 最小格子尺寸（约适合 320px 宽）
const CELL_MAX = 14; // 最大格子尺寸
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 由容器宽度反推格子尺寸：保持 53 周，调整 cell 大小
function cellFromWidth(containerWidth: number): number {
  // cell = (width - (WEEKS-1)*GAP) / WEEKS
  const cell = (containerWidth - (WEEKS - 1) * GAP) / WEEKS;
  return Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(cell)));
}

// 监听容器宽度，返回合适的 cell 尺寸
function useContainerCell(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cell, setCell] = useState(11);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setCell(cellFromWidth(width));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return cell;
}

// Gamma 校正让低值也有明显颜色区分
const GAMMA = 0.7;

// ── 颜色配置 ──

const LIGHT_EMPTY = '#ebedf0';
const DARK_EMPTY = '#161b22';

// 橙色系（与 dashboard 主色调一致）
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

// ── 主组件 ──

export function ActivityHeatmap({ days, className = '' }: {
  days: HeatmapDay[];
  className?: string;
}) {
  const isDark = useIsDark();
  const containerRef = useRef<HTMLDivElement>(null);
  const cell = useContainerCell(containerRef);
  const step = cell + GAP;
  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    date: string; tokens: number; cost: number;
  } | null>(null);

  const { grid, monthMarks, maxTokens, activeDays, streak } = useMemo(() => {
    // 构造日期 → 数据 map
    const byDate = new Map<string, HeatmapDay>();
    for (const d of days) byDate.set(d.usageDate, d);

    const maxTokens = Math.max(0, ...days.map(d => d.totalTokens));

    // 以今天为终点，往前推 WEEKS 周
    const today = new Date();
    // 对齐到周日（JS getDay()=0），让今天落在最后一列
    const dayOfWeek = today.getDay(); // 0=Sun,6=Sat
    const endDate = addDays(today, 6 - dayOfWeek); // 推到本周六
    const startDate = addDays(endDate, -(WEEKS * DAYS - 1));

    // grid[week][dayOfWeek] = { dateStr, data? }
    const grid: Array<Array<{ dateStr: string; data?: HeatmapDay }>> = [];
    let monthMarks: Array<{ weekIdx: number; label: string }> = [];
    let lastMonth = -1;

    for (let w = 0; w < WEEKS; w++) {
      const col: Array<{ dateStr: string; data?: HeatmapDay }> = [];
      for (let d = 0; d < DAYS; d++) {
        const date = addDays(startDate, w * DAYS + d);
        const ds = toDateStr(date);
        col.push({ dateStr: ds, data: byDate.get(ds) });
        // 月份标签：每月1号所在列
        if (date.getDate() === 1 && date.getMonth() !== lastMonth) {
          monthMarks.push({ weekIdx: w, label: MONTH_LABELS[date.getMonth()] });
          lastMonth = date.getMonth();
        }
      }
      grid.push(col);
    }

    // 活跃天数
    const activeDays = days.filter(d => d.totalTokens > 0).length;

    // 当前连续天数（从今天往前）
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const ds = toDateStr(addDays(today, -i));
      const d = byDate.get(ds);
      if (!d || d.totalTokens === 0) break;
      streak++;
    }

    return { grid, monthMarks, maxTokens, activeDays, streak };
  }, [days]);

  const svgW = WEEKS * step - GAP;
  const svgH = DAYS * step - GAP;
  const MONTH_ROW = 14;   // 月份标签行高
  const LEGEND_ROW = 20;  // 底部图例行高
  const totalH = MONTH_ROW + svgH + LEGEND_ROW;
  const emptyColor = isDark ? DARK_EMPTY : LIGHT_EMPTY;

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
          <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtTokens(days.reduce((s, d) => s + d.totalTokens, 0))}</span> tokens total
        </span>
      </div>

      {/* SVG 热力图 */}
      <div ref={containerRef} className="relative w-full">
        <svg
          width={svgW}
          height={totalH}
          style={{ display: 'block' }}
          aria-label="Activity heatmap"
        >
          {/* 月份标签 */}
          {monthMarks.map(({ weekIdx, label }) => (
            <text
              key={label + weekIdx}
              x={weekIdx * step}
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
                const x = wi * step;
                const y = di * step;
                return (
                  <rect
                    key={dateStr}
                    x={x}
                    y={y}
                    width={cell}
                    height={cell}
                    rx={2}
                    fill={fill}
                    style={{ cursor: tokens > 0 ? 'pointer' : 'default' }}
                    onMouseEnter={() => {
                      setTooltip({
                        x: x + cell / 2,
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

          {/* 图例 */}
          <g transform={`translate(${svgW - 5 * step - 30}, ${totalH - LEGEND_ROW + 4})`}>
            <text x={0} y={9} fontSize={9} fill={isDark ? '#8b949e' : '#57606a'} fontFamily="system-ui, sans-serif">Less</text>
            {[0, 1, 2, 3, 4].map((lvl) => {
              const levels = isDark ? DARK_LEVELS : LIGHT_LEVELS;
              return (
                <rect
                  key={lvl}
                  x={28 + lvl * step}
                  y={0}
                  width={cell}
                  height={cell}
                  rx={2}
                  fill={levels[lvl]}
                />
              );
            })}
            <text x={28 + 5 * step} y={9} fontSize={9} fill={isDark ? '#8b949e' : '#57606a'} fontFamily="system-ui, sans-serif">More</text>
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-slate-700 dark:bg-[#1a1a1a]"
            style={{
              left: Math.min(tooltip.x, svgW - 130),
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
