import { useEffect, useState, useSyncExternalStore } from 'react';

const CACHE_KEY = 'aiusage_usd_cny_rate';
const CACHE_TTL = 4 * 3600 * 1000; // 4h
export type CurrencyMode = 'auto' | 'USD' | 'CNY';

// ── global currency store ──

let _rate: number | null = null;
let _showCny = localStorage.getItem('aiusage_currency') === 'cny';
const _listeners = new Set<() => void>();

function notify() { _listeners.forEach(fn => fn()); }

export function setCnyRate(r: number) { _rate = r; notify(); }
export function toggleCurrency() {
  _showCny = !_showCny;
  localStorage.setItem('aiusage_currency', _showCny ? 'cny' : 'usd');
  notify();
}
export function getShowCny() { return _showCny; }
export function getCnyRate() { return _rate; }

/** Convert USD amount based on current toggle state or an explicit override. */
export function convertUsd(usd: number, currency: CurrencyMode = 'auto'): { value: number; prefix: string } {
  const showCny = currency === 'CNY' || (currency === 'auto' && _showCny);
  if (showCny && _rate) return { value: usd * _rate, prefix: '¥' };
  return { value: usd, prefix: '$' };
}

export function useCurrencyStore() {
  const snap = useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => `${_showCny}|${_rate}`,
  );
  return { showCny: _showCny, rate: _rate, snap };
}

// ── fetch hook (call once at root) ──

export function useFetchCnyRate() {
  const [loaded, setLoaded] = useState(_rate !== null);

  useEffect(() => {
    // try cache
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { rate, ts } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL) {
          setCnyRate(rate);
          setLoaded(true);
          return;
        }
      }
    } catch { /* ignore */ }

    fetch('https://open.er-api.com/v6/latest/USD')
      .then(r => r.json())
      .then((data: { rates?: { CNY?: number } }) => {
        const cny = data.rates?.CNY;
        if (cny) {
          setCnyRate(cny);
          localStorage.setItem(CACHE_KEY, JSON.stringify({ rate: cny, ts: Date.now() }));
          setLoaded(true);
        }
      })
      .catch(() => {});
  }, []);

  return loaded;
}
