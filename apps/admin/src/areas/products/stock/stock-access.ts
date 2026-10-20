import type { AdminResult } from "@fluxkit/api-client";
import { canRun } from "../../../permissions";
import type { WriteOutcome } from "../../../lib/run-write";

/**
 * What the Prices and Stock tabs offer, from the permission list of `GET /admin/auth/me` only (never a role name), and
 * the one way a stock adjustment is sent. The API decides anyway; hiding is convenience.
 */

export interface StockSections {
  /** The adjustment form (`adjustInventory`: `catalog.write`). */
  adjust: boolean;
  /** The reservations list (`listReservations`: `orders.read`, because it links orders). */
  reservations: boolean;
  /** The users list, to name the journal's admins by email (`listUsers`: `users.manage`, owners; no request otherwise). */
  userEmails: boolean;
}

export function stockSections(permissions: readonly string[] | null): StockSections {
  return {
    adjust: canRun(permissions, "adjustInventory"),
    reservations: canRun(permissions, "listReservations"),
    userEmails: canRun(permissions, "listUsers"),
  };
}

export function priceControls(permissions: readonly string[] | null): {
  write: boolean;
  remove: boolean;
} {
  return {
    write: canRun(permissions, "putProductPrices"),
    remove: canRun(permissions, "deleteVariantPrice"),
  };
}

/**
 * Sends one adjustment exactly once (no retry, owner answer 12) and then, whatever the answer (accepted, refused, or lost),
 * reloads the levels and the journal so the admin sees what the server holds and whether the change landed. Only a screen
 * that went away (abort) reloads nothing.
 */
export async function runAdjustment<T>(
  submit: (write: () => Promise<AdminResult<T>>) => Promise<WriteOutcome<T>>,
  write: () => Promise<AdminResult<T>>,
  reload: () => void,
): Promise<WriteOutcome<T>> {
  const outcome = await submit(write);
  if (outcome.kind !== "aborted") reload();
  return outcome;
}
