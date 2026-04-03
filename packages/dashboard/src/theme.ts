export type ThemeMode = 'light' | 'dark' | 'system';

export function getStoredTheme(): ThemeMode {
  try { return (localStorage.getItem('aiusage-theme') as ThemeMode) ?? 'system'; }
  catch { return 'system'; }
}

export function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  try { localStorage.setItem('aiusage-theme', mode); } catch {}
}
