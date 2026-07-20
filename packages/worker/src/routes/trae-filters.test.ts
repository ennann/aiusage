import { describe, expect, it } from 'vitest';
import { handleBreakdowns } from './breakdowns.js';
import { buildWhere, type DashboardFilters } from './overview.js';
import type { Env } from '../types.js';

describe('Trae dashboard filters', () => {
  it('expands the combined Trae product to legacy, CN, and international rows', () => {
    const filters: DashboardFilters = {
      minDate: null,
      maxDate: null,
      rangeDays: null,
      range: 'all',
      deviceId: [],
      provider: [],
      product: ['trae'],
      channel: [],
      model: [],
      project: [],
    };

    expect(buildWhere(filters)).toEqual({
      whereClause: 'WHERE b.product IN (?, ?, ?)',
      params: ['trae', 'trae-cn', 'trae-intl'],
    });
  });

  it('accepts the 180-day breakdown range and applies the same combined alias', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const DB = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ sql, params });
            return {
              first: async () => ({ total: 0 }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    };

    const response = await handleBreakdowns(
      new URL('https://example.test/api/v1/breakdowns?range=180d&product=trae'),
      { DB } as unknown as Env,
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).toContain('b.product IN (?, ?, ?)');
      expect(call.params.slice(1, 4)).toEqual(['trae', 'trae-cn', 'trae-intl']);
    }
  });
});
