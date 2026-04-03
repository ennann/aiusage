import { handleHealth } from './routes/health.js';
import { handleEnroll } from './routes/enroll.js';
import { handleIngest } from './routes/ingest.js';
import { handleOverview } from './routes/overview.js';
import { handleBreakdowns } from './routes/breakdowns.js';
import { handlePricing } from './routes/pricing.js';
import { corsHeaders, jsonError } from './utils/response.js';
import type { Env } from './types.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight
    if (request.method === 'OPTIONS' && pathname.startsWith('/api/v1/public/')) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // IP 限流 — 仅对 API 路由生效
    if (pathname.startsWith('/api/')) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.API_RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
        );
      }
    }

    try {
      if (pathname === '/pricing' && request.method === 'GET') {
        return handlePricing(env);
      }
      if (pathname === '/favicon.ico') {
        return new Response(null, { status: 204 });
      }

      // ── 设备接口 ──
      if (pathname === '/api/v1/health' && request.method === 'GET') {
        return handleHealth(env);
      }
      if (pathname === '/api/v1/enroll' && request.method === 'POST') {
        return handleEnroll(request, env);
      }
      if (pathname === '/api/v1/ingest/daily' && request.method === 'POST') {
        return handleIngest(request, env);
      }

      // ── 公开接口 ──
      if (pathname === '/api/v1/public/overview' && request.method === 'GET') {
        return handleOverview(url, env);
      }
      if (pathname === '/api/v1/public/breakdowns' && request.method === 'GET') {
        return handleBreakdowns(url, env);
      }

      return jsonError(404, 'NOT_FOUND', 'Route not found');
    } catch (err) {
      console.error('Unhandled error:', err);
      return jsonError(500, 'INTERNAL_ERROR', 'Internal server error');
    }
  },
} satisfies ExportedHandler<Env>;
