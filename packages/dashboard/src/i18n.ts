export type Locale = 'en' | 'zh';

export function getStoredLocale(): Locale {
  try { return (localStorage.getItem('aiusage-locale') as Locale) ?? 'en'; }
  catch { return 'en'; }
}

export const I18N = {
  en: {
    estimatedCost: 'Estimated Cost', totalTokens: 'Total Tokens',
    inputTokens: 'Input Tokens', outputTokens: 'Output Tokens',
    cachedTokens: 'Cached Tokens', activeDays: 'Active Days',
    sessions: 'Sessions', costPerSession: 'Cost / Session',
    avgDailyCost: 'Avg Daily Cost', cacheHitRate: 'Cache Hit Rate',
    costTrend: 'Cost Trend', tokenTrend: 'Token Trend',
    tokenComposition: 'Token Composition', tokenFlow: 'Token Flow',
    providerShare: 'Provider Share', modelShare: 'Model Share',
    channelShare: 'Channel Share', deviceShare: 'Device Share', thisMonth: 'This Month',
    device: 'Device', product: 'Product', all: 'All',
    noData: 'No data', noFlowData: 'No flow data',
    failedToLoad: 'Failed to load data',
    input: 'Input', cached: 'Cached', cacheWrite: 'Cache Write',
    output: 'Output', reasoning: 'Reasoning',
    range7d: '7D', range30d: '30D', range90d: '90D',
    themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    refresh: 'Refresh',
  },
  zh: {
    estimatedCost: '预估费用', totalTokens: '总 Token',
    inputTokens: '输入 Token', outputTokens: '输出 Token',
    cachedTokens: '缓存 Token', activeDays: '活跃天数',
    sessions: '会话数', costPerSession: '单次费用',
    avgDailyCost: '日均费用', cacheHitRate: '缓存命中率',
    costTrend: '费用趋势', tokenTrend: 'Token 趋势',
    tokenComposition: 'Token 构成', tokenFlow: 'Token 流向',
    providerShare: '厂商占比', modelShare: '模型占比',
    channelShare: '渠道占比', deviceShare: '设备占比', thisMonth: '本月',
    device: '设备', product: '产品', all: '全部',
    noData: '暂无数据', noFlowData: '暂无流向数据',
    failedToLoad: '加载失败',
    input: '输入', cached: '缓存', cacheWrite: '缓存写入',
    output: '输出', reasoning: '推理',
    range7d: '7 天', range30d: '30 天', range90d: '90 天',
    themeSystem: '系统', themeLight: '日间', themeDark: '夜间',
    refresh: '刷新',
  },
} as const;

export type T = Record<keyof typeof I18N['en'], string>;
