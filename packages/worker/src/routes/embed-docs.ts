import type { Env } from '../types.js';

export function handleEmbedDocs(request: Request, env: Env): Response {
  const origin = new URL(request.url).origin;
  return new Response(renderEmbedDocsPage(origin, env.SITE_TITLE || 'AI Usage'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/* ── widget definitions ── */

interface WidgetDef {
  id: string;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  iframeHeight: number;
  supportsItems: boolean;
  itemsNoteZh?: string;
  itemsNoteEn?: string;
}

const widgets: WidgetDef[] = [
  {
    id: 'stats-row1',
    nameZh: '指标卡 · 第一行', nameEn: 'KPI Cards · Row 1',
    descZh: '预估费用、总 Token、输入、输出、缓存命中',
    descEn: 'Estimated cost, total tokens, input, output, cached tokens',
    iframeHeight: 100, supportsItems: true,
    itemsNoteZh: '索引 0-4', itemsNoteEn: 'Index 0-4',
  },
  {
    id: 'stats-row2',
    nameZh: '指标卡 · 第二行', nameEn: 'KPI Cards · Row 2',
    descZh: '活跃天数、会话数、单次费用、日均费用、缓存命中率',
    descEn: 'Active days, sessions, cost/session, avg daily cost, cache hit rate',
    iframeHeight: 100, supportsItems: true,
    itemsNoteZh: '索引 0-4', itemsNoteEn: 'Index 0-4',
  },
  {
    id: 'cost-trend',
    nameZh: '费用趋势', nameEn: 'Cost Trend',
    descZh: '按天展示费用变化的柱状图，支持多厂商堆叠',
    descEn: 'Daily cost bar chart with multi-provider stacking',
    iframeHeight: 360, supportsItems: false,
  },
  {
    id: 'token-trend',
    nameZh: 'Token 趋势', nameEn: 'Token Trend',
    descZh: '按天展示各类 Token 用量的面积图',
    descEn: 'Daily token usage area chart by type',
    iframeHeight: 380, supportsItems: false,
  },
  {
    id: 'token-composition',
    nameZh: 'Token 构成', nameEn: 'Token Composition',
    descZh: '按天展示 Token 类型分布的堆叠柱状图',
    descEn: 'Daily token type distribution stacked bar chart',
    iframeHeight: 380, supportsItems: false,
  },
  {
    id: 'flow',
    nameZh: 'Token 流向', nameEn: 'Token Flow',
    descZh: '模型到项目的 Token 流向桑基图',
    descEn: 'Model-to-project token flow Sankey diagram',
    iframeHeight: 420, supportsItems: false,
  },
  {
    id: 'share',
    nameZh: '占比分析', nameEn: 'Share Analysis',
    descZh: '厂商、模型、设备的费用占比环形图',
    descEn: 'Provider, model, and device cost share donut charts',
    iframeHeight: 480, supportsItems: true,
    itemsNoteZh: '0=厂商, 1=模型, 2=设备', itemsNoteEn: '0=Provider, 1=Model, 2=Device',
  },
];

/* ── helpers ── */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ── bilingual helper ── */

function t(zh: string, en: string): string {
  return `<span data-zh="${escapeHtml(zh)}" data-en="${escapeHtml(en)}" class="i18n">${escapeHtml(zh)}</span>`;
}

/* ── widget card rendering ── */

function renderWidgetCard(w: WidgetDef, origin: string): string {
  const embedCode = `<iframe src="${origin}/embed?widget=${w.id}" width="100%" height="${w.iframeHeight}" frameborder="0" style="border:none"></iframe>`;

  const itemsRow = w.supportsItems
    ? `<tr><td><code>items</code></td><td>${t(w.itemsNoteZh ?? '', w.itemsNoteEn ?? '')}</td><td>${t('指定展示哪些子项（逗号分隔索引）', 'Specify which sub-items to show (comma-separated indices)')}</td></tr>`
    : '';

  const paramsRows = `
    <tr><td><code>widget</code></td><td><code>${w.id}</code></td><td>${t('组件类型', 'Widget type')}</td></tr>
    ${itemsRow}
    <tr><td><code>theme</code></td><td><code>light</code> / <code>dark</code> / <code>auto</code></td><td>${t('主题，默认 auto', 'Theme, default auto')}</td></tr>
    <tr><td><code>range</code></td><td><code>7d</code> / <code>30d</code> / <code>90d</code> …</td><td>${t('时间范围，默认 30d', 'Time range, default 30d')}</td></tr>`;

  return `<div class="widget-card">
    <div class="widget-card-header">
      <h3 class="widget-name">${escapeHtml(w.id)}</h3>
      <span class="widget-label">${t(w.nameZh, w.nameEn)}</span>
    </div>
    <p class="widget-desc">${t(w.descZh, w.descEn)}</p>

    <div class="preview-frame">
      <iframe src="/embed?widget=${w.id}&amp;theme=auto" style="height:${w.iframeHeight}px"></iframe>
    </div>

    <div class="params-section">
      <h4 class="params-title">${t('参数', 'Parameters')}</h4>
      <div class="table-scroll">
        <table class="params-table">
          <thead><tr><th>${t('参数', 'Param')}</th><th>${t('值', 'Value')}</th><th>${t('说明', 'Description')}</th></tr></thead>
          <tbody>${paramsRows}</tbody>
        </table>
      </div>
    </div>

    <div class="code-block">
      <button class="copy-btn" onclick="copyCode(this)">Copy</button>
      <pre><code>${escapeHtml(embedCode)}</code></pre>
    </div>
  </div>`;
}

/* ── page rendering ── */

function renderEmbedDocsPage(origin: string, siteTitle: string): string {
  const widgetCards = widgets.map((w) => renderWidgetCard(w, origin)).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(siteTitle)} - Embed Widgets</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html {
      font-family: "DM Sans", system-ui, -apple-system, sans-serif;
      font-feature-settings: "ss01" on, "cv11" on;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background: #fafafa;
      color: #0f172a;
    }

    html.dark {
      background: #0a0a0a;
      color: #a1a1a1;
    }

    /* ── variables ── */
    :root {
      --bg: #fafafa;
      --text: #0f172a;
      --muted: #94a3b8;
      --card-bg: #ffffff;
      --card-border: rgba(226,232,240,0.7);
      --card-radius: 12px;
      --row-border: rgba(226,232,240,0.5);
    }
    html.dark {
      --bg: #0a0a0a;
      --text: #a1a1a1;
      --muted: #64748b;
      --card-bg: #111111;
      --card-border: rgba(255,255,255,0.08);
      --row-border: rgba(255,255,255,0.06);
    }

    body {
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }

    /* ── layout ── */
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 16px;
    }
    @media (min-width: 640px) { .container { padding: 0 24px; } }
    @media (min-width: 1024px) { .container { padding: 0 32px; } }

    /* ── header ── */
    .header {
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      background: rgba(250,250,250,0.8);
      border-bottom: 1px solid var(--card-border);
    }
    html.dark .header {
      background: rgba(10,10,10,0.85);
    }
    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-icon {
      color: var(--text);
      flex-shrink: 0;
    }
    .logo-text {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .logo-text span {
      color: var(--muted);
      font-weight: 400;
      margin-left: 4px;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header-left a {
      text-decoration: none;
      color: inherit;
      display: flex;
      align-items: center;
      gap: 12px;
      border-radius: 8px;
      padding: 4px 8px;
      margin: -4px -8px;
      transition: background 0.15s;
    }
    .header-left a:hover {
      background: var(--card-border);
    }

    /* ── theme toggle ── */
    .theme-toggle {
      display: flex;
      align-items: center;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .theme-btn {
      appearance: none;
      background: transparent;
      border: none;
      color: var(--muted);
      cursor: pointer;
      padding: 6px 10px;
      font-size: 13px;
      font-family: inherit;
      line-height: 1;
      transition: color 0.15s, background 0.15s;
    }
    .theme-btn:hover { color: var(--text); }
    .theme-btn.active {
      color: var(--text);
      background: var(--card-border);
    }

    /* ── hero ── */
    .hero {
      padding: 48px 0 32px;
      text-align: center;
    }
    .hero h1 {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 12px;
    }
    .hero p {
      font-size: 15px;
      color: var(--muted);
      max-width: 560px;
      margin: 0 auto;
      line-height: 1.7;
    }

    /* ── widget cards ── */
    .widget-list {
      display: flex;
      flex-direction: column;
      gap: 24px;
      margin-bottom: 32px;
    }
    .widget-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-left: 4px solid #94a3b8;
      border-radius: var(--card-radius);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .widget-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .widget-name {
      font-family: ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", monospace;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .widget-label {
      font-size: 13px;
      color: var(--muted);
      background: rgba(148,163,184,0.1);
      padding: 2px 10px;
      border-radius: 999px;
    }
    html.dark .widget-label {
      background: rgba(148,163,184,0.08);
    }
    .widget-desc {
      font-size: 14px;
      color: var(--muted);
      line-height: 1.6;
    }

    /* ── iframe preview ── */
    .preview-frame {
      border: 1px dashed var(--card-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg);
    }
    .preview-frame iframe {
      display: block;
      width: 100%;
      border: none;
    }

    /* ── params table ── */
    .params-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .params-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .table-scroll {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .params-table {
      width: 100%;
      border-collapse: collapse;
      white-space: nowrap;
    }
    .params-table th {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      padding: 6px 12px;
      text-align: left;
      border-bottom: 1px solid var(--row-border);
    }
    .params-table td {
      padding: 6px 12px;
      font-size: 13px;
      border-bottom: 1px solid var(--row-border);
      vertical-align: middle;
    }
    .params-table tbody tr:last-child td {
      border-bottom: none;
    }
    .params-table code {
      font-family: ui-monospace, "SF Mono", monospace;
      font-size: 12px;
      background: rgba(148,163,184,0.1);
      padding: 1px 6px;
      border-radius: 4px;
    }
    html.dark .params-table code {
      background: rgba(148,163,184,0.08);
    }

    /* ── code block ── */
    .code-block {
      position: relative;
      background: #f1f5f9;
      border-radius: 8px;
      overflow: hidden;
    }
    html.dark .code-block {
      background: #1e293b;
    }
    .code-block pre {
      margin: 0;
      padding: 16px;
      overflow-x: auto;
      font-family: ui-monospace, "SF Mono", monospace;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text);
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 4px 12px;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--muted);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
    }
    .copy-btn:hover {
      color: var(--text);
    }

    /* ── common params section ── */
    .common-params {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      padding: 24px;
      margin-bottom: 48px;
    }
    .common-params h2 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 16px;
    }
    .common-params table {
      width: 100%;
      border-collapse: collapse;
      white-space: nowrap;
    }
    .common-params th {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--row-border);
    }
    .common-params td {
      padding: 8px 12px;
      font-size: 13px;
      border-bottom: 1px solid var(--row-border);
      vertical-align: middle;
    }
    .common-params tbody tr:last-child td {
      border-bottom: none;
    }
    .common-params code {
      font-family: ui-monospace, "SF Mono", monospace;
      font-size: 12px;
      background: rgba(148,163,184,0.1);
      padding: 1px 6px;
      border-radius: 4px;
    }
    html.dark .common-params code {
      background: rgba(148,163,184,0.08);
    }

    /* ── footer ── */
    .footer {
      text-align: center;
      padding: 24px 0 48px;
      font-size: 12px;
      color: var(--muted);
    }

    /* ── responsive ── */
    @media (max-width: 640px) {
      .header-inner {
        height: auto;
        padding: 12px 0;
        flex-wrap: wrap;
        gap: 8px;
      }
      .hero { padding: 32px 0 24px; }
      .hero h1 { font-size: 24px; }
      .widget-card { padding: 16px; }
      .common-params { padding: 16px; }
      .common-params table,
      .params-table {
        white-space: normal;
      }
    }
  </style>
</head>
<body>
  <!-- header -->
  <header class="header">
    <div class="container header-inner">
      <div class="header-left">
        <a href="/">
          <svg class="logo-icon" viewBox="0 0 200 160" fill="none" width="32" height="26">
            <path d="M22 112 C30 112 38 90 44 82 C50 74 54 78 58 88 C62 98 64 116 70 120 C76 124 80 108 86 84 C92 60 96 22 104 16 C112 10 116 36 120 64 C124 92 126 138 134 140 C142 142 146 108 152 72 C158 36 162 14 168 16 C174 18 178 50 182 68" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="logo-text">${escapeHtml(siteTitle)}<span>/ Embed Widgets</span></div>
        </a>
      </div>
      <div class="header-right">
        <div class="theme-toggle" style="margin-right:4px">
          <button class="theme-btn lang-btn" data-lang="zh">中</button>
          <button class="theme-btn lang-btn" data-lang="en">En</button>
        </div>
        <div class="theme-toggle">
          <button class="theme-btn" data-theme="system" title="System">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </button>
          <button class="theme-btn" data-theme="light" title="Light">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          </button>
          <button class="theme-btn" data-theme="dark" title="Dark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
        </div>
      </div>
    </div>
  </header>

  <main class="container">
    <!-- hero -->
    <div class="hero">
      <h1>${t('嵌入组件', 'Embed Widgets')}</h1>
      <p>${t(
        '将 AI Usage 的数据组件嵌入到任何网页。通过 URL 参数精确控制展示内容。',
        'Embed AI Usage data widgets into any webpage. Precisely control display content via URL parameters.',
      )}</p>
    </div>

    <!-- widget catalog -->
    <div class="widget-list">
      ${widgetCards}
    </div>

    <!-- common parameters -->
    <section class="common-params">
      <h2>${t('通用参数', 'Common Parameters')}</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>${t('参数', 'Param')}</th>
              <th>${t('可选值', 'Values')}</th>
              <th>${t('默认值', 'Default')}</th>
              <th>${t('说明', 'Description')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>widget</code></td>
              <td><code>stats-row1</code> / <code>stats-row2</code> / <code>cost-trend</code> / <code>token-trend</code> / <code>token-composition</code> / <code>flow</code> / <code>share</code></td>
              <td>&mdash;</td>
              <td>${t('组件类型（必填）', 'Widget type (required)')}</td>
            </tr>
            <tr>
              <td><code>items</code></td>
              <td><code>0,2,4</code></td>
              <td>${t('全部', 'All')}</td>
              <td>${t('指定展示哪些子项（逗号分隔索引）', 'Specify sub-items to show (comma-separated indices)')}</td>
            </tr>
            <tr>
              <td><code>range</code></td>
              <td><code>7d</code> / <code>30d</code> / <code>90d</code> / <code>month</code> / <code>all</code></td>
              <td><code>30d</code></td>
              <td>${t('时间范围', 'Time range')}</td>
            </tr>
            <tr>
              <td><code>theme</code></td>
              <td><code>light</code> / <code>dark</code> / <code>auto</code></td>
              <td><code>auto</code></td>
              <td>${t('主题', 'Theme')}</td>
            </tr>
            <tr>
              <td><code>transparent</code></td>
              <td><code>0</code> / <code>1</code></td>
              <td><code>0</code></td>
              <td>${t('透明背景', 'Transparent background')}</td>
            </tr>
            <tr>
              <td><code>locale</code></td>
              <td><code>en</code> / <code>zh</code></td>
              <td><code>en</code></td>
              <td>${t('语言', 'Language')}</td>
            </tr>
            <tr>
              <td><code>deviceId</code></td>
              <td>device ID</td>
              <td>&mdash;</td>
              <td>${t('按设备筛选', 'Filter by device')}</td>
            </tr>
            <tr>
              <td><code>product</code></td>
              <td>product name</td>
              <td>&mdash;</td>
              <td>${t('按产品筛选', 'Filter by product')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- auto resize -->
    <section class="common-params">
      <h2>${t('自动高度', 'Auto Resize')}</h2>
      <p style="font-size:14px;color:var(--muted);margin-bottom:16px;line-height:1.7">
        ${t(
          '嵌入组件会通过 <code>postMessage</code> 自动向父页面报告高度变化。添加以下脚本即可让 iframe 自动适配内容高度，无需手动指定 <code>height</code>。',
          'Embed widgets automatically report height changes to the parent page via <code>postMessage</code>. Add the following script to let iframes auto-fit their content — no manual <code>height</code> needed.',
        )}
      </p>
      <div class="code-block">
        <button class="copy-btn" onclick="copyCode(this)">Copy</button>
        <pre><code>${escapeHtml(`<script>
window.addEventListener('message', function(e) {
  if (e.data && e.data.source === 'aiusage-embed' && e.data.height) {
    // Find the iframe matching this widget
    var frames = document.querySelectorAll('iframe');
    frames.forEach(function(f) {
      try {
        var url = new URL(f.src, location.origin);
        if (url.searchParams.get('widget') === e.data.widget) {
          f.style.height = e.data.height + 'px';
        }
      } catch(err) {}
    });
  }
});
</script>`)}</code></pre>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-top:12px;line-height:1.7">
        ${t(
          '消息格式：<code>{ source: "aiusage-embed", widget: "stats-row1", height: 120 }</code>',
          'Message format: <code>{ source: "aiusage-embed", widget: "stats-row1", height: 120 }</code>',
        )}
      </p>
    </section>
  </main>

  <footer class="footer">
    <div class="container">${escapeHtml(siteTitle)} &middot; Embed Widgets Documentation</div>
  </footer>

  <script>
    // ── theme ──
    (function() {
      var KEY = 'aiusage-theme';
      function getStored() {
        try { return localStorage.getItem(KEY) || 'system'; } catch(e) { return 'system'; }
      }
      function apply(mode) {
        var isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', isDark);
        try { localStorage.setItem(KEY, mode); } catch(e) {}
        document.querySelectorAll('.theme-btn').forEach(function(btn) {
          btn.classList.toggle('active', btn.getAttribute('data-theme') === mode);
        });
      }
      apply(getStored());
      document.querySelectorAll('.theme-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          apply(btn.getAttribute('data-theme'));
        });
      });
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
        if (getStored() === 'system') apply('system');
      });
    })();

    // ── i18n ──
    (function() {
      var LANG_KEY = 'aiusage-locale';
      function getStoredLang() {
        try { return localStorage.getItem(LANG_KEY) || 'zh'; } catch(e) { return 'zh'; }
      }
      function applyLang(lang) {
        document.querySelectorAll('.i18n').forEach(function(el) {
          el.textContent = el.getAttribute('data-' + lang) || el.textContent;
        });
        document.querySelectorAll('.lang-btn').forEach(function(btn) {
          btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
        });
        try { localStorage.setItem(LANG_KEY, lang); } catch(e) {}
      }
      applyLang(getStoredLang());
      document.querySelectorAll('.lang-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          applyLang(btn.getAttribute('data-lang'));
        });
      });
    })();

    // ── copy ──
    function copyCode(btn) {
      var code = btn.parentElement.querySelector('code').textContent;
      navigator.clipboard.writeText(code).then(function() {
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      });
    }
  </script>
</body>
</html>`;
}
