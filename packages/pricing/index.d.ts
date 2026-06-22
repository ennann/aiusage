export interface PricingCatalog {
  version: string;
  fx: Record<string, number>;
  aliases: Record<string, string>;
  providers: Record<string, Record<string, { models: Record<string, Record<string, unknown>> }>>;
}

export declare const catalog: PricingCatalog;
export default catalog;
