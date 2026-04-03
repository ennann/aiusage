const WINDOW_MS = 60_000; // 60 秒
const MAX_REQUESTS = 30;  // 每窗口最大请求数

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

// 定期清理过期条目，防止内存泄漏
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 120_000; // 2 分钟

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  cleanup(now);

  const entry = store.get(ip);

  if (!entry || now >= entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  entry.count += 1;

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: 0 };
}
