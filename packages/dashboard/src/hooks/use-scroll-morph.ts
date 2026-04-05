import { useRef, useEffect } from 'react';

const MIN_SCALE = 0.92;
const SIGMA = 0.4;

// Target only .card elements — the leaf visual blocks of the dashboard
const MORPH_SELECTOR = '.card';

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
    // Disable on mobile — cards fill the viewport so morph looks jittery
    if (window.innerWidth < 640) return;

    let rafId = 0;
    let lastScrollY = window.scrollY;
    let cachedEls: HTMLElement[] = [];

    const refreshCache = () => {
      cachedEls = Array.from(container.querySelectorAll<HTMLElement>(MORPH_SELECTOR));
    };
    refreshCache();

    const update = () => {
      const viewportH = window.innerHeight;
      const viewCenter = viewportH / 2;
      const sigmaPixels = viewportH * SIGMA;

      for (let i = 0; i < cachedEls.length; i++) {
        const el = cachedEls[i];
        if (el.closest('[data-morph-ignore]')) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -100 || rect.top > viewportH + 100) continue;

        const proximity = getProximity(rect, viewCenter, sigmaPixels);
        const scale = MIN_SCALE + (1 - MIN_SCALE) * proximity;
        el.style.setProperty('--morph-scale', scale.toFixed(3));
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
      for (const el of cachedEls) el.style.removeProperty('--morph-scale');
    };
  }, []);

  return { containerRef };
}
