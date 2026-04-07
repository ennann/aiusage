import { getPricingCatalog } from '../utils/pricing.js';
import { corsHeaders } from '../utils/response.js';

export function handlePricingApi(): Response {
  const catalog = getPricingCatalog();
  return new Response(JSON.stringify(catalog), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders(),
    },
  });
}
