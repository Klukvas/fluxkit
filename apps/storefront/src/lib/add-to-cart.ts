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

/**
 * What one more add may still put on a variant's line, from the cart the browser last read (plan 2026-11-03): the line
 * limit, and, when the API says the checkout would refuse the line for stock (`insufficientStock`), nothing more than the
 * count it gave (`maxQuantity`) minus the line's quantity, or nothing at all without a count. `stock` is that hint, for
 * the message. The API still judges every add; the cart's hint follows its answers.
 */
export function addRoom(
  line: { quantity: number; insufficientStock: boolean; maxQuantity: number | null } | undefined,
): { inCart: number; room: number; stock: { available: number | null } | null } {
  const inCart = line?.quantity ?? 0;
  const byLimit = lineRoom(inCart);
  if (line === undefined || !line.insufficientStock) return { inCart, room: byLimit, stock: null };
  const available = line.maxQuantity;
  const byStock = available === null ? 0 : Math.max(0, available - inCart);
  return { inCart, room: Math.min(byLimit, byStock), stock: { available } };
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
