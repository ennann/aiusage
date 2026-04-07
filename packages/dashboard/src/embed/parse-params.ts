import type { EmbedParams, EmbedWidget, EmbedTheme } from './types';

const VALID_WIDGETS = new Set<EmbedWidget>([
  'stats-row1', 'stats-row2', 'cost-trend', 'token-trend',
  'token-composition', 'flow', 'share',
]);

export function parseEmbedParams(search: string): EmbedParams {
  const p = new URLSearchParams(search);

  const rawWidget = p.get('widget') ?? '';
  const widget = VALID_WIDGETS.has(rawWidget as EmbedWidget)
    ? (rawWidget as EmbedWidget)
    : null;

  const rawItems = p.get('items');
  const items = rawItems
    ? rawItems.split(',').map(Number).filter((n) => !Number.isNaN(n) && n >= 0)
    : null;

  const rawTheme = p.get('theme') ?? 'auto';
  const theme: EmbedTheme =
    rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : 'auto';

  const rawLocale = p.get('locale') ?? 'en';
  const locale = rawLocale === 'zh' ? 'zh' : 'en';

  return {
    widget,
    items: items && items.length > 0 ? items : null,
    range: p.get('range') || '30d',
    theme,
    transparent: p.get('transparent') === '1' || p.get('transparent') === 'true',
    locale,
    deviceId: p.get('deviceId') ?? '',
    product: p.get('product') ?? '',
  };
}
