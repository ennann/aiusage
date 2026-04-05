import type { FacetOption } from '@aiusage/shared';

const EVENT_ONLY_PRODUCTS = new Set(['antigravity', 'copilot-vscode']);

export interface MetricAvailabilityInput {
  selectedProduct?: string | null;
  productOptions: Array<Pick<FacetOption, 'value'>>;
  totalEvents: number;
  totalTokens: number;
}

export interface MetricAvailability {
  mode: 'standard' | 'event-only';
  tokenMetricsUnavailable: boolean;
}

function getScopedProducts(
  selectedProduct: string | null | undefined,
  productOptions: Array<Pick<FacetOption, 'value'>>,
): string[] {
  if (selectedProduct) return [selectedProduct];
  return productOptions.map((option) => option.value).filter(Boolean);
}

export function getMetricAvailability({
  selectedProduct,
  productOptions,
  totalEvents,
  totalTokens,
}: MetricAvailabilityInput): MetricAvailability {
  if (totalEvents <= 0) {
    return { mode: 'standard', tokenMetricsUnavailable: false };
  }

  const scopedProducts = getScopedProducts(selectedProduct, productOptions);
  const usesOnlyEventSources = scopedProducts.length > 0
    && scopedProducts.every((product) => EVENT_ONLY_PRODUCTS.has(product));
  const tokenMetricsUnavailable = usesOnlyEventSources && totalTokens === 0;

  return {
    mode: tokenMetricsUnavailable ? 'event-only' : 'standard',
    tokenMetricsUnavailable,
  };
}
