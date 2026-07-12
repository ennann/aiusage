import type { ProductPricing } from '../types.js';

/**
 * xAI public API list prices (shadow prices for Grok Build local scans).
 *
 * Source: https://docs.x.ai/developers/pricing  (checked 2026-07-12)
 *
 * Grok Build local logs do not expose authoritative billable usage consistently,
 * so all models are force_estimated — scanner-derived token counts are heuristics.
 */
const estimated = {
  currency: 'USD' as const,
  force_estimated: true as const,
};

export const xai: Record<string, ProductPricing> = {
  'grok-build': {
    models: {
      // Code API
      'grok-build-0.1': {
        ...estimated,
        input_per_million: 1,
        output_per_million: 2,
        cached_input_per_million: 0.2,
        notes: 'Code API list price; shadow price for local Grok Build scans',
      },

      // Chat API — current flagship used by Grok Build CLI
      'grok-4.5': {
        ...estimated,
        input_per_million: 2,
        output_per_million: 6,
        cached_input_per_million: 0.5,
        notes: 'Chat API list price; primary Grok Build model',
      },

    },
  },
};
