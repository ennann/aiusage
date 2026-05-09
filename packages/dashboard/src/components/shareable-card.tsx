import { useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import html2canvas from 'html2canvas-pro';
import { Share2 } from 'lucide-react';
import { ShareModal } from './share-modal';
import type { Locale } from '../i18n';

const CAPTURE_SCALE = 2;

/**
 * Capture a DOM element to a data-URL PNG.
 * Uses html2canvas's `onclone` callback to strip borders / shadows / the share
 * button from the **cloned** DOM — the live page is never touched.
 */
async function capture(el: HTMLElement): Promise<string> {
  const canvas = await html2canvas(el, {
    scale: CAPTURE_SCALE,
    useCORS: true,
    backgroundColor: '#ffffff',
    onclone: (_doc, cloned) => {
      // Remove card border & shadow so the image is clean
      cloned.style.border = 'none';
      cloned.style.boxShadow = 'none';
      // Hide the share button inside the clone
      const btn = cloned.querySelector<HTMLElement>('[data-share-btn]');
      if (btn) btn.style.display = 'none';
    },
  });
  return canvas.toDataURL('image/png');
}

/**
 * Wraps a chart card with a hover-visible share button.
 *
 * Two capture modes:
 * 1. Default — screenshots the visible card (border removed in clone).
 * 2. With `shareContent` — renders a compact version off-screen at `shareWidth`,
 *    captures *that*, then unmounts it. The user never sees any layout shift.
 */
export function ShareableCard({
  children,
  locale,
  className = '',
  style,
  shareContent,
  shareWidth,
}: {
  children: React.ReactNode;
  locale: Locale;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Alternate (compact) content rendered off-screen and captured instead of the
   * visible card. Use for mobile-friendly shares (e.g. fewer weeks in heatmap).
   */
  shareContent?: React.ReactNode;
  /** Width (px) of the off-screen container when using shareContent. Default 400. */
  shareWidth?: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const offscreenRef = useRef<HTMLDivElement>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [renderingOffscreen, setRenderingOffscreen] = useState(false);

  const handleShare = useCallback(async () => {
    try {
      if (shareContent) {
        // Mount the off-screen container, let React render + charts settle
        setRenderingOffscreen(true);
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))),
        );
        const offEl = offscreenRef.current;
        if (!offEl) { setRenderingOffscreen(false); return; }
        const url = await capture(offEl);
        setRenderingOffscreen(false);
        setSnapshotUrl(url);
        setShareOpen(true);
      } else {
        const el = cardRef.current;
        if (!el) return;
        const url = await capture(el);
        setSnapshotUrl(url);
        setShareOpen(true);
      }
    } catch (e) {
      console.error('Failed to capture card:', e);
      setRenderingOffscreen(false);
    }
  }, [shareContent]);

  const handleClose = useCallback(() => {
    setShareOpen(false);
    setSnapshotUrl(null);
  }, []);

  return (
    <>
      <div
        ref={cardRef}
        className={`group/share relative ${className}`}
        style={style}
      >
        {children}

        <button
          data-share-btn
          onClick={handleShare}
          className="absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center text-slate-300 opacity-0 transition-all duration-200 hover:text-slate-500 group-hover/share:opacity-100 dark:text-slate-600 dark:hover:text-slate-400"
          aria-label="Share"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Off-screen render target for compact share content */}
      {renderingOffscreen && shareContent && createPortal(
        <div
          ref={offscreenRef}
          style={{
            position: 'fixed',
            left: -9999,
            top: 0,
            width: shareWidth ?? 400,
            background: '#ffffff',
            padding: 24,
            overflow: 'hidden',
          }}
          aria-hidden
        >
          {shareContent}
        </div>,
        document.body,
      )}

      {snapshotUrl && (
        <ShareModal
          open={shareOpen}
          onClose={handleClose}
          locale={locale}
          mode="snapshot"
          preSnapshotUrl={snapshotUrl}
        />
      )}
    </>
  );
}
