import type { FetchLike } from "@fluxkit/api-client";

/**
 * Time limits of every API call (review M1). Without one, a hung API holds a socket and a render for undici's default 300
 * seconds on the server, and a hung write leaves a form disabled for good in the browser. Internal constants, not
 * configuration: they are the staleness and patience the storefront accepts, like `CATALOG_REVALIDATE_SECONDS`.
 */

/** Server-side catalog reads: short, so the last good copy or `error.tsx` takes over quickly. */
export const SERVER_READ_TIMEOUT_MS = 8_000;
/** Browser reads (cart, account, orders). */
export const BROWSER_READ_TIMEOUT_MS = 15_000;
/** Browser writes, including the checkout. A timed-out checkout keeps its idempotency key, so a retry cannot double-order. */
export const BROWSER_WRITE_TIMEOUT_MS = 30_000;

/**
 * True for a request that ran into its time limit: `fetch` rejects with the signal's reason, a `TimeoutError` (what
 * `AbortSignal.timeout` produces), possibly wrapped as the `cause` of the client's `NetworkError`. A caller's own abort is an
 * `AbortError` and is NOT a timeout, so it is never reported as "try again".
 */
export function isTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ((current as { name?: unknown }).name === "TimeoutError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface TimeoutOptions {
  readMs?: number;
  writeMs?: number;
  /** The signal that ends after `ms`; `AbortSignal.timeout` by default, injectable for tests. */
  signalFor?: (ms: number) => AbortSignal;
}

/**
 * Wraps a `fetch` so every request ends after a limit: reads (GET and HEAD) get the read limit, everything else the write
 * limit. A signal the caller already put on the request still ends it too.
 */
export function withTimeout(fetchImpl: FetchLike, options: TimeoutOptions = {}): FetchLike {
  const readMs = options.readMs ?? BROWSER_READ_TIMEOUT_MS;
  const writeMs = options.writeMs ?? BROWSER_WRITE_TIMEOUT_MS;
  const signalFor = options.signalFor ?? ((ms: number) => AbortSignal.timeout(ms));
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    const limit = signalFor(method === "GET" || method === "HEAD" ? readMs : writeMs);
    const signal =
      init.signal === undefined || init.signal === null
        ? limit
        : AbortSignal.any([init.signal, limit]);
    return fetchImpl(url, { ...init, signal });
  };
}
