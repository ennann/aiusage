/**
 * Shared page shell for server-rendered HTML pages (pricing, embed-docs).
 * Provides consistent header, controls bar, theme/i18n JS, and logo detection.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** CSS variables and base styles shared by all pages. */
export function shellCss(): string {
  return `
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
      justify-content: center;
      height: 56px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-left a {
      text-decoration: none;
      color: inherit;
      display: flex;
      align-items: center;
      gap: 10px;
      border-radius: 8px;
      padding: 4px 8px;
      margin: -4px -8px;
      transition: background 0.15s;
    }
    .header-left a:hover {
      background: var(--card-border);
    }
    .site-logo {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid rgba(0,0,0,0.08);
    }
    html.dark .site-logo {
      border-color: rgba(255,255,255,0.12);
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

    /* ── controls bar ── */
    .controls-bar {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      padding: 12px 0;
    }

    /* ── toggle buttons ── */
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
  `;
}

/** Header HTML with logo detection + subtitle. */
export function shellHeader(siteTitle: string, subtitle: string): string {
  return `
  <header class="header">
    <div class="container header-inner">
      <div class="header-left">
        <a href="/">
          <img class="site-logo" id="site-logo" src="/logo-person.png" alt="" style="display:none"/>
          <svg class="logo-icon" id="default-icon" viewBox="0 0 200 160" fill="none" width="28" height="22">
            <path d="M22 112 C30 112 38 90 44 82 C50 74 54 78 58 88 C62 98 64 116 70 120 C76 124 80 108 86 84 C92 60 96 22 104 16 C112 10 116 36 120 64 C124 92 126 138 134 140 C142 142 146 108 152 72 C158 36 162 14 168 16 C174 18 178 50 182 68" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="logo-text">${escapeHtml(siteTitle)}<span>/ ${escapeHtml(subtitle)}</span></div>
        </a>
      </div>
    </div>
  </header>`;
}

/** Controls bar: language toggle + theme toggle. */
export function shellControls(): string {
  return `
  <div class="container controls-bar">
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
  </div>`;
}

/** Shared JS for theme, i18n, and logo detection. */
export function shellScript(): string {
  return `
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
        document.querySelectorAll('[data-theme]').forEach(function(btn) {
          btn.classList.toggle('active', btn.getAttribute('data-theme') === mode);
        });
      }
      apply(getStored());
      document.querySelectorAll('[data-theme]').forEach(function(btn) {
        btn.addEventListener('click', function() { apply(btn.getAttribute('data-theme')); });
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
        btn.addEventListener('click', function() { applyLang(btn.getAttribute('data-lang')); });
      });
    })();

    // ── logo detection ──
    (function() {
      var img = new Image();
      img.onload = function() {
        var logo = document.getElementById('site-logo');
        var icon = document.getElementById('default-icon');
        if (logo) logo.style.display = '';
        if (icon) icon.style.display = 'none';
      };
      img.src = '/logo-person.png';
    })();
  `;
}
