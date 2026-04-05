import { useRef, useEffect, useState, useCallback } from 'react';

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.05;

// Only target .card — the leaf visual blocks (not grid wrappers like .fade-up)
const ZOOM_TARGETS = '.card';

function findAnchorElement(container: HTMLElement): { el: HTMLElement; top: number } | null {
  const viewCenter = window.innerHeight / 2;
  const els = container.querySelectorAll<HTMLElement>(ZOOM_TARGETS);
  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < els.length; i++) {
    const rect = els[i].getBoundingClientRect();
    if (rect.height === 0) continue;
    const dist = Math.abs(rect.top + rect.height / 2 - viewCenter);
    if (dist < bestDist) {
      bestDist = dist;
      best = els[i];
    }
  }

  return best ? { el: best, top: best.getBoundingClientRect().top } : null;
}

function applyZoom(container: HTMLElement, level: number, anchor?: boolean) {
  const anchorInfo = anchor ? findAnchorElement(container) : null;

  const els = container.querySelectorAll<HTMLElement>(ZOOM_TARGETS);
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    // Skip nested targets (avoid compounding)
    const parent = el.parentElement?.closest(ZOOM_TARGETS);
    if (parent && container.contains(parent)) continue;

    if (level === 1) {
      el.style.removeProperty('--zoom-scale');
    } else {
      el.style.setProperty('--zoom-scale', String(level));
    }
  }

  if (anchorInfo) {
    const drift = anchorInfo.el.getBoundingClientRect().top - anchorInfo.top;
    if (Math.abs(drift) > 0.5) {
      window.scrollBy(0, drift);
    }
  }
}

export function usePinchTextZoom() {
  const containerRef = useRef<HTMLElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const stored = parseFloat(localStorage.getItem('aiusage-text-zoom') ?? '1');
    return isNaN(stored) ? 1 : Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, stored));
  });
  const [isGesturing, setIsGesturing] = useState(false);
  const [gesturePosition, setGesturePosition] = useState<{ x: number; y: number } | null>(null);

  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const zoomRef = useRef(zoomLevel);
  zoomRef.current = zoomLevel;
  const pointerPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);

  const doZoom = useCallback((level: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
    const stepped = Math.round(clamped / ZOOM_STEP) * ZOOM_STEP;
    setZoomLevel(stepped);
    zoomRef.current = stepped;
    localStorage.setItem('aiusage-text-zoom', String(stepped));
    if (containerRef.current) {
      applyZoom(containerRef.current, stepped, true);
    }
  }, []);

  const showGesture = useCallback(() => {
    setIsGesturing(true);
    setGesturePosition({ ...pointerPos.current });
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setIsGesturing(false);
      setGesturePosition(null);
    }, 800);
  }, []);

  // Initial zoom application + MutationObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (zoomRef.current !== 1) {
      applyZoom(container, zoomRef.current);
    }

    const observer = new MutationObserver(() => {
      if (zoomRef.current !== 1) {
        applyZoom(container, zoomRef.current);
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  // Gesture handling: pinch, Ctrl+wheel, keyboard
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerMove = (e: PointerEvent) => {
      pointerPos.current = { x: e.clientX, y: e.clientY };
    };

    function getDistance(touches: TouchList) {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchStartDist.current = getDistance(e.touches);
        pinchStartZoom.current = zoomRef.current;
      }
    }

    function onTouchMoveHandler(e: TouchEvent) {
      if (e.touches.length >= 2) {
        pointerPos.current = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
      if (e.touches.length !== 2) return;
      e.preventDefault();

      const dist = getDistance(e.touches);
      const ratio = dist / pinchStartDist.current;
      doZoom(pinchStartZoom.current * ratio);
      showGesture();
    }

    // Desktop: Ctrl/Cmd + scroll wheel
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      doZoom(zoomRef.current + delta);
      showGesture();
    }

    // Keyboard: Cmd/Ctrl + +/-/0
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        doZoom(zoomRef.current + 0.1);
        showGesture();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        doZoom(zoomRef.current - 0.1);
        showGesture();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        doZoom(1);
        showGesture();
      }
    }

    // Prevent Safari's proprietary gesture events
    const onGestureStart = (e: Event) => e.preventDefault();

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMoveHandler, { passive: false });
    container.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('gesturestart', onGestureStart);
    document.addEventListener('gesturechange', onGestureStart);

    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMoveHandler);
      container.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('gesturestart', onGestureStart);
      document.removeEventListener('gesturechange', onGestureStart);
      clearTimeout(hideTimer.current);
    };
  }, [doZoom, showGesture]);

  return {
    containerRef,
    zoomLevel,
    isGesturing,
    gesturePosition,
  };
}
