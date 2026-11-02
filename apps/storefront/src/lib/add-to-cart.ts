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
export function addQuantityRefusal(quantity: number, inCart: number): AddQuantityRefusal | null {
  const room = lineRoom(inCart);
  if (quantity <= room) return null;
  return {
    messageKey: room === 0 ? "product.quantity.atLimit" : "product.quantity.overLimit",
    values: { count: inCart, max: MAX_LINE_QUANTITY, room },
  };
}
