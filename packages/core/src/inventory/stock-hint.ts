import { decideReserve } from "./decisions.js";
import { assertValidLevel } from "./types.js";
import type { StockFlags, StockLevel } from "./types.js";

export interface CartLineStockHint {
  /** The checkout, run now, would refuse this quantity with `insufficient_stock`. */
  readonly insufficientStock: boolean;
  /**
   * The units that can be reserved now, ONLY when the line is short and that number is at most the low-stock threshold;
   * otherwise `null`, so a cart never broadcasts a stock count above the threshold.
   */
  readonly maxQuantity: number | null;
}

/**
 * What the checkout would say about a cart line's quantity at this moment (plan 2026-11-02-api-matched-variant-and-stock
 * -hints). The answer is core `decideReserve` itself on the level the checkout reserves from (the default location;
 * `null` when there is no level row, which holds nothing), so the hint and the checkout cannot disagree on the same
 * facts. A hint, not a hold: nothing is reserved and stock can change before the order.
 * Throws RangeError for corrupt levels or flags, a quantity that is not a whole number from 1, or a bad threshold.
 */
export function cartLineStockHint(
  flags: StockFlags,
  level: StockLevel | null,
  quantity: number,
  lowStockThreshold: number,
): CartLineStockHint {
  if (!Number.isSafeInteger(lowStockThreshold) || lowStockThreshold < 0) {
    throw new RangeError("The low stock threshold must be a non-negative integer");
  }
  const current = level ?? { onHand: 0, reserved: 0 };
  assertValidLevel(current);
  const decision = decideReserve(current, flags, quantity);
  if (!decision.ok && decision.reason === "invalid_quantity") {
    throw new RangeError("A cart line quantity must be a whole number from 1");
  }
  if (decision.ok || decision.reason !== "insufficient_stock") {
    // Enough, untracked (`not_tracked`), or a refusal that is not about the quantity on hand.
    return { insufficientStock: false, maxQuantity: null };
  }
  const reservable = Math.max(0, current.onHand - current.reserved);
  return {
    insufficientStock: true,
    maxQuantity: reservable <= lowStockThreshold ? reservable : null,
  };
}
