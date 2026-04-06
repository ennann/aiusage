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
    unavailable: 'N/A',
    eventOnlySource: 'Event-only source',
    eventOnlyNotice: 'This source only exposes local activity events. Token and cost data are unavailable.',
    claudeCodeDataNotice: 'Claude Code only retains the most recent 30 days of local session logs. Data from the current 30-day window is accurate; data before February 2026 may be incomplete.',
    activityUnavailable: 'Activity heatmap is unavailable for this source',
    costUnavailable: 'Cost data unavailable for this source',
    tokenUnavailable: 'Token data unavailable for this source',
    shareUnavailable: 'Cost-based shares unavailable for this source',
    input: 'Input', cached: 'Cached', cacheWrite: 'Cache Write',
    output: 'Output', reasoning: 'Reasoning',
    range7d: '7D', range30d: '30D', range90d: '90D',
    themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    refresh: 'Refresh',
    pricing: 'Model Pricing', embedWidgets: 'Embed',
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
    unavailable: 'N/A',
    eventOnlySource: '仅事件来源',
    eventOnlyNotice: '该来源仅提供本地活动事件，无法提供 Token 和费用数据。',
    claudeCodeDataNotice: 'Claude Code 仅保留最近 30 天的本地会话日志。当前 30 天窗口内的数据是准确的；2026 年 2 月之前的数据可能不完整。',
    activityUnavailable: '该来源暂无可用热力图数据',
    costUnavailable: '该来源暂无可用费用数据',
    tokenUnavailable: '该来源暂无可用 Token 数据',
    shareUnavailable: '该来源暂无可用费用占比数据',
    input: '输入', cached: '缓存', cacheWrite: '缓存写入',
    output: '输出', reasoning: '推理',
    range7d: '7 天', range30d: '30 天', range90d: '90 天',
    themeSystem: '系统', themeLight: '日间', themeDark: '夜间',
    refresh: '刷新',
    pricing: '模型定价', embedWidgets: '嵌入组件',
  },
} as const;

export type T = Record<keyof typeof I18N['en'], string>;
