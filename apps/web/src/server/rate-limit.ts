// Fixed-window rate limiter kept in process memory. Fine for one server; swap the store for
// Redis when Opal runs on more than one instance.
type Bucket = { count: number; resetAt: number };

const g = globalThis as unknown as { __opalRate?: Map<string, Bucket> };
const store = (g.__opalRate ??= new Map());

export type RateResult = { ok: boolean; remaining: number; retryAfter: number };

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateResult {
  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    store.set(key, b);
  }
  b.count += 1;
  if (store.size > 50_000) sweep(now);
  const ok = b.count <= max;
  return { ok, remaining: Math.max(0, max - b.count), retryAfter: ok ? 0 : Math.ceil((b.resetAt - now) / 1000) };
}

function sweep(now: number) {
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}

/** Named limits used across the API. */
export const LIMITS = {
  chat: { max: 30, windowMs: 60_000 },
  write: { max: 120, windowMs: 60_000 },
  read: { max: 600, windowMs: 60_000 },
  gate: { max: 6, windowMs: 15 * 60_000 },
  upload: { max: 20, windowMs: 60 * 60_000 },
  attachments: { max: 60, windowMs: 10 * 60_000 },
  secrets: { max: 30, windowMs: 60_000 },
} as const;
