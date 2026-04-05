import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityHeatmapData } from './activity-heatmap-data';

test('uses daily event counts for event-only products when token data is unavailable', () => {
  const result = buildActivityHeatmapData({
    heatmap: [
      { usageDate: '2026-04-01', totalTokens: 0, estimatedCostUsd: 0 },
      { usageDate: '2026-04-02', totalTokens: 0, estimatedCostUsd: 0 },
    ],
    dailyTrend: [
      { usageDate: '2026-04-01', eventCount: 7, estimatedCostUsd: 0 },
      { usageDate: '2026-04-02', eventCount: 2, estimatedCostUsd: 0 },
    ],
    tokenMetricsUnavailable: true,
  });

  assert.equal(result.metricLabel, 'sessions');
  assert.equal(result.days[0]?.activityValue, 7);
  assert.equal(result.days[1]?.activityValue, 2);
});

test('keeps token values for standard token-bearing products', () => {
  const result = buildActivityHeatmapData({
    heatmap: [
      { usageDate: '2026-04-01', totalTokens: 1200, estimatedCostUsd: 1.25 },
    ],
    dailyTrend: [
      { usageDate: '2026-04-01', eventCount: 3, estimatedCostUsd: 1.25 },
    ],
    tokenMetricsUnavailable: false,
  });

  assert.equal(result.metricLabel, 'tokens');
  assert.equal(result.days[0]?.activityValue, 1200);
  assert.equal(result.days[0]?.estimatedCostUsd, 1.25);
});
