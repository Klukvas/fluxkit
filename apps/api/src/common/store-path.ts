/**
 * Express matches paths case-insensitively and ignores a trailing slash, so `/STORE/x` reaches the same handler as
 * `/store/x`. Every check on "is this a store request" must be just as lenient or it can be bypassed (same reasoning
 * as `isAdminPath`).
 */
const STORE_PATH = /^\/store(?:\/|$)/i;

export function isStorePath(path: string): boolean {
  return STORE_PATH.test(path);
}

const STORE_ACCOUNT_PATH = /^\/store\/account(?:\/|$)/i;

/** `/store/account` and everything below it (customer accounts, later the customer's orders), matched like `isStorePath`. */
export function isStoreAccountPath(path: string): boolean {
  return STORE_ACCOUNT_PATH.test(path);
}

/**
 * Responses under `/store/account` carry personal data and session state and must never be stored by a browser or a
 * shared cache (errors included: 400, 401, 403, 409, 429), the public routes (register, login) too. A middleware
 * calls this for every request; the problem filter calls it too, for failures that happen before any middleware
 * runs (a body-parser 413).
 */
export function markStoreAccountResponseUncacheable(
  request: { path: string },
  response: { setHeader(name: string, value: string): unknown },
): void {
  if (isStoreAccountPath(request.path)) {
    response.setHeader("Cache-Control", "no-store");
  }
}

const STORE_CART_PATH = /^\/store\/cart(?:\/|$)/i;

/** `/store/cart` and everything below it, matched like `isStorePath`. */
export function isStoreCartPath(path: string): boolean {
  return STORE_CART_PATH.test(path);
}

/**
 * Cart responses depend on a cookie and change with every write: they must never be stored by a browser or a shared
 * cache, errors included. Called by the cart middleware and, like the account one, by the problem filter for failures
 * that happen before any middleware runs.
 */
export function markStoreCartResponseUncacheable(
  request: { path: string },
  response: { setHeader(name: string, value: string): unknown },
): void {
  if (isStoreCartPath(request.path)) {
    response.setHeader("Cache-Control", "no-store");
  }
}

const STORE_ORDER_PATH = /^\/store\/(?:checkout|orders)(?:\/|$)/i;

/** `/store/checkout` and `/store/orders` (the guest order routes), matched like `isStorePath`. */
export function isStoreOrderPath(path: string): boolean {
  return STORE_ORDER_PATH.test(path);
}

/**
 * Checkout and guest order responses carry personal data and access tokens: never stored by a browser or a shared cache,
 * errors included. The customer's own orders are under `/store/account` and covered by `markStoreAccountResponseUncacheable`.
 */
export function markStoreOrderResponseUncacheable(
  request: { path: string },
  response: { setHeader(name: string, value: string): unknown },
): void {
  if (isStoreOrderPath(request.path)) {
    response.setHeader("Cache-Control", "no-store");
  }
}

const STORE_SHIPPING_PATH = /^\/store\/shipping(?:\/|$)/i;

/** `/store/shipping` and everything below it (options and carrier lookups), matched like `isStorePath`. */
export function isStoreShippingPath(path: string): boolean {
  return STORE_SHIPPING_PATH.test(path);
}

/**
 * Shipping options depend on the cart cookie or the session and must never be stored; a lookup that fails must not be
 * stored either (a successful lookup replaces this with `public, max-age=300` in its handler).
 */
export function markStoreShippingResponseUncacheable(
  request: { path: string },
  response: { setHeader(name: string, value: string): unknown },
): void {
  if (isStoreShippingPath(request.path)) {
    response.setHeader("Cache-Control", "no-store");
  }
}
