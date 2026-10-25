import type {
  Cart,
  Money,
  PickupPointKind,
  ShipmentStatus,
  ShippingMethodKind,
  ShippingOption,
  ShippingOptions,
  ShippingUnavailableReason,
} from "@fluxkit/api-client";
import type { Failure } from "./failure";

/**
 * What the checkout derives from the shipping options of `GET /store/shipping/options` (shipping plan step 10). Pure. The
 * browser NEVER adds money: the total of an order that ships is the `total` the server computed for the chosen option, and
 * this file only picks which server value is the one to show and to send as `expectedTotal`.
 */

export interface ShippingState {
  /** True once the page asked for options; before that the answer is unknown. */
  started: boolean;
  /** A read is in flight. The previous answer stays visible (no flicker) but is not trusted for a price meanwhile. */
  pending: boolean;
  /** The last applied answer. */
  answer: ShippingOptions | null;
  /** The last read failed; the previous answer, if any, is kept for display but nothing may be sent on it. */
  failure: Failure | null;
  /** The number of the newest read whose answer was applied. */
  appliedSeq: number;
}

export const initialShippingState: ShippingState = {
  started: false,
  pending: false,
  answer: null,
  failure: null,
  appliedSeq: 0,
};

export type DeliveryBlockReason = "loading" | "error" | "choose" | "unavailable";

/** An option the shopper can order: available, with the server's total. */
export type OrderableOption = ShippingOption & { available: true; total: Money; price: Money };

/**
 * How the order is delivered, from the cart and the options answer:
 * - `none`: nothing to choose. The cart ships nothing, or the shop has no active method (an empty `options`), so the
 *   checkout is EXACTLY the one without shipping (`expectedTotal` = the cart's total, no `shipping` member, today's address).
 * - `ship`: a method is chosen and orderable; `total` is the server's `total` of that option.
 * - `blocked`: the answer is not there yet (`loading`), failed (`error`), no method is chosen (`choose`) or the chosen one
 *   cannot be ordered (`unavailable`).
 */
export type DeliveryPlan =
  | { kind: "none" }
  | { kind: "ship"; option: OrderableOption; total: Money }
  | { kind: "blocked"; reason: DeliveryBlockReason };

export function deliveryPlan(
  cart: Cart,
  shipping: ShippingState,
  methodCode: string,
): DeliveryPlan {
  // A cart that ships nothing has no delivery (the API refuses a `shipping` member for it, `shipping_not_applicable`).
  if (!cart.requiresShipping) return { kind: "none" };
  if (shipping.failure !== null) return { kind: "blocked", reason: "error" };
  const { answer } = shipping;
  if (answer === null) return { kind: "blocked", reason: "loading" };
  // A shop with no active method keeps today's checkout, also while a newer read runs (there is no price to protect).
  if (answer.options.length === 0) return { kind: "none" };
  if (shipping.pending) return { kind: "blocked", reason: "loading" };
  if (methodCode === "") return { kind: "blocked", reason: "choose" };
  const option = answer.options.find((candidate) => candidate.methodCode === methodCode);
  if (!isOrderable(option)) return { kind: "blocked", reason: "unavailable" };
  return { kind: "ship", option, total: option.total };
}

/**
 * What the delivery part of the checkout form shows. `none` is the form without shipping methods (the shop has none, or the
 * cart ships nothing): no delivery section, the address as it always was. `unchosen` is the delivery section with no
 * orderable method chosen; the others are the chosen method's kind.
 */
export type DeliveryMode = "none" | "unchosen" | ShippingMethodKind;

/** True when the checkout shows a delivery section: the cart ships goods and the shop has at least one active method. */
export function isDeliveryActive(cart: Cart, shipping: ShippingState): boolean {
  return cart.requiresShipping && shipping.answer !== null && shipping.answer.options.length > 0;
}

export function deliveryMode(
  cart: Cart,
  shipping: ShippingState,
  methodCode: string,
): DeliveryMode {
  if (!isDeliveryActive(cart, shipping)) return "none";
  const option = shipping.answer?.options.find((candidate) => candidate.methodCode === methodCode);
  return isOrderable(option) ? option.kind : "unchosen";
}

/**
 * The countries the shop delivers to by address: every country any `address` method lists, in the order of the options
 * (the API orders them as the shop does). A method that is not available for the typed country still lists its countries,
 * so the shopper can switch to one it serves.
 */
export function servedCountries(options: readonly ShippingOption[]): string[] {
  const countries: string[] = [];
  for (const option of options) {
    if (option.kind !== "address") continue;
    for (const code of option.countryCodes) if (!countries.includes(code)) countries.push(code);
  }
  return countries;
}

/**
 * The method to choose after an options answer arrived, or `null` to leave the choice alone:
 * - none chosen yet, or a code the shop does not list at all: the first available method (`""` when none is available).
 * - a chosen method that became unavailable is NOT swapped for another: the price would change under the shopper, who is
 *   told instead (the checkout blocks with the reason).
 */
export function methodToChoose(options: readonly ShippingOption[], chosen: string): string | null {
  if (options.length === 0 || options.some((option) => option.methodCode === chosen)) return null;
  const first = options.find(isOrderable);
  if (first !== undefined) return first.methodCode;
  return chosen === "" ? null : "";
}

/**
 * The country to switch to when the typed one is served by no address method: the preferred (default) country if some
 * method serves it, else the first served one. `null` when nothing needs to change.
 */
export function countryToChoose(
  options: readonly ShippingOption[],
  current: string,
  preferred: string,
): string | null {
  const served = servedCountries(options);
  if (served.length === 0 || served.includes(current)) return null;
  return served.includes(preferred) ? preferred : (served[0] as string);
}

export function isOrderable(option: ShippingOption | undefined): option is OrderableOption {
  return option !== undefined && option.available && option.total !== null && option.price !== null;
}

/** Reasons the options endpoint gives for an option it cannot offer: one message each (`checkout.shipping.unavailable.*`). */
export const UNAVAILABLE_REASONS: readonly ShippingUnavailableReason[] = [
  "inactive",
  "currency_not_offered",
  "country_required",
  "country_not_served",
  "provider_not_enabled",
  "pricing_invalid",
  "total_out_of_range",
];

export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "pending",
  "unknown",
  "created",
  "in_transit",
  "arrived",
  "delivered",
  "returning",
  "returned",
  "cancelled",
  "failed",
];

export const PICKUP_KINDS: readonly PickupPointKind[] = ["branch", "locker"];
