import type { AdminResult } from "@fluxkit/api-client";
import { canRun } from "../../../permissions";
import type { WriteOutcome } from "../../../lib/run-write";
import type { PlannedItem, PricePlan } from "../prices/price-grid";
import type { AdjustmentPlan } from "./stock-adjustment";

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

export type ReadyAdjustment = Extract<AdjustmentPlan, { ok: true }>;

/** What the Stock tab's submit needs, as plain values and callbacks (the tab passes its state and setters). */
export interface AdjustmentSubmit {
  /** The tab's single flight holds a write (true before React renders the busy state). */
  writing: boolean;
  /** The form's rendered busy state. */
  busy: boolean;
  /** The newest movement is still loading: a lost answer is judged against it, so nothing is sent before it is known. */
  waiting: boolean;
  plan: () => AdjustmentPlan;
  showIssues: (issues: Extract<AdjustmentPlan, { ok: false }>["issues"]) => void;
  clearResult: () => void;
  confirm: (plan: ReadyAdjustment) => void;
  send: (plan: ReadyAdjustment) => void;
}

/**
 * The Stock tab's submit (tested on its own, step 13 review G07): nothing at all while a write runs or the newest
 * movement loads; local issues are shown without sending; a change that lowers stock below the reserved quantity (and
 * the other confirmations of `planAdjustment`) asks first; otherwise the adjustment is sent.
 */
export function submitAdjustment(parts: AdjustmentSubmit): void {
  if (parts.writing || parts.busy || parts.waiting) return;
  const plan = parts.plan();
  if (!plan.ok) {
    parts.showIssues(plan.issues);
    return;
  }
  parts.clearResult();
  if (plan.confirm !== null) {
    parts.confirm(plan);
    return;
  }
  parts.send(plan);
}

/** What the Prices tab's bulk save needs, as plain values and callbacks. */
export interface PriceSave {
  /** A save of this grid runs (the form's single flight, or its rendered busy state). */
  busy: boolean;
  plan: () => PricePlan;
  showIssues: (issues: Extract<PricePlan, { ok: false }>["issues"]) => void;
  /** No cell changed: nothing is sent. */
  nothingChanged: () => void;
  /** The keys of the cells in this save, for mapping the server's field errors back to them. */
  rememberSent: (keys: readonly string[]) => void;
  submit: (items: readonly PlannedItem[]) => Promise<WriteOutcome<unknown>>;
  onSaved: (count: number) => void;
  onUnknown: () => void;
}

/**
 * The Prices tab's bulk save (tested on its own, step 13 review G06): nothing at all while a save runs (not even the
 * plan, which would replace the sent keys the running save's answer is mapped with); local issues are shown without
 * sending; an unchanged grid sends nothing; otherwise one `PUT` with every changed cell.
 */
export async function savePrices(parts: PriceSave): Promise<void> {
  if (parts.busy) return;
  const plan = parts.plan();
  if (!plan.ok) {
    parts.showIssues(plan.issues);
    return;
  }
  if (plan.items.length === 0) {
    parts.nothingChanged();
    return;
  }
  parts.rememberSent(plan.items.map((entry) => entry.key));
  const outcome = await parts.submit(plan.items);
  if (outcome.kind === "ok") parts.onSaved(plan.items.length);
  else if (outcome.kind === "unknown") parts.onUnknown();
}
