import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Pinch-to-zoom for text elements. Scales font-size + line-height directly
 * to avoid Safari font-boosting bugs with CSS zoom/transform:scale.
 *
 * Uses font-size scaling (not CSS zoom or transform) because Safari's text
 * autosizing treats <strong>/<em> children differently under zoom/scale,
 * causing bold/highlighted text to render at wrong sizes.
 */

const BLOCK_TEXT = 'p, h1, h2, h3, h4, h5, h6, li';
const ZOOM_MIN = 1;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.05;

function applyZoomToElements(container: HTMLElement, level: number) {
  const els = container.querySelectorAll<HTMLElement>(BLOCK_TEXT);
  for (const el of els) {
    // Skip nested elements (avoid compounding)
    const ancestorBlock = el.parentElement?.closest(BLOCK_TEXT);
    if (ancestorBlock && container.contains(ancestorBlock)) continue;

    if (level === 1) {
      el.style.removeProperty('font-size');
      el.style.removeProperty('line-height');
      delete el.dataset.origFs;
      delete el.dataset.origLh;
    } else {
      if (!el.dataset.origFs) {
        el.dataset.origFs = getComputedStyle(el).fontSize;
        el.dataset.origLh = getComputedStyle(el).lineHeight;
      }
      const origFs = parseFloat(el.dataset.origFs!);
      const origLh = parseFloat(el.dataset.origLh!);
      el.style.fontSize = `${origFs * level}px`;
      // lineHeight can return "normal" → parseFloat("normal") = NaN
      if (!isNaN(origLh)) el.style.lineHeight = `${origLh * level}px`;
    }
  }
}

/** Anchor scroll position to nearest visible element to prevent content jump. */
function scrollAnchor(container: HTMLElement, fn: () => void) {
  const els = container.querySelectorAll<HTMLElement>(BLOCK_TEXT);
  const vh = window.innerHeight;
  const center = vh / 2;
  let closest: HTMLElement | null = null;
  let closestDist = Infinity;

  for (const el of els) {
    const rect = el.getBoundingClientRect();
    const d = Math.abs(rect.top + rect.height / 2 - center);
    if (d < closestDist) {
      closestDist = d;
      closest = el;
    }
  }

  const topBefore = closest?.getBoundingClientRect().top ?? 0;
  fn();
  if (closest) {
    const drift = closest.getBoundingClientRect().top - topBefore;
    if (Math.abs(drift) > 0.5) window.scrollBy(0, drift);
  }
}

export function usePinchTextZoom(enabled = true) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);

  // Apply zoom whenever level changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    scrollAnchor(container, () => applyZoomToElements(container, zoomLevel));
  }, [zoomLevel, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const container = containerRef.current;
      if (container) applyZoomToElements(container, 1);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    function getDistance(touches: TouchList) {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchStartDist.current = getDistance(e.touches);
        pinchStartZoom.current = zoomLevel;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      // Prevent native pinch zoom
      e.preventDefault();

      const dist = getDistance(e.touches);
      const ratio = dist / pinchStartDist.current;
      const newZoom = Math.round(
        Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinchStartZoom.current * ratio)) / ZOOM_STEP
      ) * ZOOM_STEP;

      setZoomLevel(newZoom);
    }

    // Prevent Safari's native gesture zoom
    function onGestureStart(e: Event) {
      e.preventDefault();
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('gesturestart', onGestureStart);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('gesturestart', onGestureStart);
    };
  }, [enabled, zoomLevel]);

  const resetZoom = useCallback(() => setZoomLevel(1), []);

  return { containerRef, zoomLevel, resetZoom };
}
