/*
 * Numbers of the store shipping routes that ADR 0029 decision 6 and open question 4 left to plan step 6. Internal, not a
 * public contract (docs/api/shipping.md lists them). Nova Poshta list sizes could not be measured (no key, plan step 7a), so
 * the bounds are chosen for memory: a point is about 300 bytes in memory, a city about 150 bytes.
 */

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export const SHIPPING_STORE_LIMITS = Object.freeze({
  /** City searches by provider, locale and normalized query: 24 h fresh, at most 1 000 searches (about 15 MB at worst). */
  cities: Object.freeze({ ttlMs: 24 * HOUR, staleIfErrorMs: 72 * HOUR, maxEntries: 1_000 }),
  /** Most cities one search keeps (pages of `GET .../cities` are cut from these). */
  citiesPerSearch: 100,
  /**
   * The full point list of a city: 12 h fresh, at most 200 cities and at most 100 000 points in all (about 30 MB at worst;
   * before the step 13 review fixes only the city count bounded it, 200 x 5 000 points, about 300 MB). Empty lists are
   * never kept here (review m-2): see `emptyPointLists`.
   */
  points: Object.freeze({ ttlMs: 12 * HOUR, staleIfErrorMs: 72 * HOUR, maxEntries: 200 }),
  /** The most points all cached city lists hold together (LRU eviction by weight). */
  maxCachedPoints: 100_000,
  /**
   * City refs the carrier answered with no point (an unknown or random ref, or a city without points): 10 minutes, at most
   * 1 000, never stale. A separate bound, so a flood of random refs cannot evict a real city (review m-2).
   */
  emptyPointLists: Object.freeze({ ttlMs: 10 * MINUTE, staleIfErrorMs: 0, maxEntries: 1_000 }),
  /** Most points kept for one city; a longer list is cut and logged (a warning with the count). */
  pointsPerCity: 5_000,
  /** Points resolved one by one (`findPickupPoint`, the checkout): 12 h fresh, at most 2 000. Only found points are kept. */
  pointsByRef: Object.freeze({ ttlMs: 12 * HOUR, staleIfErrorMs: 72 * HOUR, maxEntries: 2_000 }),
  /**
   * Point refs the carrier does not know: 5 minutes, at most 1 000, never stale (review m-2). A point opened meanwhile is
   * found after at most 5 minutes; a repeated unknown ref costs no carrier call meanwhile.
   */
  unknownPointRefs: Object.freeze({ ttlMs: 5 * MINUTE, staleIfErrorMs: 0, maxEntries: 1_000 }),
  /** Carrier estimates per (method, city, point, subtotal band): 10 minutes, never stale (a failure is `estimate: null`). */
  estimates: Object.freeze({ ttlMs: 10 * MINUTE, staleIfErrorMs: 0, maxEntries: 2_000 }),
  /** Width of the subtotal band of the estimate cache, in minor units (500.00 in a two-decimal currency). */
  estimateSubtotalBand: 50_000,
  /** Provider calls in flight per provider and process (ADR 0029 decision 6), and how many more may wait (per priority). */
  maxCallsInFlight: 4,
  maxCallsQueued: 32,
  /**
   * Of `maxCallsInFlight`, the slots only the checkout's pickup point lookup may use (review m-2): store lookups, options
   * and estimates share the other 3, so a flood of them cannot make checkouts answer `503`.
   */
  maxCallsReservedForCheckout: 1,
  /** `Retry-After` of `503 shipping_provider_unavailable`. */
  retryAfterSeconds: 30,
  /** Most methods the options endpoint reads (a shop has a handful). */
  maxMethods: 100,
});

/** The band an estimate is cached under: `floor(subtotal / band)`. Informational only: never part of a price. */
export function estimateSubtotalBand(subtotalAmount: number): number {
  return Math.floor(subtotalAmount / SHIPPING_STORE_LIMITS.estimateSubtotalBand);
}
