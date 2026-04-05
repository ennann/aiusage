import { useRef, useEffect } from 'react';

const MIN_SCALE = 0.92;
const MIN_MEDIA_OPACITY = 0.7;
const SIGMA = 0.4;

const TEXT_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, span.kpi-value, .section-header, pre';
const MEDIA_SELECTOR = 'img, picture, figure, video, iframe, canvas, hr, .recharts-wrapper, svg[class*="chart"]';

function getProximity(rect: DOMRect, viewCenter: number, sigmaPixels: number): number {
  const elCenter = rect.top + rect.height / 2;
  const distance = Math.abs(elCenter - viewCenter);
  return Math.exp(-0.5 * (distance / sigmaPixels) ** 2);
}

export function useScrollMorph() {
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let rafId = 0;
    let lastScrollY = window.scrollY;
    let cachedTextEls: HTMLElement[] = [];
    let cachedMediaEls: HTMLElement[] = [];

    const refreshCache = () => {
      cachedTextEls = Array.from(container.querySelectorAll<HTMLElement>(TEXT_SELECTOR));
      cachedMediaEls = Array.from(container.querySelectorAll<HTMLElement>(MEDIA_SELECTOR));
    };
    refreshCache();

    const update = () => {
      const viewportH = window.innerHeight;
      const viewCenter = viewportH / 2;
      const sigmaPixels = viewportH * SIGMA;

      for (let i = 0; i < cachedTextEls.length; i++) {
        const el = cachedTextEls[i];
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -100 || rect.top > viewportH + 100) continue;

        const proximity = getProximity(rect, viewCenter, sigmaPixels);
        el.style.setProperty('--morph-scale', (MIN_SCALE + (1 - MIN_SCALE) * proximity).toFixed(3));
      }

      for (let i = 0; i < cachedMediaEls.length; i++) {
        const el = cachedMediaEls[i];
        if (el.tagName === 'IMG' && el.closest('picture')) continue;
        if (el.closest('[data-morph-ignore]')) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -100 || rect.top > viewportH + 100) continue;

        const proximity = getProximity(rect, viewCenter, sigmaPixels);
        el.style.setProperty('--morph-opacity', (MIN_MEDIA_OPACITY + (1 - MIN_MEDIA_OPACITY) * proximity).toFixed(3));
      }
    };

    const onScroll = () => {
      const currentY = window.scrollY;
      if (Math.abs(currentY - lastScrollY) < 2) return;
      lastScrollY = currentY;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);

    window.addEventListener('scroll', onScroll, { passive: true });

    const onResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };
    window.addEventListener('resize', onResize);

    const observer = new MutationObserver(() => {
      refreshCache();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      for (const el of cachedTextEls) el.style.removeProperty('--morph-scale');
      for (const el of cachedMediaEls) el.style.removeProperty('--morph-opacity');
    };
  }, []);

  return { containerRef };
}
