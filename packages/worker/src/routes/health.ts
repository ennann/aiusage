import { SERVICE_NAME, SCHEMA_VERSION } from '@aiusage/shared';
import { jsonOk } from '../utils/response.js';
import type { Env } from '../types.js';

export function handleHealth(env: Env): Response {
  return jsonOk({
    siteId: env.SITE_ID,
    service: SERVICE_NAME,
    schemaVersion: SCHEMA_VERSION,
    time: new Date().toISOString(),
    siteTitle: env.SITE_TITLE || '',
  });
}
