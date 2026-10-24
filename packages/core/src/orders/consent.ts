import { compareMoney, createMoney } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";

/*
 * The consent check of a checkout (ADR 0015; ADR 0029 decision 4). `expectedTotal` is what the shopper agreed to; it is
 * never a price. When it differs from what the server computed, the answer tells the shopper what to look at again:
 * - `cart_changed` (as before shipping existed): no method is chosen, or a line's price changed since the shopper last saw
 *   it (a `price_changed` notice). The cart's own change always comes first.
 * - `shipping_changed`: a method is chosen, no line price changed, and the total differs or the method is no longer
 *   available (`total` is `null`): only the shipping price or the method's availability changed. A client that still sends
 *   the subtotal as the total gets this answer too (ADR 0029, Consequences: steps 6, 9 and 10 ship together).
 * The caller answers "a line is missing or unavailable" as `cart_changed` before it gets here (that needs no total). No
 * clock, no I/O, outputs are frozen.
 */

export interface CheckoutConsentInput {
  /** The total the shopper saw, as sent (a valid, non-negative amount in any supported currency). */
  readonly expectedTotal: Money;
  /** Subtotal plus every charged adjustment; `null` only when the chosen shipping method is not available. */
  readonly total: Money | null;
  /** Whether the checkout names a shipping method. */
  readonly shippingSelected: boolean;
  /** Whether any line's current unit price differs from the price the shopper last saw. */
  readonly linePricesChanged: boolean;
}

export type CheckoutConsent =
  | { readonly ok: true }
  | { readonly ok: false; readonly answer: "cart_changed" | "shipping_changed" };

const AGREED: CheckoutConsent = Object.freeze({ ok: true as const });
const CART_CHANGED: CheckoutConsent = Object.freeze({
  ok: false as const,
  answer: "cart_changed" as const,
});
const SHIPPING_CHANGED: CheckoutConsent = Object.freeze({
  ok: false as const,
  answer: "shipping_changed" as const,
});

function checkedMoney(value: unknown, what: string): Money {
  const candidate = value as { amount?: unknown; currency?: unknown } | null | undefined;
  const created =
    typeof candidate === "object" && candidate !== null
      ? createMoney(candidate.amount, candidate.currency)
      : null;
  if (created === null || !created.ok || created.money.amount < 0) {
    throw new RangeError(`${what} must be valid, non-negative money`);
  }
  return created.money;
}

export function decideCheckoutConsent(input: CheckoutConsentInput): CheckoutConsent {
  const expected = checkedMoney(input.expectedTotal, "The expected total");
  if (input.total === null) {
    if (!input.shippingSelected) {
      throw new RangeError("Only an unavailable shipping method leaves the total unknown");
    }
  } else {
    const total = checkedMoney(input.total, "The total");
    const compared = compareMoney(total, expected);
    // Another currency never agrees (compareMoney refuses to compare across currencies).
    if (compared.ok && compared.ordering === 0) {
      return AGREED;
    }
  }
  if (!input.shippingSelected || input.linePricesChanged) {
    return CART_CHANGED;
  }
  return SHIPPING_CHANGED;
}
