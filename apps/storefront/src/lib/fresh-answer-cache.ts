/**
 * A small cache of read answers in the server process, used by `store-data.ts` for the product detail read. Pure: the clock
 * is injected.
 *
 * Why not the Next data cache: it keeps `200` answers only. Once a cached product is unpublished, archived or deleted, the
 * revalidation's `404` is dropped and the old product stays on the shop indefinitely, not for 60 s (seen in the e2e suite on
 * Next 16). Here the caller decides which answers are kept (`isKept`), so a "not found" is kept like a product and replaces
 * it. The key space stays bounded (a slug is a free value from the address): at most `maxEntries`, in memory, never on disk.
 *
 * Decisions, each with a test:
 * - An answer younger than `freshMs` is served without a read; an older one is read again.
 * - An answer `isKept` refuses is returned but not kept, and it drops the entry of its key.
 * - A read that throws is not caught and changes nothing.
 * - At most `maxEntries` entries, the least recently used dropped first; concurrent misses of one key share one read.
 */

export interface FreshAnswerCacheOptions<T> {
  maxEntries: number;
  freshMs: number;
  isKept: (answer: T) => boolean;
  now?: () => number;
}

export interface FreshAnswerCache<T> {
  read(key: string, load: () => Promise<T>): Promise<T>;
}

interface Entry<T> {
  answer: T;
  storedAt: number;
}

export function createFreshAnswerCache<T>(
  options: FreshAnswerCacheOptions<T>,
): FreshAnswerCache<T> {
  const { maxEntries, freshMs, isKept } = options;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("A fresh answer cache needs a whole number of entries, at least 1.");
  }
  if (!Number.isFinite(freshMs) || freshMs < 0) {
    throw new Error("A fresh answer cache needs a finite, non-negative window.");
  }
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry<T>>();
  const flights = new Map<string, Promise<T>>();

  function remember(key: string, entry: Entry<T>): void {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  /** The `finally` callback always runs after `flights.set` below, also when `load` throws at once. */
  function refresh(key: string, load: () => Promise<T>): Promise<T> {
    const started = (async () => {
      const answer = await load();
      if (isKept(answer)) remember(key, { answer, storedAt: now() });
      else entries.delete(key);
      return answer;
    })().finally(() => {
      if (flights.get(key) === started) flights.delete(key);
    });
    flights.set(key, started);
    return started;
  }

  return {
    read(key, load) {
      const entry = entries.get(key);
      if (entry !== undefined && now() - entry.storedAt < freshMs) {
        remember(key, entry);
        return Promise.resolve(entry.answer);
      }
      return flights.get(key) ?? refresh(key, load);
    },
  };
}
