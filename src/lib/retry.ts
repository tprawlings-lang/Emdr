// Small retry helper for external calls. Exponential backoff with full jitter.
// The Anthropic and AWS SDKs retry internally; this covers the hand-rolled
// `fetch` paths (e.g. the Resend alert) that otherwise fail on a single blip.
//
// `sleep` and `random` are injectable so the behaviour is deterministically
// testable without real timers.

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base backoff in ms (grows 2^n). Default 200. */
  baseMs?: number;
  /** Backoff cap in ms. Default 5000. */
  maxMs?: number;
  /** Decide whether an error is worth retrying. Default: always. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Observe each retry (logging/metrics). */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Injectable for tests. Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0,1). Default: Math.random. */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseMs = opts.baseMs ?? 200;
  const maxMs = opts.maxMs ?? 5000;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !shouldRetry(err, attempt)) break;
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = Math.round(backoff * (0.5 + random() * 0.5)); // 50–100% jitter
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** True for errors worth retrying on an HTTP call: network errors (no status)
 *  and transient server responses (429 / 5xx). A carried `status` field is
 *  honoured (set it when throwing on a non-ok response). */
export function isTransientHttpError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === undefined) return true; // thrown by fetch itself → network error
  return status === 429 || (status >= 500 && status < 600);
}
