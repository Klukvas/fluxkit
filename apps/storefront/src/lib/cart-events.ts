/**
 * The smallest client-side cart signal (plan, step 5): the product page tells the header's cart badge that the cart changed,
 * with the item count the API just returned. A browser `CustomEvent` on `window`: no store, no context, no dependency.
 * Step 6 builds the cart context on this: it keeps listening here (or replaces it with a context that publishes the same
 * `{ itemCount }`), so the badge does not need to change again.
 */

export const CART_CHANGED_EVENT = "fluxkit:cart-changed";

export interface CartChange {
  /** `itemCount` of the cart answer: the total quantity of all lines, as the API counted it. */
  itemCount: number;
}

function target(given: EventTarget | undefined): EventTarget {
  return given ?? window;
}

export function publishCartChange(change: CartChange, on?: EventTarget): void {
  if (!Number.isSafeInteger(change.itemCount) || change.itemCount < 0) {
    throw new RangeError("A cart item count must be a whole number from 0.");
  }
  target(on).dispatchEvent(new CustomEvent<CartChange>(CART_CHANGED_EVENT, { detail: change }));
}

function isCartChange(value: unknown): value is CartChange {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemCount" in value &&
    typeof value.itemCount === "number" &&
    Number.isSafeInteger(value.itemCount) &&
    value.itemCount >= 0
  );
}

/** Returns the function that removes the listener. */
export function subscribeToCartChanges(
  listener: (change: CartChange) => void,
  on?: EventTarget,
): () => void {
  const eventTarget = target(on);
  const handler = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (isCartChange(detail)) listener(detail);
  };
  eventTarget.addEventListener(CART_CHANGED_EVENT, handler);
  return () => eventTarget.removeEventListener(CART_CHANGED_EVENT, handler);
}
