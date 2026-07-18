import { useEffect, useState } from 'react';

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

let cachedHasLogo: boolean | null = null;

function probeImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function useHasLogo(): boolean | null {
  const [has, setHas] = useState<boolean | null>(cachedHasLogo);
  useEffect(() => {
    if (cachedHasLogo !== null) return;
    probeImage('/logo.png').then((ok) => {
      cachedHasLogo = ok;
      setHas(ok);
    });
  }, []);
  return has;
}

// ── Dynamic favicon from logo.png (circular crop) ──

let faviconApplied = false;

export function useFaviconFromLogo() {
  const hasLogo = useHasLogo();

  useEffect(() => {
    if (faviconApplied || !hasLogo) return;
    faviconApplied = true;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // Clip to circle
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // Draw image (cover fit)
      const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

      const dataUrl = canvas.toDataURL('image/png');

      // Replace existing favicon link
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.type = 'image/png';
      link.href = dataUrl;
    };
    img.src = '/logo.png';
  }, [hasLogo]);
}

// ── Public components ──

/** Header logo (28px round). */
export function HeaderLogo() {
  const hasLogo = useHasLogo();
  if (hasLogo === null || !hasLogo) return <span className="h-7 w-7">{DEFAULT_ICON}</span>;
  return <SimpleLogo size={28} />;
}

/** Footer logo (14px round). */
export function FooterLogo() {
  const hasLogo = useHasLogo();
  if (hasLogo === null || !hasLogo) return <span className="h-3.5 w-3.5">{DEFAULT_ICON}</span>;
  return <SimpleLogo size={14} />;
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
