/**
 * Quantity per cart line: 1 to 999 (docs/api/cart.md). The API still validates it; the cart store checks it first only to
 * avoid a pointless request. The request itself, its failures and the cart answer live in `lib/cart-store.ts`.
 */
export const MIN_LINE_QUANTITY = 1;
export const MAX_LINE_QUANTITY = 999;
