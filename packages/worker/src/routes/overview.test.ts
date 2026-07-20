import { describe, expect, it } from 'vitest';
import { buildDateWindow, buildWhere, parseFilters } from './overview';

describe('overview filters', () => {
  it('builds inclusive date windows that include today without adding an extra day', () => {
    const now = new Date('2026-07-20T10:00:00.000Z');

    expect(buildDateWindow('7d', now)).toEqual({
      minDate: '2026-07-14',
      maxDate: '2026-07-20',
      days: 7,
    });
    expect(buildDateWindow('30d', now)).toEqual({
      minDate: '2026-06-21',
      maxDate: '2026-07-20',
      days: 30,
    });
    expect(buildDateWindow('month', now)).toEqual({
      minDate: '2026-07-01',
      maxDate: '2026-07-20',
      days: 20,
    });
  });

  it('parses repeated and comma-separated facet params as multi-select values', () => {
    const filters = parseFilters(new URL('https://example.com/api/v1/public/overview?range=30d&product=codex&product=claude-code&model=gpt-5,claude-opus'));

    expect(filters?.product).toEqual(['codex', 'claude-code']);
    expect(filters?.model).toEqual(['gpt-5', 'claude-opus']);
  });

  it('builds IN clauses for multi-selected facets', () => {
    const filters = parseFilters(new URL('https://example.com/api/v1/public/overview?range=7d&deviceId=mac-a&deviceId=mac-b&project=AIUsage'))!;
    const where = buildWhere(filters);

    expect(where.whereClause).toContain('b.device_id IN (?, ?)');
    expect(where.whereClause).toContain('COALESCE(b.project_alias, b.project_display) = ?');
    expect(where.params).toEqual([expect.any(String), expect.any(String), 'mac-a', 'mac-b', 'AIUsage']);
  });
});
