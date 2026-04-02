import { hostname } from 'node:os';
import type { AIUsageConfig } from './config.js';
import { getLocalTimezone } from './config.js';
import { getVersion } from './version.js';

const SCHEMA_VERSION = '1.0';
const DEFAULT_LOOKBACK_DAYS = 7;

export interface HealthResponse {
  ok: boolean;
  siteId: string;
  service: 'aiusage';
  version: string;
  time: string;
}

interface EnrollResponse {
  ok: boolean;
  siteId: string;
  deviceId: string;
  deviceToken: string;
  issuedAt: string;
}

interface ApiErrorResponse {
  ok: false;
  error?: {
    code?: string;
    message?: string;
  };
}

export async function fetchHealth(apiBaseUrl: string): Promise<HealthResponse> {
  return requestJson<HealthResponse>(`${apiBaseUrl}/api/v1/health`);
}

export async function enrollDevice(
  apiBaseUrl: string,
  params: {
    siteId: string;
    deviceId: string;
    deviceAlias?: string;
    enrollToken: string;
  },
): Promise<EnrollResponse> {
  return requestJson<EnrollResponse>(`${apiBaseUrl}/api/v1/enroll`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.enrollToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      siteId: params.siteId,
      deviceId: params.deviceId,
      deviceAlias: params.deviceAlias,
      hostname: hostname(),
      timezone: getLocalTimezone(),
      appVersion: getVersion(),
    }),
  });
}

export async function uploadDailyUsage(
  apiBaseUrl: string,
  config: Pick<AIUsageConfig, 'siteId' | 'deviceId' | 'deviceAlias' | 'deviceToken'>,
  days: Array<{
    usageDate: string;
    breakdowns: Array<{
      provider: string;
      product: string;
      channel: string;
      model: string;
      project: string;
      eventCount: number;
      inputTokens: number;
      cachedInputTokens: number;
      cacheWriteTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
    }>;
  }>,
): Promise<{
  ok: boolean;
  daysProcessed: number;
  costSummary: Record<string, { estimatedCostUsd: number; costStatus: string }>;
}> {
  return requestJson(`${apiBaseUrl}/api/v1/ingest/daily`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.deviceToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      siteId: config.siteId,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      device: {
        deviceId: config.deviceId,
        deviceAlias: config.deviceAlias,
        hostname: hostname(),
        timezone: getLocalTimezone(),
        appVersion: getVersion(),
      },
      days,
    }),
  });
}

export function defaultLookbackDays(config: AIUsageConfig): number {
  return config.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  let data: T | ApiErrorResponse | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T | ApiErrorResponse;
    } catch {
      throw new Error(`服务端返回了非 JSON 响应 (${response.status})`);
    }
  }

  if (!response.ok) {
    const error = (data as ApiErrorResponse | null)?.error;
    throw new Error(error?.message ?? `请求失败 (${response.status})`);
  }

  if (!data) {
    throw new Error('服务端返回了空响应');
  }

  return data as T;
}
