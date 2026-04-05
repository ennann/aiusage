import { useEffect, useRef } from 'react';

/**
 * Scroll-morph fisheye: elements near viewport center scale to 1,
 * elements far from center scale down to MIN_SCALE.
 *
 * Text elements get scale-only morph (preserves highlight colors).
 * Media/chart elements get opacity-only morph (avoids distortion).
 */

const TEXT_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, span.kpi-value, .section-header';
const MEDIA_SELECTOR = '.recharts-wrapper, img, picture, video, svg.chart-icon';
const CARD_SELECTOR = '.card';

const MIN_SCALE = 0.92;
const MIN_OPACITY = 0.7;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

export function useScrollMorph(enabled = true) {
  const containerRef = useRef<HTMLElement | null>(null);
  const cachedCards = useRef<HTMLElement[]>([]);
  const rafId = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const refreshCache = () => {
      cachedCards.current = Array.from(
        container.querySelectorAll<HTMLElement>(CARD_SELECTOR)
      );
    };

    refreshCache();

    const observer = new MutationObserver(() => {
      refreshCache();
      requestAnimationFrame(update);
    });
    observer.observe(container, { childList: true, subtree: true });

    function update() {
      const vh = window.innerHeight;
      const center = vh / 2;

      for (const card of cachedCards.current) {
        if (card.hasAttribute('data-morph-ignore')) continue;

        const rect = card.getBoundingClientRect();
        const elCenter = rect.top + rect.height / 2;
        const dist = Math.abs(elCenter - center);
        const maxDist = vh * 0.8;
        const ratio = clamp(1 - dist / maxDist, 0, 1);

        // Cards get a subtle scale
        const scale = MIN_SCALE + (1 - MIN_SCALE) * ratio;
        card.style.setProperty('--morph-scale', String(scale));

        // Media inside cards gets opacity
        const opacity = MIN_OPACITY + (1 - MIN_OPACITY) * ratio;
        card.style.setProperty('--morph-opacity', String(opacity));
      }
    }

    function onScroll() {
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    // Initial paint
    requestAnimationFrame(update);

    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId.current);
      observer.disconnect();
      for (const card of cachedCards.current) {
        card.style.removeProperty('--morph-scale');
        card.style.removeProperty('--morph-opacity');
      }
    };
  }, [enabled]);

  return containerRef;
}
