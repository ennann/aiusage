import { useState, useCallback, useMemo } from 'react';
import { useLayout } from '../components/layout';
import type { Locale } from '../i18n';

// ────────────────────────────────────────
// Widget definitions
// ────────────────────────────────────────

const WIDGETS = [
  { id: 'stats-row1', nameZh: '指标卡 \u00b7 第一行', nameEn: 'KPI Cards \u00b7 Row 1', descZh: '预估费用、总 Token、输入、输出、缓存命中', descEn: 'Estimated cost, total tokens, input, output, cached tokens', height: 100, supportsItems: true, itemsNoteZh: '索引 0-4', itemsNoteEn: 'Index 0-4' },
  { id: 'stats-row2', nameZh: '指标卡 \u00b7 第二行', nameEn: 'KPI Cards \u00b7 Row 2', descZh: '活跃天数、会话数、单次费用、日均费用、缓存命中率', descEn: 'Active days, sessions, cost/session, avg daily cost, cache hit rate', height: 100, supportsItems: true, itemsNoteZh: '索引 0-4', itemsNoteEn: 'Index 0-4' },
  { id: 'cost-trend', nameZh: '费用趋势', nameEn: 'Cost Trend', descZh: '按天展示费用变化的柱状图，支持多厂商堆叠', descEn: 'Daily cost bar chart with multi-provider stacking', height: 360, supportsItems: false },
  { id: 'token-trend', nameZh: 'Token 趋势', nameEn: 'Token Trend', descZh: '按天展示各类 Token 用量的面积图', descEn: 'Daily token usage area chart by type', height: 380, supportsItems: false },
  { id: 'token-composition', nameZh: 'Token 构成', nameEn: 'Token Composition', descZh: '按天展示 Token 类型分布的堆叠柱状图', descEn: 'Daily token type distribution stacked bar chart', height: 380, supportsItems: false },
  { id: 'flow', nameZh: 'Token 流向', nameEn: 'Token Flow', descZh: '模型到项目的 Token 流向桑基图', descEn: 'Model-to-project token flow Sankey diagram', height: 420, supportsItems: false },
  { id: 'share', nameZh: '占比分析', nameEn: 'Share Analysis', descZh: '厂商、模型、设备的费用占比环形图', descEn: 'Provider, model, and device cost share donut charts', height: 480, supportsItems: true, itemsNoteZh: '0=厂商, 1=模型, 2=设备', itemsNoteEn: '0=Provider, 1=Model, 2=Device' },
] as const;

type WidgetId = (typeof WIDGETS)[number]['id'];

// ────────────────────────────────────────
// Segmented control (local, compact)
// ────────────────────────────────────────

function Seg<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-slate-100/80 p-0.5 dark:bg-[#1a1a1a]/80">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-all duration-150 ${
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-[#222222] dark:text-slate-300'
              : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────
// Toggle switch
// ────────────────────────────────────────

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors duration-150 ${
          checked ? 'bg-slate-900 dark:bg-slate-300' : 'bg-slate-200 dark:bg-[#333]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 dark:bg-[#111] ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </label>
  );
}

// ────────────────────────────────────────
// Copy button
// ────────────────────────────────────────

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all duration-150 ${
        copied
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-slate-100/80 text-slate-500 hover:text-slate-700 dark:bg-[#1a1a1a]/80 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

// ────────────────────────────────────────
// Auto-resize script
// ────────────────────────────────────────

const AUTO_RESIZE_SCRIPT = `<script>
window.addEventListener('message', function(e) {
  if (e.data && e.data.source === 'aiusage-embed' && e.data.height) {
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
</script>`;

// ────────────────────────────────────────
// Common params table data
// ────────────────────────────────────────

function getParamsTable(locale: Locale) {
  const isZh = locale === 'zh';
  return [
    { name: 'widget', values: WIDGETS.map((w) => w.id).join(', '), default: '-', desc: isZh ? '要渲染的组件 ID' : 'Widget ID to render', required: true },
    { name: 'items', values: '0,1,2,...', default: isZh ? '全部' : 'all', desc: isZh ? '仅显示指定索引的子项（逗号分隔）' : 'Show only specified sub-items by index (comma-separated)', required: false },
    { name: 'range', values: '7d, 30d, 90d, month, all', default: '30d', desc: isZh ? '数据时间范围' : 'Data time range', required: false },
    { name: 'theme', values: 'light, dark, auto', default: 'auto', desc: isZh ? '颜色主题' : 'Color theme', required: false },
    { name: 'transparent', values: '0, 1, true', default: '0', desc: isZh ? '启用透明背景' : 'Enable transparent background', required: false },
    { name: 'locale', values: 'en, zh', default: 'en', desc: isZh ? '界面语言' : 'Interface language', required: false },
    { name: 'deviceId', values: isZh ? '设备标识' : 'device identifier', default: '-', desc: isZh ? '仅显示指定设备的数据' : 'Show data for a specific device only', required: false },
    { name: 'product', values: isZh ? '产品标识' : 'product identifier', default: '-', desc: isZh ? '仅显示指定产品的数据' : 'Show data for a specific product only', required: false },
  ];
}

// ────────────────────────────────────────
// Page
// ────────────────────────────────────────

export function EmbedDocsPage() {
  const { locale, t } = useLayout();
  const isZh = locale === 'zh';

  // Config state
  const [selectedWidget, setSelectedWidget] = useState<WidgetId>(WIDGETS[0].id);
  const [themeOpt, setThemeOpt] = useState<'auto' | 'light' | 'dark'>('auto');
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'month' | 'all'>('30d');
  const [selectedLocale, setSelectedLocale] = useState<'en' | 'zh'>('en');
  const [transparent, setTransparent] = useState(false);
  const [items, setItems] = useState('');

  const widget = WIDGETS.find((w) => w.id === selectedWidget)!;

  // Build iframe src
  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams();
    params.set('widget', selectedWidget);
    params.set('theme', themeOpt);
    params.set('range', range);
    params.set('locale', selectedLocale);
    if (transparent) params.set('transparent', '1');
    if (widget.supportsItems && items.trim()) params.set('items', items.trim());
    return `/embed?${params.toString()}`;
  }, [selectedWidget, themeOpt, range, selectedLocale, transparent, items, widget.supportsItems]);

  // Build iframe HTML code
  const iframeCode = useMemo(() => {
    const h = widget.height;
    return `<iframe src="${iframeSrc}" width="100%" height="${h}" style="border:none;" loading="lazy"></iframe>`;
  }, [iframeSrc, widget.height]);

  const paramsTable = useMemo(() => getParamsTable(locale), [locale]);

  return (
    <div className="fade-up space-y-6">
      {/* ── Title ── */}
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900 dark:text-slate-300">
          {t.embedTitle}
        </h2>
        <p className="mt-1 text-[13px] text-slate-400 dark:text-slate-500">
          {t.embedDesc}
        </p>
      </div>

      {/* ── Widget Selector ── */}
      <div className="card p-5">
        <div className="mb-3 text-[12px] font-medium text-slate-500 dark:text-slate-400">
          {t.widgetType}
        </div>
        <div className="flex flex-wrap gap-2">
          {WIDGETS.map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedWidget(w.id)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-150 ${
                selectedWidget === w.id
                  ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-slate-100/80 text-slate-500 hover:text-slate-700 dark:bg-[#1a1a1a]/80 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {isZh ? w.nameZh : w.nameEn}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] text-slate-400 dark:text-slate-500">
          {isZh ? widget.descZh : widget.descEn}
        </p>
      </div>

      {/* ── Config Panel ── */}
      <div className="card p-5">
        <div className="mb-3 text-[12px] font-medium text-slate-500 dark:text-slate-400">
          {t.parameters}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {/* Theme */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-400 dark:text-slate-500">{t.theme}</span>
            <Seg
              value={themeOpt}
              options={[
                { value: 'auto' as const, label: 'Auto' },
                { value: 'light' as const, label: 'Light' },
                { value: 'dark' as const, label: 'Dark' },
              ]}
              onChange={setThemeOpt}
            />
          </div>

          {/* Range */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-400 dark:text-slate-500">{t.timeRange}</span>
            <Seg
              value={range}
              options={[
                { value: '7d' as const, label: '7D' },
                { value: '30d' as const, label: '30D' },
                { value: '90d' as const, label: '90D' },
                { value: 'month' as const, label: isZh ? '本月' : 'Month' },
                { value: 'all' as const, label: isZh ? '全部' : 'All' },
              ]}
              onChange={setRange}
            />
          </div>

          {/* Locale */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-400 dark:text-slate-500">{t.language}</span>
            <Seg
              value={selectedLocale}
              options={[
                { value: 'en' as const, label: 'EN' },
                { value: 'zh' as const, label: '中' },
              ]}
              onChange={setSelectedLocale}
            />
          </div>

          {/* Transparent */}
          <Toggle checked={transparent} onChange={setTransparent} label={t.transparent} />

          {/* Items (conditional) */}
          {widget.supportsItems && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-slate-400 dark:text-slate-500">
                {t.items}
                <span className="ml-1 text-[11px] text-slate-300 dark:text-slate-600">
                  ({isZh ? widget.itemsNoteZh : widget.itemsNoteEn})
                </span>
              </span>
              <input
                type="text"
                value={items}
                onChange={(e) => setItems(e.target.value)}
                placeholder="0,1,2"
                className="w-24 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-700 placeholder:text-slate-300 focus:border-slate-400 focus:outline-none dark:border-white/10 dark:bg-[#1a1a1a] dark:text-slate-300 dark:placeholder:text-slate-600 dark:focus:border-white/20"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Live Preview ── */}
      <div className="card p-5">
        <div className="mb-3 text-[12px] font-medium text-slate-500 dark:text-slate-400">
          {t.preview}
        </div>
        <div className="rounded-lg border-2 border-dashed border-slate-200 p-2 dark:border-white/10">
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            width="100%"
            height={widget.height}
            style={{ border: 'none', display: 'block' }}
            loading="lazy"
          />
        </div>
      </div>

      {/* ── Generated Code ── */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
            {t.generatedCode}
          </span>
          <CopyButton text={iframeCode} label={t.copyCode} copiedLabel={t.copied} />
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-[12px] leading-relaxed text-slate-700 dark:bg-[#0a0a0a] dark:text-slate-400">
          <code>{iframeCode}</code>
        </pre>
      </div>

      {/* ── Common Parameters Reference ── */}
      <div className="card p-5">
        <div className="mb-3 text-[12px] font-medium text-slate-500 dark:text-slate-400">
          {t.commonParams}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/[0.08]">
                <th className="pb-2 pr-4 font-medium text-slate-500 dark:text-slate-400">{t.paramName}</th>
                <th className="pb-2 pr-4 font-medium text-slate-500 dark:text-slate-400">{t.paramValues}</th>
                <th className="pb-2 pr-4 font-medium text-slate-500 dark:text-slate-400">{t.paramDefault}</th>
                <th className="pb-2 font-medium text-slate-500 dark:text-slate-400">{t.paramDesc}</th>
              </tr>
            </thead>
            <tbody>
              {paramsTable.map((row) => (
                <tr key={row.name} className="border-b border-slate-50 last:border-0 dark:border-white/[0.04]">
                  <td className="py-2 pr-4 font-mono text-slate-700 dark:text-slate-300">
                    {row.name}
                    {row.required && (
                      <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500 dark:bg-red-900/20 dark:text-red-400">
                        {t.required}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{row.values}</td>
                  <td className="py-2 pr-4 font-mono text-slate-500 dark:text-slate-400">{row.default}</td>
                  <td className="py-2 text-slate-500 dark:text-slate-400">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Auto Resize Script ── */}
      <div className="card p-5">
        <div className="mb-1 text-[12px] font-medium text-slate-500 dark:text-slate-400">
          {t.autoResize}
        </div>
        <p className="mb-3 text-[12px] text-slate-400 dark:text-slate-500">
          {t.autoResizeDesc}
        </p>
        <div className="flex items-center justify-end mb-2">
          <CopyButton text={AUTO_RESIZE_SCRIPT} label={t.copyCode} copiedLabel={t.copied} />
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-[12px] leading-relaxed text-slate-700 dark:bg-[#0a0a0a] dark:text-slate-400">
          <code>{AUTO_RESIZE_SCRIPT}</code>
        </pre>
      </div>
    </div>
  );
}
