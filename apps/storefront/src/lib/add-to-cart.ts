/**
 * Quantity per cart line: 1 to 999 (docs/api/cart.md). The API still validates it; the cart store checks it first only to
 * avoid a pointless request. The request itself, its failures and the cart answer live in `lib/cart-store.ts`.
 */
export const MIN_LINE_QUANTITY = 1;
export const MAX_LINE_QUANTITY = 999;

/** Units one more add may still put on a line that already holds `inCart` (0 when the line is full). */
export function lineRoom(inCart: number): number {
  return Math.max(0, MAX_LINE_QUANTITY - inCart);
}

export interface AddQuantityRefusal {
  messageKey: "product.quantity.atLimit" | "product.quantity.overLimit";
  values: { count: number; max: number; room: number };
}

/**
 * Why adding `quantity` to a line that holds `inCart` cannot work, or `null` when it fits (review SQ-02: the API's
 * `quantity_limit` text does not know that the shopper typed 1 to a line of 999, so the product page says it with the
 * cart's own number). `inCart` comes from the cart the browser last read; the API still judges the request.
 */
/**
 * The words for the API's `quantity_limit` answer: the "already N in the cart" text when the cart was read again after the
 * refusal (`freshInCart`), else `null` and the caller keeps the API's own message (PR 213 review m1: a quantity the tab
 * read earlier may be stale when another tab changed the line). `null` too when the fresh quantity says the add fits
 * (the cart changed again): no sentence the cart contradicts.
 */
export function quantityLimitRefusal(
  quantity: number,
  freshInCart: number | undefined,
): AddQuantityRefusal | null {
  return freshInCart === undefined ? null : addQuantityRefusal(quantity, freshInCart);
}

export function addQuantityRefusal(quantity: number, inCart: number): AddQuantityRefusal | null {
  const room = lineRoom(inCart);
  if (quantity <= room) return null;
  return {
    messageKey: room === 0 ? "product.quantity.atLimit" : "product.quantity.overLimit",
    values: { count: inCart, max: MAX_LINE_QUANTITY, room },
  };
}
