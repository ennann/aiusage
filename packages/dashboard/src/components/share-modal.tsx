import { useCallback, useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas-pro';
import { Download, Copy, X, Share2, Check, Loader2 } from 'lucide-react';
import { ShareCard } from './share-card';
import type { ShareCardProps } from './share-card';
import { ShareDetailCard } from './share-detail-card';
import type { ShareDetailCardProps } from './share-detail-card';
import type { Locale } from '../i18n';

// ────────────────────────────────────────
// Types
// ────────────────────────────────────────

export type ShareModalProps = {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  cardData: Omit<ShareCardProps, 'locale'>;
  detailData?: Omit<ShareDetailCardProps, 'locale'>;
};

type ShareTab = 'compact' | 'detail';

// ────────────────────────────────────────
// i18n
// ────────────────────────────────────────

const MODAL_I18N = {
  en: {
    title: 'Share',
    compact: 'Compact',
    detail: 'Detail',
    saveImage: 'Save Image',
    copyImage: 'Copy Image',
    shareToX: 'Share to X',
    copied: 'Copied!',
    copyFailed: 'Copy failed, please save and share manually',
    generating: 'Generating...',
  },
  zh: {
    title: '分享',
    compact: '精简版',
    detail: '详细版',
    saveImage: '保存图片',
    copyImage: '复制图片',
    shareToX: '分享到 X',
    copied: '已复制！',
    copyFailed: '复制失败，请手动保存分享',
    generating: '生成中...',
  },
} as const;

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('toBlob returned null'));
    }, 'image/png');
  });
}

// ────────────────────────────────────────
// ShareModal
// ────────────────────────────────────────

export function ShareModal({ open, onClose, locale, cardData, detailData }: ShareModalProps) {
  const mt = MODAL_I18N[locale];
  const hasDetail = !!detailData;

  const compactRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<ShareTab>('compact');
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [canvasCache, setCanvasCache] = useState<Record<ShareTab, HTMLCanvasElement | null>>({ compact: null, detail: null });
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  // ── Animation ──
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [open]);

  // ── Generate preview when open or tab changes ──
  useEffect(() => {
    if (!open) {
      setPreviewUrl(null);
      setCanvasCache({ compact: null, detail: null });
      return;
    }

    // If cached, use it
    const cached = canvasCache[tab];
    if (cached) {
      setPreviewUrl(cached.toDataURL('image/png'));
      return;
    }

    const timer = setTimeout(async () => {
      const ref = tab === 'compact' ? compactRef : detailRef;
      if (!ref.current) return;
      setGenerating(true);
      try {
        const canvas = await captureElement(ref.current);
        setCanvasCache((prev) => ({ ...prev, [tab]: canvas }));
        setPreviewUrl(canvas.toDataURL('image/png'));
      } catch (e) {
        console.error('Failed to generate share image:', e);
      } finally {
        setGenerating(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [open, tab]);

  // ── ESC to close ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Actions ──
  const getCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const cached = canvasCache[tab];
    if (cached) return cached;

    const ref = tab === 'compact' ? compactRef : detailRef;
    if (!ref.current) return null;
    setGenerating(true);
    try {
      const canvas = await captureElement(ref.current);
      setCanvasCache((prev) => ({ ...prev, [tab]: canvas }));
      setPreviewUrl(canvas.toDataURL('image/png'));
      return canvas;
    } catch (e) {
      console.error('Failed to generate image:', e);
      return null;
    } finally {
      setGenerating(false);
    }
  }, [tab, canvasCache]);

  const handleSave = useCallback(async () => {
    const canvas = await getCanvas();
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-usage-${tab}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getCanvas, tab]);

  const handleCopy = useCallback(async () => {
    const canvas = await getCanvas();
    if (!canvas) return;
    try {
      const blob = await canvasToBlob(canvas);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(mt.copyFailed);
    }
  }, [getCanvas, mt.copyFailed]);

  const handleShareX = useCallback(async () => {
    await handleSave();
    const text = encodeURIComponent('My AI Usage Stats ✨ #AIUsage');
    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank', 'noopener,noreferrer');
  }, [handleSave]);

  const handleTabChange = useCallback((newTab: ShareTab) => {
    if (newTab === tab) return;
    setTab(newTab);
    setCopied(false);
    // previewUrl will be updated by the effect
  }, [tab]);

  if (!open) return null;

  return (
    <>
      {/* Off-screen render targets */}
      <div style={{ position: 'fixed', left: -9999, top: 0 }} aria-hidden="true">
        <div ref={compactRef} style={{ width: 480, height: 640 }}>
          <ShareCard locale={locale} {...cardData} />
        </div>
        {hasDetail && (
          <div ref={detailRef} style={{ width: 480 }}>
            <ShareDetailCard locale={locale} {...detailData} />
          </div>
        )}
      </div>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
          visible ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/0'
        }`}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Panel */}
        <div
          className={`relative flex w-full max-w-lg max-h-[90vh] flex-col rounded-[24px] border border-slate-200/80 bg-white shadow-[0_25px_60px_rgba(15,23,42,0.15)] dark:border-white/[0.08] dark:bg-[#141414] transition-all duration-300 ${
            visible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
          }`}
          role="dialog"
          aria-modal="true"
        >
          {/* Header + Tabs */}
          <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-300">
              <Share2 className="h-4 w-4" />
              {mt.title}
            </h2>
            <div className="flex items-center gap-2">
              {hasDetail && (
                <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06]">
                  {(['compact', 'detail'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTabChange(t)}
                      className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                        tab === t
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-[#222] dark:text-slate-200'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                      }`}
                    >
                      {mt[t]}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-white/[0.06] dark:hover:text-slate-300"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Preview — scrollable */}
          <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-3">
            <div className={`w-full overflow-hidden rounded-[16px] border border-slate-100 bg-slate-50 dark:border-white/[0.06] dark:bg-[#0d0d0d] ${tab === 'compact' ? 'max-w-[320px]' : ''}`}>
              {generating || !previewUrl ? (
                <div className={`flex items-center justify-center ${tab === 'compact' ? 'aspect-[3/4]' : 'min-h-[300px]'}`}>
                  <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-[12px]">{mt.generating}</span>
                  </div>
                </div>
              ) : (
                <img src={previewUrl} alt="Share preview" className="block w-full" draggable={false} />
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 gap-2 px-6 pb-5 pt-2">
            <button
              onClick={handleSave}
              disabled={generating}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-100 px-4 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-45 dark:bg-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.12]"
            >
              <Download className="h-4 w-4" />
              {mt.saveImage}
            </button>
            <button
              onClick={handleCopy}
              disabled={generating}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-100 px-4 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-45 dark:bg-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.12]"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">{mt.copied}</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  {mt.copyImage}
                </>
              )}
            </button>
            <button
              onClick={handleShareX}
              disabled={generating}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-45 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              {mt.shareToX}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
