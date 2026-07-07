export function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export const PUBLIC_READ_CACHE_HEADERS: HeadersInit = {
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  'Cloudflare-CDN-Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
};

export function jsonOk<T>(data: T, isPublic = false, extraHeaders: HeadersInit = {}): Response {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (isPublic) Object.assign(headers, corsHeaders());
  Object.assign(headers, extraHeaders);
  return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers });
}

export function jsonError(status: number, code: string, message: string, isPublic = false): Response {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (isPublic) Object.assign(headers, corsHeaders());
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    { status, headers },
  );
}
