export type EmbedWidget =
  | 'stats-row1'
  | 'stats-row2'
  | 'cost-trend'
  | 'token-trend'
  | 'token-composition'
  | 'flow'
  | 'share';

export type EmbedTheme = 'light' | 'dark' | 'auto';
export type EmbedLocale = 'en' | 'zh' | 'auto';
export type EmbedCurrency = 'USD' | 'CNY' | 'auto';

export interface EmbedParams {
  widget: EmbedWidget | null;
  items: number[] | null;       // null = show all
  range: string;
  theme: EmbedTheme;
  transparent: boolean;
  locale: EmbedLocale;
  currency: EmbedCurrency;
  deviceId: string;
  product: string;
}
