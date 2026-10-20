import type { AdjustInventoryBody, StockAdjustmentKind } from "@fluxkit/api-client";

/**
 * The stock adjustment form's model (plan step 7, owner answer 12; `docs/api/inventory.md`): kind, a change (`delta`) or a
 * counted quantity (`setOnHand`), the location (named only when there is more than one), reason and reference. It predicts
 * the API's answer from the last level read with a copy of core's `decideAdjustment` order (compared with core in the spec),
 * so an impossible change is explained before anything is sent; the server decides under its row lock all the same and its
 * refusal is shown as it comes. A change that lowers stock and every counted quantity are confirmed. Whole numbers only:
 * the text is checked as digits and computed with BigInt, never through a float. No React, no client.
 */

/** core's `MAX_ON_HAND` (10^9; compared in the spec). */
export const MAX_ON_HAND = 1_000_000_000;
/** The adjustment body's limits (`docs/api/openapi.json`; compared in the spec). */
export const REASON_MAX_LENGTH = 500;
export const REFERENCE_MAX_LENGTH = 255;

/** The kinds an admin may book, in the API's order (`sale` is written by orders only). */
export const ADJUSTMENT_KINDS = [
  "receipt",
  "adjustment",
  "return",
] as const satisfies readonly StockAdjustmentKind[];

export type AdjustmentMode = "delta" | "setOnHand";

export interface AdjustmentValues {
  kind: StockAdjustmentKind;
  mode: AdjustmentMode;
  quantity: string;
  /** The chosen location (the default one when there is only one). */
  locationId: string;
  reason: string;
  reference: string;
}

/** Why the form does not send; each has a message `products.stock.issue.<issue>`. */
export const ADJUSTMENT_ISSUES = [
  "quantity_required",
  "invalid_quantity",
  "no_change",
  "kind_requires_increase",
  "negative_on_hand",
  "on_hand_out_of_range",
  "below_reserved",
  "location_required",
  "reason_too_long",
  "reference_too_long",
] as const;
export type AdjustmentIssue = (typeof ADJUSTMENT_ISSUES)[number];

export type AdjustmentField = "quantity" | "locationId" | "reason" | "reference";

/** `lower`: the change removes units; `set`: a counted quantity replaces the stock (the server computes the delta). */
export type AdjustmentConfirmation = "lower" | "set";

export type AdjustmentPlan =
  | {
      ok: true;
      body: AdjustInventoryBody;
      /** Predicted from the last read; the server's answer and the reloaded journal are what count. */
      change: { before: number; after: number; delta: number };
      confirm: AdjustmentConfirmation | null;
    }
  | { ok: false; issues: Partial<Record<AdjustmentField, AdjustmentIssue>> };

export interface LevelFacts {
  onHand: number;
  reserved: number;
}

export function newAdjustmentValues(defaultLocationId: string): AdjustmentValues {
  return {
    kind: "receipt",
    mode: "delta",
    quantity: "",
    locationId: defaultLocationId,
    reason: "",
    reference: "",
  };
}

/** A receipt or a return adds the units that arrived; only a correction may count the stock (`setOnHand`). */
export function modesFor(kind: StockAdjustmentKind): AdjustmentMode[] {
  return kind === "adjustment" ? ["delta", "setOnHand"] : ["delta"];
}

export function withKind(values: AdjustmentValues, kind: StockAdjustmentKind): AdjustmentValues {
  return { ...values, kind, mode: modesFor(kind).includes(values.mode) ? values.mode : "delta" };
}

/** More digits than this cannot matter: the value is then far beyond every bound, with its sign kept. */
const MAX_DIGITS = 20;
const WHOLE_NUMBER = /^(-?)([0-9]+)$/;

function parseWholeNumber(text: string): bigint | "invalid" {
  const match = WHOLE_NUMBER.exec(text);
  if (match === null) return "invalid";
  const significant = (match[2] ?? "").replace(/^0+/, "");
  if (match[1] === "-" && significant === "") return "invalid";
  const magnitude =
    significant.length > MAX_DIGITS ? 10n ** BigInt(MAX_DIGITS) : BigInt(significant || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

/** core's `decideAdjustment`, in its order: no change, kind, below zero, above the bound, below the reserved units. */
function quantityIssue(
  kind: StockAdjustmentKind,
  delta: bigint,
  after: bigint,
  level: LevelFacts,
): AdjustmentIssue | null {
  if (delta === 0n) return "no_change";
  if (delta < 0n && kind !== "adjustment") return "kind_requires_increase";
  if (after < 0n) return "negative_on_hand";
  if (after > BigInt(MAX_ON_HAND)) return "on_hand_out_of_range";
  if (delta < 0n && after < BigInt(level.reserved)) return "below_reserved";
  return null;
}

export function planAdjustment(
  values: AdjustmentValues,
  level: LevelFacts,
  options: { locationCount: number },
): AdjustmentPlan {
  const issues: Partial<Record<AdjustmentField, AdjustmentIssue>> = {};
  const text = values.quantity.trim();
  const mode: AdjustmentMode = modesFor(values.kind).includes(values.mode) ? values.mode : "delta";
  let delta = 0n;
  let after = 0n;
  if (text === "") {
    issues.quantity = "quantity_required";
  } else {
    const parsed = parseWholeNumber(text);
    if (parsed === "invalid") {
      issues.quantity = "invalid_quantity";
    } else {
      const before = BigInt(level.onHand);
      delta = mode === "delta" ? parsed : parsed - before;
      after = mode === "delta" ? before + parsed : parsed;
      const issue = quantityIssue(values.kind, delta, after, level);
      if (issue !== null) issues.quantity = issue;
    }
  }
  if (options.locationCount > 1 && values.locationId === "")
    issues.locationId = "location_required";
  const reason = values.reason.trim();
  const reference = values.reference.trim();
  if (reason.length > REASON_MAX_LENGTH) issues.reason = "reason_too_long";
  if (reference.length > REFERENCE_MAX_LENGTH) issues.reference = "reference_too_long";
  if (Object.keys(issues).length > 0) return { ok: false, issues };

  const amount = Number(mode === "delta" ? delta : after);
  const body: AdjustInventoryBody = {
    kind: values.kind,
    ...(mode === "delta" ? { delta: amount } : { setOnHand: amount }),
    ...(options.locationCount > 1 ? { locationId: values.locationId } : {}),
    ...(reason === "" ? {} : { reason }),
    ...(reference === "" ? {} : { reference }),
  };
  const change = { before: level.onHand, after: Number(after), delta: Number(delta) };
  const confirm: AdjustmentConfirmation | null =
    mode === "setOnHand" ? "set" : delta < 0n ? "lower" : null;
  return { ok: true, body, change, confirm };
}
