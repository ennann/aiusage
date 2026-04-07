// Anthropic CSV usage importer
//
// Reads the monthly usage CSV files downloadable from:
//   https://platform.claude.com/usage?date=YYYY-MM
//
// CSV columns:
//   usage_date_utc, model_version, api_key, workspace, usage_type,
//   context_window, usage_input_tokens_no_cache,
//   usage_input_tokens_cache_write_5m, usage_input_tokens_cache_write_1h,
//   usage_input_tokens_cache_read, usage_output_tokens,
//   web_search_count, inference_geo, speed

import { readFile } from 'node:fs/promises';
import type { IngestBreakdown, Product } from '@aiusage/shared';
import { normalizeModelName } from './utils.js';

interface CsvRow {
  usage_date_utc: string;
  model_version: string;
  workspace: string;
  usage_input_tokens_no_cache: number;
  usage_input_tokens_cache_write_5m: number;
  usage_input_tokens_cache_write_1h: number;
  usage_input_tokens_cache_read: number;
  usage_output_tokens: number;
}

export async function scanAnthropicCsvDates(
  targetDates: string[],
  csvFilePaths: string[],
): Promise<Map<string, IngestBreakdown[]>> {
  if (!targetDates.length) return new Map();

  const targetDateSet = new Set(targetDates);
  const grouped = new Map<string, Map<string, IngestBreakdown>>(
    targetDates.map(d => [d, new Map()]),
  );

  for (const filePath of csvFilePaths) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const rows = parseCsv(content);
    for (const row of rows) {
      if (!targetDateSet.has(row.usage_date_utc)) continue;

      const total = row.usage_input_tokens_no_cache
        + row.usage_input_tokens_cache_write_5m
        + row.usage_input_tokens_cache_write_1h
        + row.usage_input_tokens_cache_read
        + row.usage_output_tokens;
      if (total === 0) continue;

      const model = normalizeModelName(row.model_version);
      const product = workspaceToProduct(row.workspace);
      const key = `${model}|${product}`;

      const byModel = grouped.get(row.usage_date_utc)!;
      const existing = byModel.get(key);
      const cacheWriteTokens =
        row.usage_input_tokens_cache_write_5m + row.usage_input_tokens_cache_write_1h;

      if (existing) {
        existing.eventCount += 1;
        existing.inputTokens += row.usage_input_tokens_no_cache;
        existing.cachedInputTokens += row.usage_input_tokens_cache_read;
        existing.cacheWriteTokens += cacheWriteTokens;
        existing.cacheWrite5mTokens = (existing.cacheWrite5mTokens ?? 0) + row.usage_input_tokens_cache_write_5m;
        existing.cacheWrite1hTokens = (existing.cacheWrite1hTokens ?? 0) + row.usage_input_tokens_cache_write_1h;
        existing.outputTokens += row.usage_output_tokens;
      } else {
        byModel.set(key, {
          provider: 'anthropic',
          product,
          channel: 'cli',
          model,
          project: 'unknown',
          eventCount: 1,
          inputTokens: row.usage_input_tokens_no_cache,
          cachedInputTokens: row.usage_input_tokens_cache_read,
          cacheWriteTokens,
          cacheWrite5mTokens: row.usage_input_tokens_cache_write_5m,
          cacheWrite1hTokens: row.usage_input_tokens_cache_write_1h,
          outputTokens: row.usage_output_tokens,
          reasoningOutputTokens: 0,
        });
      }
    }
  }

  return new Map(
    [...grouped.entries()].map(([date, byModel]) => [date, [...byModel.values()]]),
  );
}

function workspaceToProduct(workspace: string): Product {
  const w = workspace.trim().toLowerCase();
  if (w === 'claude code' || w === 'claude_code') return 'claude-code';
  return 'claude-code'; // default — all usage in this tool is Claude Code
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j]?.trim() ?? '';
    }

    const date = row['usage_date_utc'];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    rows.push({
      usage_date_utc: date,
      model_version: row['model_version'] ?? '',
      workspace: row['workspace'] ?? '',
      usage_input_tokens_no_cache: parseInt(row['usage_input_tokens_no_cache'] ?? '0', 10) || 0,
      usage_input_tokens_cache_write_5m: parseInt(row['usage_input_tokens_cache_write_5m'] ?? '0', 10) || 0,
      usage_input_tokens_cache_write_1h: parseInt(row['usage_input_tokens_cache_write_1h'] ?? '0', 10) || 0,
      usage_input_tokens_cache_read: parseInt(row['usage_input_tokens_cache_read'] ?? '0', 10) || 0,
      usage_output_tokens: parseInt(row['usage_output_tokens'] ?? '0', 10) || 0,
    });
  }

  return rows;
}
