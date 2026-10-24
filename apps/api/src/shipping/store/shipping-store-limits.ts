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
  /** The full point list of a city: 12 h fresh, at most 200 cities. */
  points: Object.freeze({ ttlMs: 12 * HOUR, staleIfErrorMs: 72 * HOUR, maxEntries: 200 }),
  /** Most points kept for one city; a longer list is cut and logged (a warning with the count). */
  pointsPerCity: 5_000,
  /** Points resolved one by one (`findPickupPoint`, the checkout): 12 h fresh, at most 2 000. Unknown refs are not cached. */
  pointsByRef: Object.freeze({ ttlMs: 12 * HOUR, staleIfErrorMs: 72 * HOUR, maxEntries: 2_000 }),
  /** Carrier estimates per (method, city, point, subtotal band): 10 minutes, never stale (a failure is `estimate: null`). */
  estimates: Object.freeze({ ttlMs: 10 * MINUTE, staleIfErrorMs: 0, maxEntries: 2_000 }),
  /** Width of the subtotal band of the estimate cache, in minor units (500.00 in a two-decimal currency). */
  estimateSubtotalBand: 50_000,
  /** Provider calls in flight per provider and process (ADR 0029 decision 6), and how many more may wait. */
  maxCallsInFlight: 4,
  maxCallsQueued: 32,
  /** `Retry-After` of `503 shipping_provider_unavailable`. */
  retryAfterSeconds: 30,
  /** Most methods the options endpoint reads (a shop has a handful). */
  maxMethods: 100,
});

/** The band an estimate is cached under: `floor(subtotal / band)`. Informational only: never part of a price. */
export function estimateSubtotalBand(subtotalAmount: number): number {
  return Math.floor(subtotalAmount / SHIPPING_STORE_LIMITS.estimateSubtotalBand);
}
