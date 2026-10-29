import type { SearchOutcome } from "./search-data";

/**
 * The storefront's own cache of the unfiltered catalog and category lists (review F1 of the search finish, ADR 0040). Pure:
 * the clock is injected; `search-data.server.ts` keeps one per server process.
 *
 * Why not the Next data cache: its key holds the request headers, so a cached read could not forward the shopper's address
 * (ADR 0038) and every miss counted against the Next server's one window of the API, which one client could use up for all
 * shoppers; `next start` also writes every entry to disk and never deletes one. Here the key is the locale and the query
 * only, the read of a miss carries the address of the shopper whose view missed, and the size is bounded.
 *
 * Decisions, each with a test:
 * - A results answer younger than `freshMs` is served without a read (the catalog minute).
 * - An older one is read again; when that read answers 429 or 503 (or the API cannot be reached), the last good answer is
 *   served while it is younger than `freshMs + staleMs` (stale while error). A cold miss or an older entry answers the
 *   failure, and the page falls back to the SQL listing with its notice.
 * - Failures are never kept. "Search is off" (404) and a refused selection (400) are answers, not outages: they drop the
 *   entry. A thrown read (an engine refusal, ADR 0036 decision 6) is not caught.
 * - At most `maxEntries` entries, the least recently used dropped first; concurrent misses of one key share one read.
 */

export interface SharedSearchCacheOptions {
  maxEntries: number;
  freshMs: number;
  staleMs: number;
  now?: () => number;
}

export interface SharedSearchCache {
  read(key: string, load: () => Promise<SearchOutcome>): Promise<SearchOutcome>;
  size(): number;
}

type Entry = { outcome: Extract<SearchOutcome, { kind: "results" }>; storedAt: number };

export function createSharedSearchCache(options: SharedSearchCacheOptions): SharedSearchCache {
  const { maxEntries, freshMs, staleMs } = options;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("A shared search cache needs a whole number of entries, at least 1.");
  }
  if (!Number.isFinite(freshMs) || !Number.isFinite(staleMs) || freshMs < 0 || staleMs < 0) {
    throw new Error("A shared search cache needs finite, non-negative windows.");
  }
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const flights = new Map<string, Promise<SearchOutcome>>();

  function remember(key: string, entry: Entry): void {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  async function refresh(key: string, load: () => Promise<SearchOutcome>): Promise<SearchOutcome> {
    const outcome = await load();
    switch (outcome.kind) {
      case "results":
        remember(key, { outcome, storedAt: now() });
        return outcome;
      case "rate_limited":
      case "unavailable": {
        const last = entries.get(key);
        if (last !== undefined && now() - last.storedAt < freshMs + staleMs) return last.outcome;
        return outcome;
      }
      case "disabled":
      case "invalid":
        entries.delete(key);
        return outcome;
    }
  }

  return {
    async read(key, load) {
      const entry = entries.get(key);
      if (entry !== undefined && now() - entry.storedAt < freshMs) {
        remember(key, entry);
        return entry.outcome;
      }
      const running = flights.get(key);
      if (running !== undefined) return running;
      const flight = refresh(key, load).finally(() => {
        flights.delete(key);
      });
      flights.set(key, flight);
      return flight;
    },
    size: () => entries.size,
  };
}
