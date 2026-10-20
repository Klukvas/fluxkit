import type { AdminStockMovement, AdminVariantInventory } from "@fluxkit/api-client";
import type { BadgeVariant } from "@fluxkit/ui";

/**
 * How the Stock tab presents what the API answered (plan step 7, owner answers 11 and 12). Pure; the numbers shown are
 * always the server's, never computed ahead of an answer.
 */

/** A variant's stock state for its badge (text plus tone); the last two come before any quantity. */
export const STOCK_STATES = [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "not_tracked",
  "backorder",
] as const;
export type StockState = (typeof STOCK_STATES)[number];

export const STOCK_STATE_TONE: Record<StockState, BadgeVariant> = {
  in_stock: "success",
  low_stock: "warning",
  out_of_stock: "danger",
  not_tracked: "neutral",
  backorder: "neutral",
};

/**
 * core's `availabilityOf` (compared in the spec), told apart for the admin: an untracked variant and one that may be
 * backordered are always sellable (`in_stock` in the shop) but are named as such here. Otherwise the available units of
 * every location (`max(0, onHand - reserved)`) against `LOW_STOCK_THRESHOLD`: 0 out of stock, up to the threshold low.
 */
export function stockState(
  inventory: AdminVariantInventory,
  lowStockThreshold: number,
): StockState {
  if (!inventory.trackInventory) return "not_tracked";
  if (inventory.allowBackorder) return "backorder";
  const available = inventory.levels.reduce(
    (sum, level) => sum + Math.max(0, level.onHand - level.reserved),
    0,
  );
  if (available === 0) return "out_of_stock";
  return available <= lowStockThreshold ? "low_stock" : "in_stock";
}

/** On hand and reserved summed over the locations (whole numbers below 2^53); available is the server's total. */
export function levelTotals(inventory: AdminVariantInventory): {
  onHand: number;
  reserved: number;
  available: number;
} {
  let onHand = 0;
  let reserved = 0;
  for (const level of inventory.levels) {
    onHand += level.onHand;
    reserved += level.reserved;
  }
  return { onHand, reserved, available: inventory.totalAvailable };
}

/** The level at one location; a location without a level row holds nothing yet (the first change creates the row). */
export function levelAt(
  inventory: AdminVariantInventory | undefined,
  locationId: string,
): { onHand: number; reserved: number } {
  const found = inventory?.levels.find((level) => level.locationId === locationId);
  return { onHand: found?.onHand ?? 0, reserved: found?.reserved ?? 0 };
}

/** Who made a movement, without an API change (owner answer 11). */
export type ActorLabel =
  | { kind: "you" }
  | { kind: "email"; email: string }
  | { kind: "other"; shortId: string }
  | { kind: "system" };

/**
 * "You" for the signed-in admin; the email when the users list could be read (owners, `users.manage`; nobody else
 * makes that request); otherwise "another admin" with the first eight characters of the id; no actor is the system
 * (an order's sale, the demo seed, or an admin deleted since).
 */
export function actorLabel(
  actorId: string | null,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): ActorLabel {
  if (actorId === null) return { kind: "system" };
  if (actorId === meId) return { kind: "you" };
  const email = emails?.get(actorId);
  if (email !== undefined) return { kind: "email", email };
  return { kind: "other", shortId: actorId.slice(0, 8) };
}

/** What the reloaded journal says after an adjustment: its newest movement compared with the one seen before sending. */
export type AdjustmentCheck = "new_by_you" | "new_by_other" | "none_new";

export function adjustmentCheck(
  previousTopId: string | null,
  top: AdminStockMovement | null,
  meId: string,
): AdjustmentCheck {
  if (top === null || top.id === previousTopId) return "none_new";
  return top.actorId === meId ? "new_by_you" : "new_by_other";
}
