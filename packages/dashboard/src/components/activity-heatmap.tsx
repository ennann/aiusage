import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../i18n';
import { useIsDark } from '../hooks/use-dark';
import type { ActivityHeatmapDay } from '../utils/activity-heatmap-data';

// ── 常量 ──

const CELL = 13;  // 格子固定尺寸 px
const GAP = 3;    // 间距 px
const STEP = CELL + GAP;
const DAYS = 7;
const DAY_LABEL_W = 34;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GAMMA = 0.7;
const MONTH_ROW = 22;
const LEGEND_ROW = 34;
const MAX_WEEKS = 53;
// Less(~22px) gap 5格 gap More(~26px)
const LEGEND_W = 22 + GAP + 5 * STEP - GAP + GAP + 26;

// ── 颜色配置 ──

const LIGHT_LEVELS = ['#ebedf0', '#fdba74', '#f97316', '#c2410c', '#7c2d12'];
const DARK_LEVELS  = ['#161b22', '#431407', '#c2410c', '#f97316', '#fed7aa'];
const LIGHT_CELL_STROKE = 'rgba(27, 31, 36, 0.06)';
const DARK_CELL_STROKE = 'rgba(240, 246, 252, 0.04)';

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

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
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

export function ActivityHeatmap({ days, metricLabel = 'tokens', locale = 'en', className = '' }: {
  days: ActivityHeatmapDay[];
  metricLabel?: 'tokens' | 'sessions';
  locale?: Locale;
  className?: string;
}) {
  const isDark = useIsDark();
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const containerWidth = useContainerWidth(containerRef);

  // GitHub 风格：固定展示近一年 53 周，不跟随容器拉伸。
  const weeks = MAX_WEEKS;

  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    date: string; activityValue: number; cost: number;
  } | null>(null);

  const { grid, monthMarks, maxActivity, activeDays, streak, longestStreak, totalActivity } = useMemo(() => {
    const byDate = new Map<string, ActivityHeatmapDay>();
    for (const d of days) byDate.set(d.usageDate, d);

    // 右侧固定对齐今天所在周的周六
    const today = new Date();
    const dayOfWeek = today.getDay();
    const endDate = addDays(today, 6 - dayOfWeek);
    const startDate = addDays(endDate, -(weeks * DAYS - 1));

    const startStr = toDateStr(startDate);
    const endStr = toDateStr(endDate);
    const visibleDays = days.filter(d => d.usageDate >= startStr && d.usageDate <= endStr);

    const maxActivity = Math.max(0, ...visibleDays.map(d => d.activityValue));
    const totalActivity = visibleDays.reduce((s, d) => s + d.activityValue, 0);
    const activeDays = visibleDays.filter(d => d.activityValue > 0).length;

    let streak = 0;
    for (let i = 0; i < weeks * DAYS; i++) {
      const ds = toDateStr(addDays(today, -i));
      const d = byDate.get(ds);
      if (!d || d.activityValue === 0) break;
      streak++;
    }

    let longestStreak = 0;
    let run = 0;
    for (let i = 0; i < weeks * DAYS; i++) {
      const date = addDays(startDate, i);
      if (date > today) break;
      const d = byDate.get(toDateStr(date));
      if (d && d.activityValue > 0) {
        run++;
        longestStreak = Math.max(longestStreak, run);
      } else {
        run = 0;
      }
    }

    const grid: Array<Array<{ dateStr: string; data?: ActivityHeatmapDay }>> = [];
    const monthMarks: Array<{ weekIdx: number; label: string }> = [];
    let lastMarkedMonth = -1;

    for (let w = 0; w < weeks; w++) {
      const col: Array<{ dateStr: string; data?: ActivityHeatmapDay }> = [];
      let monthToMark = -1;

      for (let d = 0; d < DAYS; d++) {
        const date = addDays(startDate, w * DAYS + d);
        const ds = toDateStr(date);
        col.push({ dateStr: ds, data: byDate.get(ds) });
        if (w > 0 && date.getDate() === 1) {
          monthToMark = date.getMonth();
        }
      }

      if (monthToMark !== -1 && monthToMark !== lastMarkedMonth) {
        monthMarks.push({ weekIdx: w, label: MONTH_LABELS[monthToMark] });
        lastMarkedMonth = monthToMark;
      }

      grid.push(col);
    }

    return { grid, monthMarks, maxActivity, activeDays, streak, longestStreak, totalActivity };
  }, [days, weeks]);

  // 内容宽度（格子部分，左对齐内坐标）
  const svgInnerW = weeks * STEP - GAP;
  const svgW = DAY_LABEL_W + svgInnerW;
  const svgH = DAYS * STEP - GAP;
  const totalH = MONTH_ROW + svgH + LEGEND_ROW;
  const legendX = Math.max(DAY_LABEL_W, svgW - LEGEND_W);
  const tooltipMaxX = Math.max(0, (rootRef.current?.clientWidth ?? containerWidth) - 130);
  let lastMonthLabelX = -Infinity;
  const monthLabelMarks = monthMarks.map((mark) => {
    const x = Math.max(mark.weekIdx * STEP, lastMonthLabelX + 32);
    lastMonthLabelX = x;
    return { ...mark, x };
  });
  const dayUnit = locale === 'zh' ? '天' : 'd';
  const currentStreakLabel = locale === 'zh' ? '当前连续天数' : 'Current streak';
  const longestStreakLabel = locale === 'zh' ? '最长连续天数' : 'Longest streak';
  const activeDaysLabel = locale === 'zh' ? '活跃天数' : 'active days';
  const totalLabel = locale === 'zh'
    ? `${metricLabel === 'tokens' ? 'tokens' : 'sessions'} total`
    : `${metricLabel} total`;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || hasAutoScrolledRef.current || containerWidth <= 0) return;
    if (el.scrollWidth > el.clientWidth) {
      el.scrollLeft = el.scrollWidth;
    }
    hasAutoScrolledRef.current = true;
  }, [containerWidth, svgW]);

  return (
    <div ref={rootRef} className={`relative grid gap-5 lg:grid-cols-[150px_minmax(0,1fr)] lg:items-center ${className}`}>
      <div className="grid grid-cols-2 gap-3 border-b border-slate-100 pb-4 dark:border-white/[0.08] lg:flex lg:flex-col lg:gap-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
        <div className="min-w-0 rounded-lg bg-slate-50/70 px-3 py-3 dark:bg-white/[0.04] lg:bg-transparent lg:p-0 lg:dark:bg-transparent">
          <div className="text-[28px] font-bold leading-none tracking-tight text-slate-900 dark:text-slate-100">
            {streak} <span className="text-base font-semibold text-slate-400 dark:text-slate-500">{dayUnit}</span>
          </div>
          <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{currentStreakLabel}</div>
        </div>
        <div className="min-w-0 rounded-lg bg-slate-50/70 px-3 py-3 dark:bg-white/[0.04] lg:bg-transparent lg:p-0 lg:dark:bg-transparent">
          <div className="text-[28px] font-bold leading-none tracking-tight text-slate-900 dark:text-slate-100">
            {longestStreak} <span className="text-base font-semibold text-slate-400 dark:text-slate-500">{dayUnit}</span>
          </div>
          <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{longestStreakLabel}</div>
        </div>
      </div>

      <div className="min-w-0">
        {/* 统计摘要 */}
        <div className="mb-3 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{activeDays}</span> {activeDaysLabel}
          </span>
          <span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtCompact(totalActivity)}</span> {totalLabel}
          </span>
        </div>

        {/* SVG 热力图 */}
        <div ref={containerRef} className="scrollbar-hide relative w-full overflow-x-auto pb-1">
          {containerWidth > 0 && (
            <svg
              width={svgW}
              height={totalH}
              style={{ display: 'block' }}
              aria-label="Activity heatmap"
            >
              {/* 星期标签 */}
              {[1, 3, 5].map((dayIdx) => (
                <text
                  key={dayIdx}
                  x={DAY_LABEL_W - 6}
                  y={MONTH_ROW + dayIdx * STEP + CELL / 2}
                  fontSize={11}
                  fill={isDark ? '#8b949e' : '#57606a'}
                  fontFamily="system-ui, sans-serif"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {dayIdx === 1 ? 'Mon' : dayIdx === 3 ? 'Wed' : 'Fri'}
                </text>
              ))}

              <g transform={`translate(${DAY_LABEL_W}, 0)`}>
                {/* 月份标签 */}
                {monthLabelMarks.map(({ weekIdx, label, x }) => (
                  <text
                    key={label + weekIdx}
                    x={x}
                    y={MONTH_ROW - 4}
                    fontSize={10}
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
                      const activityValue = data?.activityValue ?? 0;
                      const cost = data?.estimatedCostUsd ?? 0;
                      const fill = colorForValue(activityValue, maxActivity, isDark);
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
                          stroke={isDark ? DARK_CELL_STROKE : LIGHT_CELL_STROKE}
                          strokeWidth={1}
                          style={{ cursor: activityValue > 0 ? 'pointer' : 'default' }}
                          onMouseEnter={() => {
                            const scrollLeft = containerRef.current?.scrollLeft ?? 0;
                            const containerRect = containerRef.current?.getBoundingClientRect();
                            const rootRect = rootRef.current?.getBoundingClientRect();
                            const originX = containerRect && rootRect ? containerRect.left - rootRect.left : 0;
                            const originY = containerRect && rootRect ? containerRect.top - rootRect.top : 0;
                            setTooltip({
                              x: originX + DAY_LABEL_W + x + CELL / 2 - scrollLeft,
                              y: originY + MONTH_ROW + y,
                              date: dateStr,
                              activityValue,
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

              {/* 图例：右下角，贴近 GitHub contribution graph */}
              <g transform={`translate(${legendX}, ${totalH - LEGEND_ROW + 10})`}>
                <text x={0} y={10} fontSize={10} fill={isDark ? '#8b949e' : '#57606a'} fontFamily="system-ui, sans-serif">Less</text>
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
                      stroke={isDark ? DARK_CELL_STROKE : LIGHT_CELL_STROKE}
                      strokeWidth={1}
                    />
                  );
                })}
                <text x={24 + 5 * STEP} y={10} fontSize={10} fill={isDark ? '#8b949e' : '#57606a'} fontFamily="system-ui, sans-serif">More</text>
              </g>
            </svg>
          )}

        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-slate-700 dark:bg-[#1a1a1a]"
          style={{
            left: Math.min(Math.max(tooltip.x, 0), tooltipMaxX),
            top: tooltip.y - 52,
          }}
        >
          <div className="font-medium text-slate-700 dark:text-slate-200">{tooltip.date}</div>
          {tooltip.activityValue > 0 ? (
            <>
              <div className="text-slate-500 dark:text-slate-400">{fmtCompact(tooltip.activityValue)} {metricLabel}</div>
              {metricLabel === 'tokens' && (
                <div className="text-slate-500 dark:text-slate-400">${tooltip.cost.toFixed(4)}</div>
              )}
            </>
          ) : (
            <div className="text-slate-400 dark:text-slate-500">No activity</div>
          )}
        </div>
      )}

      {/* 空状态 */}
      {days.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">No activity data in the past year.</p>
      )}
    </div>
  );
}
