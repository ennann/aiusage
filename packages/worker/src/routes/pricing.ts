import { getPricingCatalog, type ModelPricing } from '../utils/pricing.js';
import { escapeHtml, shellCss, shellHeader, shellControls, shellScript } from '../utils/page-shell.js';
import type { Env } from '../types.js';

export function handlePricing(env: Env): Response {
  return new Response(renderPricingPage(env.SITE_TITLE || 'AI Usage'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/* ── provider branding ── */

interface ProviderBrand {
  color: string;
  logo: string;
}

const providerBrands: Record<string, ProviderBrand> = {
  anthropic: {
    color: '#D97757',
    logo: '<svg viewBox="0 0 256 256" fill="currentColor" width="24" height="24"><path d="M147.48 36h-39L18 220h39.6l17.52-37.44h105.48L198.72 220h39.6L147.48 36zm-30.48 115.2L145.44 76.8l28.08 74.4H117z"/></svg>',
  },
  openai: {
    color: '#10A37F',
    logo: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>',
  },
  google: {
    color: '#4285F4',
    logo: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
  },
  github: {
    color: '#24292F',
    logo: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
  },
  sourcegraph: {
    color: '#FF5543',
    logo: '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M14.39 1.54l8.07 8.07a2.73 2.73 0 010 3.86l-3.6 3.6-1.5-1.14 3.73-3.73a1.23 1.23 0 000-1.74l-7.34-7.34a1.23 1.23 0 00-1.74 0L8.28 6.85 6.78 5.71l3.75-3.75a2.73 2.73 0 013.86-.42zm-4.78 20.5l-8.07-8.07a2.73 2.73 0 010-3.86l3.6-3.6 1.5 1.14-3.73 3.73a1.23 1.23 0 000 1.74l7.34 7.34a1.23 1.23 0 001.74 0l3.73-3.73 1.5 1.14-3.75 3.75a2.73 2.73 0 01-3.86.42zM19.5 17.25a2.25 2.25 0 110 4.5 2.25 2.25 0 010-4.5zM4.5 2.25a2.25 2.25 0 110 4.5 2.25 2.25 0 010-4.5z"/></svg>',
  },
};

/* ── helpers ── */

function formatPrice(value: number | null, treatZeroAsDash = false): string {
  if (value === null) return '--';
  if (treatZeroAsDash && value === 0) return '--';
  if (value === 0) return '$0.00';
  if (value >= 1) return `$${value.toFixed(2)}`;
  // Sub-dollar: show enough digits to capture all significant figures
  const s = value.toString();
  const decimalPart = s.includes('.') ? s.split('.')[1] : '';
  const minDecimals = 2;
  const sigDigits = Math.max(minDecimals, decimalPart.length);
  return `$${value.toFixed(sigDigits)}`;
}

function countProducts(
  providers: Record<string, Record<string, { models: Record<string, ModelPricing> }>>,
): number {
  return Object.values(providers).reduce((sum, products) => sum + Object.keys(products).length, 0);
}

function countModels(
  providers: Record<string, Record<string, { models: Record<string, ModelPricing> }>>,
): number {
  return Object.values(providers).reduce(
    (sum, products) =>
      sum +
      Object.values(products).reduce(
        (innerSum, product) => innerSum + Object.keys(product.models).length,
        0,
      ),
    0,
  );
}

function isAnthropicProvider(provider: string): boolean {
  return provider.toLowerCase() === 'anthropic';
}

/* ── rendering ── */

function renderModelRow(model: string, pricing: ModelPricing, isAnthropic: boolean): string {
  const cacheWriteCols = isAnthropic
    ? `<td class="price">${formatPrice(pricing.cache_write_5m_per_million_usd, !isAnthropic)}</td>
       <td class="price">${formatPrice(pricing.cache_write_1h_per_million_usd, !isAnthropic)}</td>`
    : '';
  return `<tr>
    <td class="model-name">${escapeHtml(model)}</td>
    <td class="price">${formatPrice(pricing.input_per_million_usd)}</td>
    <td class="price">${formatPrice(pricing.cached_input_per_million_usd)}</td>
    ${cacheWriteCols}
    <td class="price">${formatPrice(pricing.output_per_million_usd)}</td>
  </tr>`;
}

function renderProductTable(
  product: string,
  models: Record<string, ModelPricing>,
  isAnthropic: boolean,
): string {
  const modelEntries = Object.entries(models).sort(([a], [b]) => a.localeCompare(b));
  const rows = modelEntries
    .map(([model, pricing]) => renderModelRow(model, pricing, isAnthropic))
    .join('');

  const cacheWriteHeaders = isAnthropic
    ? `<th class="price-header">CACHE WRITE 5M</th>
       <th class="price-header">CACHE WRITE 1H</th>`
    : '';

  return `<div class="product-block">
    <div class="product-header">
      <span class="product-name">${escapeHtml(product)}</span>
      <span class="model-count">${modelEntries.length} models</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="model-header">MODEL</th>
            <th class="price-header">INPUT</th>
            <th class="price-header">CACHE HIT</th>
            ${cacheWriteHeaders}
            <th class="price-header">OUTPUT</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function renderProviderSection(
  provider: string,
  products: Record<string, { models: Record<string, ModelPricing> }>,
): string {
  const brand = providerBrands[provider.toLowerCase()] ?? { color: '#6366f1', logo: '' };
  const isAnthropic = isAnthropicProvider(provider);
  const productCount = Object.keys(products).length;
  const modelCount = Object.values(products).reduce(
    (sum, p) => sum + Object.keys(p.models).length,
    0,
  );

  const productTables = Object.entries(products)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product, def]) => renderProductTable(product, def.models, isAnthropic))
    .join('');

  const displayName = provider.charAt(0).toUpperCase() + provider.slice(1);

  return `<section class="provider-section">
    <div class="provider-bar" style="--brand: ${brand.color}">
      <div class="provider-identity">
        <span class="provider-logo" style="color: ${brand.color}">${brand.logo}</span>
        <h2 class="provider-name">${escapeHtml(displayName)}</h2>
      </div>
      <div class="provider-meta">
        <span class="pill">${productCount} product${productCount > 1 ? 's' : ''}</span>
        <span class="pill">${modelCount} models</span>
      </div>
    </div>
    <div class="provider-body">
      ${productTables}
    </div>
  </section>`;
}

function renderPricingPage(siteTitle: string): string {
  const catalog = getPricingCatalog();

  const providerOrder = ['anthropic', 'openai', 'google', 'github', 'sourcegraph'];
  const sortedProviders = Object.entries(catalog.providers).sort(([a], [b]) => {
    const ai = providerOrder.indexOf(a.toLowerCase());
    const bi = providerOrder.indexOf(b.toLowerCase());
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const providerSections = sortedProviders
    .map(([provider, products]) => renderProviderSection(provider, products))
    .join('');

  const aliasRows = Object.entries(catalog.aliases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([source, target]) => `<tr>
        <td class="model-name">${escapeHtml(source)}</td>
        <td class="model-name">${escapeHtml(target)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(siteTitle)} - Model Pricing</title>
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

    ${shellCss()}

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

    /* ── stats bar ── */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin: 24px 0;
    }
    @media (max-width: 768px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 480px) {
      .stats { grid-template-columns: 1fr; }
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      padding: 16px 20px;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    /* ── provider sections ── */
    .providers {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 24px;
    }
    .provider-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      overflow: hidden;
    }
    .provider-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 20px;
      border-left: 4px solid var(--brand);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .provider-bar:hover {
      background: rgba(148,163,184,0.06);
    }
    html.dark .provider-bar:hover {
      background: rgba(148,163,184,0.04);
    }
    .provider-identity {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .provider-logo {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .provider-name {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .provider-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      background: rgba(148,163,184,0.1);
      white-space: nowrap;
    }
    html.dark .pill {
      background: rgba(148,163,184,0.08);
    }
    .chevron {
      color: var(--muted);
      transition: transform 0.2s;
      flex-shrink: 0;
      margin-left: 4px;
    }
    .provider-section.collapsed .chevron {
      transform: rotate(-90deg);
    }
    .provider-body {
      padding: 0 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .provider-section.collapsed .provider-body {
      display: none;
    }

    /* ── product block ── */
    .product-block {
      /* no extra card — just content */
    }
    .product-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .product-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }
    .model-count {
      font-size: 12px;
      color: var(--muted);
    }

    /* ── table ── */
    .table-scroll {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      white-space: nowrap;
    }
    th {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--row-border);
    }
    th.price-header {
      text-align: right;
    }
    td {
      padding: 8px 12px;
      font-size: 13px;
      border-bottom: 1px solid var(--row-border);
      vertical-align: middle;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .model-name {
      font-family: ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", monospace;
      font-size: 13px;
      font-weight: 400;
    }
    .price {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-size: 13px;
      color: var(--text);
    }
    /* Dash values are muted */
    .price:empty, td.price {
      color: var(--text);
    }

    /* ── aliases section ── */
    .aliases-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      padding: 20px;
      margin-bottom: 48px;
    }
    .aliases-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .aliases-title {
      font-size: 16px;
      font-weight: 600;
    }

    /* ── footer ── */
    .footer {
      text-align: center;
      padding: 24px 0 48px;
      font-size: 12px;
      color: var(--muted);
    }

    /* ── responsive table ── */
    @media (max-width: 640px) {
      .provider-bar {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
    }
  </style>
</head>
<body>
  ${shellHeader(siteTitle, 'Model Pricing')}
  ${shellControls()}

  <main class="container">
    <!-- stats bar -->
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Pricing Version</div>
        <div class="stat-value" style="font-size:15px; font-weight:600">${escapeHtml(catalog.version)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Providers</div>
        <div class="stat-value">${Object.keys(catalog.providers).length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Products</div>
        <div class="stat-value">${countProducts(catalog.providers)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Models</div>
        <div class="stat-value">${countModels(catalog.providers)}</div>
      </div>
    </div>

    <!-- provider sections -->
    <div class="providers">
      ${providerSections}
    </div>

    <!-- aliases -->
    <section class="aliases-section">
      <div class="aliases-header">
        <span class="aliases-title">Model Aliases</span>
        <span class="pill">${Object.keys(catalog.aliases).length} aliases</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>ALIAS</th>
              <th>RESOLVED MODEL</th>
            </tr>
          </thead>
          <tbody>${aliasRows}</tbody>
        </table>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="container">Prices are per 1M tokens (USD). Data from built-in Worker catalog.</div>
  </footer>

  <script>
    ${shellScript()}

    // ── collapsible providers ──
    document.querySelectorAll('.provider-bar').forEach(function(bar) {
      bar.addEventListener('click', function() {
        bar.parentElement.classList.toggle('collapsed');
      });
    });
  </script>
</body>
</html>`;
}
