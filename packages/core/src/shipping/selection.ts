import {
  CARRIER_REFERENCE_PATTERN,
  SHIPPING_METHOD_CODE_PATTERN,
  SHIPPING_METHOD_KINDS,
} from "./limits.js";
import type { ShippingMethodKind } from "./limits.js";

/*
 * The checkout's `shipping` member (ADR 0029 decision 4): `{methodCode, pickupPointRef?}`, strict. Three steps, all pure:
 * `parseShippingSelection` (shape), `decideShippingRequirement` (does this cart need, or refuse, a selection) and
 * `checkSelectionForKind` (the selected method's kind and the pickup point). Whether the method exists, is available
 * and what it costs is decided by the API with `decideMethodAvailability` and `decideShippingPrice` (`409
 * shipping_changed` when it is not available). No clock, no I/O.
 */

export interface ShippingSelection {
  readonly methodCode: string;
  /** The carrier's pickup point ref, only for a `pickup_point` method. */
  readonly pickupPointRef?: string;
}

/** What each kind needs (ADR 0029 decisions 4 and 7). Data, deeply frozen. */
export interface ShippingKindRule {
  /** `shippingAddress` must be sent (kind `address`). */
  readonly needsAddress: boolean;
  /** `pickupPointRef` must be sent; it is refused for the other kinds. */
  readonly needsPickupPoint: boolean;
  /**
   * Where the country of the availability check comes from: the address, the carrier (`pickup_point`; the API writes a
   * readable address from the point), or the address when one was given (`store_pickup`, ADR 0029 open question 5).
   */
  readonly countryFrom: "address" | "carrier" | "address_if_given";
}

export const SHIPPING_KIND_RULES: Readonly<Record<ShippingMethodKind, ShippingKindRule>> =
  Object.freeze({
    address: Object.freeze({ needsAddress: true, needsPickupPoint: false, countryFrom: "address" }),
    pickup_point: Object.freeze({
      needsAddress: false,
      needsPickupPoint: true,
      countryFrom: "carrier",
    }),
    store_pickup: Object.freeze({
      needsAddress: false,
      needsPickupPoint: false,
      countryFrom: "address_if_given",
    }),
  });

export type ShippingSelectionErrorReason =
  "not_an_object" | "unknown_field" | "required" | "not_a_string" | "invalid_format";

export interface ShippingSelectionError {
  /** The member inside `shipping` (`methodCode`, `pickupPointRef`, or an unknown key); empty for `shipping` itself. */
  readonly field: string;
  readonly reason: ShippingSelectionErrorReason;
}

export type ShippingSelectionResult =
  | { readonly ok: true; readonly selection: ShippingSelection }
  | { readonly ok: false; readonly errors: readonly ShippingSelectionError[] };

const SELECTION_FIELDS: readonly string[] = Object.freeze(["methodCode", "pickupPointRef"]);

/** Strict shape of the `shipping` member, every error at once. Values are taken as sent (no trimming, no case change). */
export function parseShippingSelection(value: unknown): ShippingSelectionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: [{ field: "", reason: "not_an_object" }] };
  }
  const record = value as Readonly<Record<string, unknown>>;
  const errors: ShippingSelectionError[] = [];
  for (const key of Object.keys(record)) {
    if (!SELECTION_FIELDS.includes(key)) {
      errors.push({ field: key, reason: "unknown_field" });
    }
  }
  const methodCode = record.methodCode;
  if (!Object.hasOwn(record, "methodCode") || methodCode === undefined) {
    errors.push({ field: "methodCode", reason: "required" });
  } else if (typeof methodCode !== "string") {
    errors.push({ field: "methodCode", reason: "not_a_string" });
  } else if (!SHIPPING_METHOD_CODE_PATTERN.test(methodCode)) {
    errors.push({ field: "methodCode", reason: "invalid_format" });
  }
  const pickupPointRef = Object.hasOwn(record, "pickupPointRef")
    ? record.pickupPointRef
    : undefined;
  if (pickupPointRef !== undefined) {
    if (typeof pickupPointRef !== "string") {
      errors.push({ field: "pickupPointRef", reason: "not_a_string" });
    } else if (!CARRIER_REFERENCE_PATTERN.test(pickupPointRef)) {
      errors.push({ field: "pickupPointRef", reason: "invalid_format" });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors: Object.freeze(errors) };
  }
  const selection: ShippingSelection =
    typeof pickupPointRef === "string"
      ? { methodCode: methodCode as string, pickupPointRef }
      : { methodCode: methodCode as string };
  return { ok: true, selection: Object.freeze(selection) };
}

export interface ShippingRequirementInput {
  /** The cart's `requiresShipping` (from `product_type.requires_shipping`). */
  readonly cartRequiresShipping: boolean;
  /** Whether the shop has at least one active method. */
  readonly activeMethodExists: boolean;
  /** The parsed `shipping` member, `undefined` when absent. */
  readonly selection: ShippingSelection | undefined;
}

export type ShippingRequirementDecision =
  /** No shipping charge and no snapshot: a cart that ships nothing, or a shop without an active method (today's behaviour). */
  | { readonly ok: true; readonly mode: "none" }
  /** Price the selected method (it may still be unavailable: `409 shipping_changed`). */
  | { readonly ok: true; readonly mode: "method"; readonly selection: ShippingSelection }
  | { readonly ok: false; readonly reason: "shipping_not_applicable" | "shipping_method_required" };

/**
 * ADR 0029 decision 4: a cart that ships nothing refuses a selection (`shipping_not_applicable`, so a stale client is
 * told); a cart that ships needs one once the shop has an active method (`shipping_method_required`); a shop with no
 * active method keeps the address-only checkout. A selection sent to such a shop is priced as usual and ends in
 * `shipping_changed` (no method can match).
 */
export function decideShippingRequirement(
  input: ShippingRequirementInput,
): ShippingRequirementDecision {
  if (
    typeof input.cartRequiresShipping !== "boolean" ||
    typeof input.activeMethodExists !== "boolean"
  ) {
    throw new RangeError("cartRequiresShipping and activeMethodExists must be booleans");
  }
  const { selection } = input;
  if (!input.cartRequiresShipping) {
    return selection === undefined
      ? Object.freeze({ ok: true as const, mode: "none" as const })
      : Object.freeze({ ok: false as const, reason: "shipping_not_applicable" as const });
  }
  if (selection !== undefined) {
    return Object.freeze({ ok: true as const, mode: "method" as const, selection });
  }
  return input.activeMethodExists
    ? Object.freeze({ ok: false as const, reason: "shipping_method_required" as const })
    : Object.freeze({ ok: true as const, mode: "none" as const });
}

export type SelectionForKindResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly field: "pickupPointRef";
      /** `required` for a `pickup_point` method without a ref; `not_applicable` for a ref sent to another kind. */
      readonly reason: "required" | "not_applicable";
    };

/** The pickup point rule of the selected method's kind (a `400 validation_failed` at `shipping.pickupPointRef`). */
export function checkSelectionForKind(
  kind: ShippingMethodKind,
  selection: ShippingSelection,
): SelectionForKindResult {
  if (!SHIPPING_METHOD_KINDS.includes(kind)) {
    throw new RangeError(`Unknown shipping method kind: ${String(kind)}`);
  }
  const hasRef = selection.pickupPointRef !== undefined;
  const needsRef = SHIPPING_KIND_RULES[kind].needsPickupPoint;
  if (needsRef && !hasRef) {
    return Object.freeze({
      ok: false as const,
      field: "pickupPointRef" as const,
      reason: "required" as const,
    });
  }
  if (!needsRef && hasRef) {
    return Object.freeze({
      ok: false as const,
      field: "pickupPointRef" as const,
      reason: "not_applicable" as const,
    });
  }
  return Object.freeze({ ok: true as const });
}
