import { assertValidFlags, assertValidLevel } from "./types.js";
import type { StockFlags, StockLevel } from "./types.js";

export type Availability = "in_stock" | "low_stock" | "out_of_stock";

/**
 * Public availability of one variant (ADR 0011): never a quantity. Available is the sum over levels of
 * `max(0, onHand - reserved)`. A variant that is not tracked, or may be backordered, is always `in_stock`.
 * Otherwise 0 is `out_of_stock`, 1 up to the threshold is `low_stock`, above it `in_stock`.
 * Every input is validated first, even when the flags make it irrelevant, so bad data never hides.
 * Throws RangeError for a threshold that is not a non-negative integer, bad flags or corrupt levels.
 */
export function availabilityOf(
  flags: StockFlags,
  levels: readonly StockLevel[],
  lowStockThreshold: number,
): Availability {
  assertValidFlags(flags);
  if (!Number.isSafeInteger(lowStockThreshold) || lowStockThreshold < 0) {
    throw new RangeError("The low stock threshold must be a non-negative integer");
  }
  let available = 0;
  for (const level of levels) {
    assertValidLevel(level);
    available += Math.max(0, level.onHand - level.reserved);
  }
  if (!flags.trackInventory || flags.allowBackorder) {
    return "in_stock";
  }
  if (available === 0) {
    return "out_of_stock";
  }
  return available <= lowStockThreshold ? "low_stock" : "in_stock";
}
