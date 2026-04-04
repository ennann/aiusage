// Anthropic Admin API scanner — fetches historical usage data from
// https://api.anthropic.com/v1/organizations/usage_report/messages
//
// Requires an Admin API key (sk-ant-admin...) from console.anthropic.com.
// This is separate from a regular API key and needs the Admin role.
//
// Use this to recover data from periods where local JSONL files were rotated.
// Do NOT use for dates already covered by local JSONL (double-counting).

import type { IngestBreakdown } from '@aiusage/shared';
import { normalizeModelName } from './utils.js';

const ADMIN_API_BASE = 'https://api.anthropic.com';
const USAGE_ENDPOINT = '/v1/organizations/usage_report/messages';
const MAX_DAYS_PER_REQUEST = 31;

interface UsageResult {
  model: string;
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  output_tokens: number;
}

interface UsageBucket {
  starting_at: string;
  ending_at: string;
  results: UsageResult[];
}

interface UsageResponse {
  data: UsageBucket[];
  has_more: boolean;
  next_page: string | null;
}

export async function scanAnthropicApiDates(
  targetDates: string[],
  adminApiKey: string,
): Promise<Map<string, IngestBreakdown[]>> {
  if (!targetDates.length || !adminApiKey) {
    return new Map(targetDates.map(d => [d, []]));
  }

  const sorted = [...new Set(targetDates)].sort();
  const grouped = new Map<string, IngestBreakdown[]>(sorted.map(d => [d, []]));

  // Split into 31-day chunks (API hard limit)
  const chunks = chunkDateRange(sorted[0], sorted[sorted.length - 1]);

  for (const { startingAt, endingAt } of chunks) {
    await fetchAndMerge(startingAt, endingAt, adminApiKey, sorted, grouped);
  }

  return grouped;
}

async function fetchAndMerge(
  startingAt: string,
  endingAt: string,
  adminApiKey: string,
  targetDates: string[],
  grouped: Map<string, IngestBreakdown[]>,
): Promise<void> {
  let nextPage: string | null = null;

  do {
    const url = buildUrl(startingAt, endingAt, nextPage);
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: {
          'x-api-key': adminApiKey,
          'anthropic-version': '2023-06-01',
        },
      });
    } catch (err) {
      throw new Error(`Anthropic Admin API request failed: ${err}`);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Anthropic Admin API error ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as UsageResponse;

    for (const bucket of data.data) {
      // Bucket's starting_at is UTC midnight; extract YYYY-MM-DD
      const date = bucket.starting_at.slice(0, 10);
      if (!targetDates.includes(date)) continue;

      const breakdowns = grouped.get(date)!;

      for (const result of bucket.results) {
        if (!result.model) continue;
        const model = normalizeModelName(result.model);

        const inputTokens = result.uncached_input_tokens ?? 0;
        const cachedInputTokens = result.cache_read_input_tokens ?? 0;
        const cacheWrite5m = result.cache_creation?.ephemeral_5m_input_tokens ?? 0;
        const cacheWrite1h = result.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        const cacheWriteTokens = cacheWrite5m + cacheWrite1h;
        const outputTokens = result.output_tokens ?? 0;

        if (inputTokens + outputTokens + cachedInputTokens + cacheWriteTokens === 0) continue;

        const existing = breakdowns.find(b => b.model === model);
        if (existing) {
          existing.eventCount += 1;
          existing.inputTokens += inputTokens;
          existing.cachedInputTokens += cachedInputTokens;
          existing.cacheWriteTokens += cacheWriteTokens;
          existing.cacheWrite5mTokens = (existing.cacheWrite5mTokens ?? 0) + cacheWrite5m;
          existing.cacheWrite1hTokens = (existing.cacheWrite1hTokens ?? 0) + cacheWrite1h;
          existing.outputTokens += outputTokens;
        } else {
          breakdowns.push({
            provider: 'anthropic',
            product: 'claude-code',
            channel: 'cli',
            model,
            project: 'unknown',
            eventCount: 1,
            inputTokens,
            cachedInputTokens,
            cacheWriteTokens,
            cacheWrite5mTokens: cacheWrite5m,
            cacheWrite1hTokens: cacheWrite1h,
            outputTokens,
            reasoningOutputTokens: 0,
          });
        }
      }
    }

    nextPage = data.has_more ? data.next_page : null;
  } while (nextPage);
}

function buildUrl(startingAt: string, endingAt: string, page: string | null): string {
  const params = new URLSearchParams({
    starting_at: startingAt,
    ending_at: endingAt,
    bucket_width: '1d',
  });
  params.append('group_by[]', 'model');
  if (page) params.set('page', page);
  return `${ADMIN_API_BASE}${USAGE_ENDPOINT}?${params}`;
}

// Split a date range [startDate, endDate] into chunks of MAX_DAYS_PER_REQUEST.
// Returns { startingAt, endingAt } as RFC 3339 UTC strings.
export function chunkDateRange(
  startDate: string,
  endDate: string,
): Array<{ startingAt: string; endingAt: string }> {
  const chunks: Array<{ startingAt: string; endingAt: string }> = [];
  let current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  // Add one day to make endDate inclusive
  end.setUTCDate(end.getUTCDate() + 1);

  while (current < end) {
    const chunkEnd = new Date(current);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_DAYS_PER_REQUEST);
    const actualEnd = chunkEnd < end ? chunkEnd : end;

    chunks.push({
      startingAt: current.toISOString().replace('.000Z', 'Z'),
      endingAt: actualEnd.toISOString().replace('.000Z', 'Z'),
    });

    current = actualEnd;
  }

  return chunks;
}
