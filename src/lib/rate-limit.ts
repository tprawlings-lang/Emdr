// Minimal in-process fixed-window rate limiter. Steady runs as a single
// instance (the in-process backup scheduler depends on it), so an in-memory
// limiter is sufficient; a multi-instance deploy would need a shared store
// (Redis) — tracked in docs/adr/0004.
//
// Used to protect the paid, model-backed companion endpoint from cost-abuse
// and accidental loops. Safety paths (crisis routing) are always exempt.

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();

  // Opportunistic prune so the map can't grow without bound.
  if (windows.size > 5000) {
    for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
  }

  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: w.resetAt - now };
  }
  w.count++;
  return { ok: true, remaining: limit - w.count, retryAfterMs: 0 };
}

/** Test/maintenance helper. */
export function resetRateLimits(): void {
  windows.clear();
}
