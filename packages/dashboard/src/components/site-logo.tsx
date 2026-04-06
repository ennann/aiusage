import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_ICON = (
  <svg viewBox="0 0 200 160" fill="none" className="h-full w-full" aria-hidden="true">
    <path
      d="M22 112 C30 112 38 90 44 82 C50 74 54 78 58 88 C62 98 64 116 70 120 C76 124 80 108 86 84 C92 60 96 22 104 16 C112 10 116 36 120 64 C124 92 126 138 134 140 C142 142 146 108 152 72 C158 36 162 14 168 16 C174 18 178 50 182 68"
      stroke="currentColor"
      strokeWidth="20"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ── Logo detection (cached per session) ──

type LogoMode = 'parallax' | 'single' | 'none';
let cachedMode: LogoMode | null = null;

function probeImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function useLogoMode(): LogoMode | null {
  const [mode, setMode] = useState<LogoMode | null>(cachedMode);
  useEffect(() => {
    if (cachedMode !== null) return;
    (async () => {
      const [hasPerson, hasBg, hasSingle] = await Promise.all([
        probeImage('/logo-person.png'),
        probeImage('/logo-bg.png'),
        probeImage('/logo.png'),
      ]);
      const m: LogoMode = hasPerson && hasBg ? 'parallax' : hasSingle ? 'single' : 'none';
      cachedMode = m;
      setMode(m);
    })();
  }, []);
  return mode;
}

// ── Public components ──

/** Header logo (28px round). */
export function HeaderLogo() {
  const mode = useLogoMode();
  if (mode === null || mode === 'none') return <span className="h-7 w-7">{DEFAULT_ICON}</span>;
  if (mode === 'single') return <SimpleLogo size={28} />;
  return <ParallaxLogo size={28} />;
}

/** Footer logo (14px round). */
export function FooterLogo() {
  const mode = useLogoMode();
  if (mode === null || mode === 'none') return <span className="h-3.5 w-3.5">{DEFAULT_ICON}</span>;
  if (mode === 'single') return <SimpleLogo size={14} />;
  return <ParallaxLogo size={14} />;
}

// ── Simple circular logo (single image) ──

function SimpleLogo({ size }: { size: number }) {
  return (
    <img
      src="/logo.png"
      alt="Logo"
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  );
}

// ── Parallax logo (bg + person layer, with mouse tracking) ──

function ParallaxLogo({ size }: { size: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const personRef = useRef<HTMLDivElement>(null);
  const isLarge = size > 20;
  const offsetY = isLarge ? 4 : 1;
  const intensity = isLarge ? 5 : 2;

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current;
    const person = personRef.current;
    if (!el || !person) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const mx = (e.clientX - rect.left - cx) / cx;
    const my = (e.clientY - rect.top - cy) / cy;
    person.style.transform = `scale(0.82) translate(${-mx * intensity}px, ${-my * intensity + offsetY}px)`;
  }, [intensity, offsetY]);

  const onLeave = useCallback(() => {
    const person = personRef.current;
    if (person) person.style.transform = `scale(0.82) translate(0, ${offsetY}px)`;
  }, [offsetY]);

  return (
    <div
      ref={containerRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group relative shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-white/50 shadow-md dark:border-[rgba(36,43,53,0.6)]"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
        style={{ backgroundImage: "url('/logo-bg.png')" }}
      />
      <div
        ref={personRef}
        className="absolute inset-0 bg-cover bg-center transition-transform duration-300 ease-out origin-bottom"
        style={{
          backgroundImage: "url('/logo-person.png')",
          transform: `scale(0.82) translate(0, ${offsetY}px)`,
        }}
      />
      <div className="absolute inset-0 rounded-full shadow-[inset_0_0_10px_rgba(0,0,0,0.15)] pointer-events-none" />
    </div>
  );
}
