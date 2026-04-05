import type { DailyTrendItem, HeatmapDay } from '@aiusage/shared';

export interface ActivityHeatmapDay {
  usageDate: string;
  activityValue: number;
  estimatedCostUsd: number;
  totalTokens: number;
  eventCount: number;
}

export interface ActivityHeatmapData {
  metricLabel: 'tokens' | 'sessions';
  days: ActivityHeatmapDay[];
}

export function buildActivityHeatmapData({
  heatmap,
  dailyTrend,
  tokenMetricsUnavailable,
}: {
  heatmap: HeatmapDay[];
  dailyTrend: DailyTrendItem[];
  tokenMetricsUnavailable: boolean;
}): ActivityHeatmapData {
  const heatmapByDate = new Map(heatmap.map((day) => [day.usageDate, day]));
  const trendByDate = new Map(dailyTrend.map((day) => [day.usageDate, day]));
  const usageDates = Array.from(new Set([
    ...heatmap.map((day) => day.usageDate),
    ...dailyTrend.map((day) => day.usageDate),
  ])).sort();

  const days = usageDates.map((usageDate) => {
    const heat = heatmapByDate.get(usageDate);
    const trend = trendByDate.get(usageDate);
    const totalTokens = heat?.totalTokens ?? 0;
    const eventCount = trend?.eventCount ?? 0;

    return {
      usageDate,
      activityValue: tokenMetricsUnavailable ? eventCount : totalTokens,
      estimatedCostUsd: heat?.estimatedCostUsd ?? trend?.estimatedCostUsd ?? 0,
      totalTokens,
      eventCount,
    };
  });

  return {
    metricLabel: tokenMetricsUnavailable ? 'sessions' : 'tokens',
    days,
  };
}
