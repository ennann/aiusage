export type Lang = 'en' | 'zh';

interface Strings {
  reportTitle: string;
  period: string;
  events: string;
  tokens: string;
  cost: string;
  sources: string;
  daily: string;
  topModels: string;
  pricingNotes: string;
  noData: string;
  rangeLast7d: string;
  rangeLast1m: string;
  rangeLast3m: string;
  rangeAll: string;
  rangeToday: string;
  hdrSource: string;
  hdrDate: string;
  hdrModel: string;
  hdrEvents: string;
  hdrInput: string;
  hdrCache: string;
  hdrCacheRead: string;
  hdrCacheWrite: string;
  hdrOutput: string;
  hdrReasoning: string;
  hdrTotal: string;
  hdrCost: string;
}

const en: Strings = {
  reportTitle: 'AIUsage Report',
  period: 'Period',
  events: 'Events',
  tokens: 'Tokens',
  cost: 'Cost',
  sources: 'Sources',
  daily: 'Daily',
  topModels: 'Top Models',
  pricingNotes: 'Pricing Notes',
  noData: 'No token data in this range.',
  rangeLast7d: 'Last 7 days',
  rangeLast1m: 'Last 30 days',
  rangeLast3m: 'Last 90 days',
  rangeAll: 'All time',
  rangeToday: 'Today',
  hdrSource: 'Source',
  hdrDate: 'Date',
  hdrModel: 'Model',
  hdrEvents: 'Events',
  hdrInput: 'Input',
  hdrCache: 'Cache',
  hdrCacheRead: 'CacheRead',
  hdrCacheWrite: 'CacheWrite',
  hdrOutput: 'Output',
  hdrReasoning: 'Reasoning',
  hdrTotal: 'Total',
  hdrCost: 'Cost',
};

const zh: Strings = {
  reportTitle: 'AIUsage 报告',
  period: '时段',
  events: '事件',
  tokens: '令牌',
  cost: '费用',
  sources: '来源',
  daily: '每日',
  topModels: '模型排行',
  pricingNotes: '定价说明',
  noData: '该范围暂无 token 数据。',
  rangeLast7d: '最近 7 天',
  rangeLast1m: '最近 30 天',
  rangeLast3m: '最近 90 天',
  rangeAll: '全部历史',
  rangeToday: '今天',
  hdrSource: '来源',
  hdrDate: '日期',
  hdrModel: '模型',
  hdrEvents: '事件',
  hdrInput: '输入',
  hdrCache: '缓存',
  hdrCacheRead: '缓存读',
  hdrCacheWrite: '缓存写',
  hdrOutput: '输出',
  hdrReasoning: '推理',
  hdrTotal: '合计',
  hdrCost: '费用',
};

const tables: Record<Lang, Strings> = { en, zh };

export function t(lang: Lang): Strings {
  return tables[lang];
}
