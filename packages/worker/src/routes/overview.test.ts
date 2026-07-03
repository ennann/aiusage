import { describe, expect, it } from 'vitest';
import { buildActivityWhere, emptyInteractionMetrics, type DashboardFilters } from './overview';

function filters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return {
    minDate: '2026-07-01',
    range: '30d',
    deviceId: null,
    provider: null,
    product: null,
    channel: null,
    model: null,
    project: null,
    ...overrides,
  };
}

describe('overview activity metrics helpers', () => {
  it('builds activity filters using daily_activity_breakdown columns', () => {
    const where = buildActivityWhere(filters({
      deviceId: 'joes-macbook-pro-local',
      provider: 'kiro',
      product: 'kiro',
      project: 'Project F8A64F',
    }));

    expect(where.whereClause).toBe(
      'WHERE a.usage_date >= ? AND a.device_id = ? AND a.provider = ? AND a.product = ? AND COALESCE(a.project_alias, a.project_display) = ?',
    );
    expect(where.params).toEqual([
      '2026-07-01',
      'joes-macbook-pro-local',
      'kiro',
      'kiro',
      'Project F8A64F',
    ]);
  });

  it('returns no activity rows when channel/model filters cannot apply to activity metrics', () => {
    const where = buildActivityWhere(filters({
      channel: 'ide',
      model: 'claude-fable-5',
    }));

    expect(where.whereClause).toContain('1 = 0');
    expect(where.params).toEqual(['2026-07-01']);
  });

  it('provides a stable empty payload when the activity table is absent', () => {
    expect(emptyInteractionMetrics()).toEqual({
      exactCount: 0,
      proxyCount: 0,
      userMessageCount: 0,
      functionCallCount: 0,
      toolCallCount: 0,
      skillCallCount: 0,
      skillProxyCount: 0,
      subagentCount: 0,
      topTools: [],
      topSkills: [],
      topAgents: [],
      kindShare: [],
    });
  });
});
