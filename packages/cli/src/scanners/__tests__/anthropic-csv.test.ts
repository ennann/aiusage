import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanAnthropicCsvDates } from '../anthropic-csv.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const mockReadFile = vi.mocked(fs.readFile);

function makeRow(overrides: Record<string, string> = {}): string {
  const defaults = {
    usage_date_utc: '2025-12-04',
    model_version: 'claude-opus-4-5-20251101',
    api_key: 'some_key',
    workspace: 'Claude Code',
    usage_type: 'standard',
    context_window: '≤ 200k',
    usage_input_tokens_no_cache: '1000',
    usage_input_tokens_cache_write_5m: '2000',
    usage_input_tokens_cache_write_1h: '500',
    usage_input_tokens_cache_read: '3000',
    usage_output_tokens: '400',
    web_search_count: '0',
    inference_geo: 'not_available',
    speed: '',
  };
  const merged = { ...defaults, ...overrides };
  return Object.values(merged).join(',');
}

const CSV_HEADER = 'usage_date_utc,model_version,api_key,workspace,usage_type,context_window,usage_input_tokens_no_cache,usage_input_tokens_cache_write_5m,usage_input_tokens_cache_write_1h,usage_input_tokens_cache_read,usage_output_tokens,web_search_count,inference_geo,speed';

function makeCsv(...rows: string[]): string {
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('scanAnthropicCsvDates', () => {
  it('maps CSV fields to IngestBreakdown correctly', async () => {
    mockReadFile.mockResolvedValue(makeCsv(makeRow()) as any);

    const result = await scanAnthropicCsvDates(['2025-12-04'], ['/fake/file.csv']);
    const breakdowns = result.get('2025-12-04')!;

    expect(breakdowns).toHaveLength(1);
    const b = breakdowns[0];
    expect(b.model).toBe('claude-opus-4-5');       // date suffix stripped
    expect(b.provider).toBe('anthropic');
    expect(b.product).toBe('claude-code');
    expect(b.channel).toBe('cli');
    expect(b.inputTokens).toBe(1000);              // usage_input_tokens_no_cache
    expect(b.cacheWrite5mTokens).toBe(2000);       // usage_input_tokens_cache_write_5m
    expect(b.cacheWrite1hTokens).toBe(500);        // usage_input_tokens_cache_write_1h
    expect(b.cacheWriteTokens).toBe(2500);         // 5m + 1h
    expect(b.cachedInputTokens).toBe(3000);        // usage_input_tokens_cache_read
    expect(b.outputTokens).toBe(400);
  });

  it('returns empty array for dates not in CSV', async () => {
    mockReadFile.mockResolvedValue(makeCsv(makeRow({ usage_date_utc: '2025-12-04' })) as any);

    const result = await scanAnthropicCsvDates(['2025-12-04', '2025-12-05'], ['/fake/file.csv']);
    expect(result.get('2025-12-04')).toHaveLength(1);
    expect(result.get('2025-12-05')).toEqual([]);
  });

  it('aggregates multiple rows for same date and model', async () => {
    const csv = makeCsv(
      makeRow({ usage_input_tokens_no_cache: '1000', usage_output_tokens: '200' }),
      makeRow({ usage_input_tokens_no_cache: '500', usage_output_tokens: '100' }),
    );
    mockReadFile.mockResolvedValue(csv as any);

    const breakdowns = (await scanAnthropicCsvDates(['2025-12-04'], ['/fake/file.csv'])).get('2025-12-04')!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0].inputTokens).toBe(1500);
    expect(breakdowns[0].outputTokens).toBe(300);
    expect(breakdowns[0].eventCount).toBe(2);
  });

  it('handles multiple models on same date', async () => {
    const csv = makeCsv(
      makeRow({ model_version: 'claude-opus-4-5-20251101', usage_output_tokens: '500' }),
      makeRow({ model_version: 'claude-haiku-4-5-20251001', usage_output_tokens: '200' }),
    );
    mockReadFile.mockResolvedValue(csv as any);

    const breakdowns = (await scanAnthropicCsvDates(['2025-12-04'], ['/fake/file.csv'])).get('2025-12-04')!;
    expect(breakdowns).toHaveLength(2);
    const models = breakdowns.map(b => b.model).sort();
    expect(models).toEqual(['claude-haiku-4-5', 'claude-opus-4-5']);
  });

  it('skips rows where all token counts are zero', async () => {
    const csv = makeCsv(
      makeRow({
        usage_input_tokens_no_cache: '0',
        usage_input_tokens_cache_write_5m: '0',
        usage_input_tokens_cache_write_1h: '0',
        usage_input_tokens_cache_read: '0',
        usage_output_tokens: '0',
      }),
      makeRow({ usage_output_tokens: '100' }),
    );
    mockReadFile.mockResolvedValue(csv as any);

    const breakdowns = (await scanAnthropicCsvDates(['2025-12-04'], ['/fake/file.csv'])).get('2025-12-04')!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0].outputTokens).toBe(100);
  });

  it('reads multiple CSV files and merges results', async () => {
    mockReadFile
      .mockResolvedValueOnce(makeCsv(makeRow({ usage_date_utc: '2025-11-15', usage_output_tokens: '100' })) as any)
      .mockResolvedValueOnce(makeCsv(makeRow({ usage_date_utc: '2025-12-04', usage_output_tokens: '200' })) as any);

    const result = await scanAnthropicCsvDates(
      ['2025-11-15', '2025-12-04'],
      ['/fake/nov.csv', '/fake/dec.csv'],
    );
    expect(result.get('2025-11-15')![0].outputTokens).toBe(100);
    expect(result.get('2025-12-04')![0].outputTokens).toBe(200);
  });

  it('merges data across files for same date and model', async () => {
    const row = makeRow({ usage_output_tokens: '300' });
    mockReadFile
      .mockResolvedValueOnce(makeCsv(row) as any)
      .mockResolvedValueOnce(makeCsv(row) as any);

    const breakdowns = (await scanAnthropicCsvDates(['2025-12-04'], ['/fake/a.csv', '/fake/b.csv'])).get('2025-12-04')!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0].outputTokens).toBe(600);
    expect(breakdowns[0].eventCount).toBe(2);
  });

  it('gracefully skips files that cannot be read', async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(makeCsv(makeRow({ usage_output_tokens: '150' })) as any);

    const breakdowns = (await scanAnthropicCsvDates(['2025-12-04'], ['/missing/file.csv', '/existing/file.csv'])).get('2025-12-04')!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0].outputTokens).toBe(150);
  });

  it('skips rows with invalid date format', async () => {
    const csv = [
      CSV_HEADER,
      'not-a-date,claude-opus-4-5-20251101,key,Claude Code,standard,≤ 200k,1000,0,0,0,100,0,not_available,',
      makeRow({ usage_date_utc: '2025-12-04', usage_output_tokens: '200' }),
    ].join('\n');
    mockReadFile.mockResolvedValue(csv as any);

    const breakdowns = (await scanAnthropicCsvDates(['2025-12-04'], ['/fake/file.csv'])).get('2025-12-04')!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0].outputTokens).toBe(200);
  });

  it('maps Claude Code workspace to claude-code product', async () => {
    const csv = makeCsv(
      makeRow({ workspace: 'Claude Code' }),
      makeRow({ workspace: 'claude_code' }),
    );
    mockReadFile.mockResolvedValue(csv as any);

    const breakdowns = (await scanAnthropicCsvDates(['2025-12-04'], ['/fake/file.csv'])).get('2025-12-04')!;
    expect(breakdowns.every(b => b.product === 'claude-code')).toBe(true);
  });

  it('returns empty map for empty date list', async () => {
    const result = await scanAnthropicCsvDates([], ['/fake/file.csv']);
    expect(result.size).toBe(0);
  });
});
