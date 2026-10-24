import { hasJsonbUnsafeCharacters } from "../catalog/text-safety.js";
import type { I18nText } from "../catalog/types.js";
import { createMoney } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";
import { SHIPPING_METHOD_CODE_PATTERN, SHIPPING_PROVIDER_CODE_PATTERN } from "./limits.js";

/*
 * The shipping adjustment of an order (ADR 0029 decision 4): one `order_adjustment` row per order with a shipping
 * selection, `{kind: "shipping", code: <method code>, label: <title map>, amount, includedInPrice: false, source: <provider
 * code or null>}`. A free or `carrier_on_delivery` method writes it with amount 0, so the list always names the chosen
 * method. It is a `TotalsAdjustment` for `computeOrderTotals`. The inputs come from validated admin data and from
 * `decideShippingPrice`, so a malformed one is a bug in the caller (RangeError), like `buildOrderEventPayload`.
 */

export interface ShippingAdjustmentInput {
  readonly methodCode: string;
  /** The method's title map, copied whole (every locale, ADR 0025 snapshot rule). */
  readonly title: I18nText;
  /** What the shop charges: the price `decideShippingPrice` returned. */
  readonly price: Money;
  /** The method's provider code, or `null` for a method without a carrier plugin. */
  readonly providerCode: string | null;
}

export interface ShippingAdjustment {
  readonly kind: "shipping";
  readonly code: string;
  readonly label: I18nText;
  readonly amount: Money;
  /** Shipping is added to the total; no tax is computed in v1 (ADR 0029 decision 3). */
  readonly includedInPrice: false;
  readonly source: string | null;
}

function copyTitle(title: unknown): I18nText {
  if (typeof title !== "object" || title === null || Array.isArray(title)) {
    throw new RangeError("A shipping adjustment needs the method title (a locale map)");
  }
  const entries = Object.entries(title);
  if (entries.length === 0) {
    throw new RangeError("A shipping adjustment needs at least one title text");
  }
  const copy: Record<string, string> = {};
  for (const [locale, text] of entries) {
    if (typeof text !== "string" || text.trim().length === 0 || hasJsonbUnsafeCharacters(text)) {
      throw new RangeError(`The method title in ${locale} must be a non-empty text`);
    }
    copy[locale] = text;
  }
  return Object.freeze(copy);
}

export function buildShippingAdjustment(input: ShippingAdjustmentInput): ShippingAdjustment {
  if (
    typeof input.methodCode !== "string" ||
    !SHIPPING_METHOD_CODE_PATTERN.test(input.methodCode)
  ) {
    throw new RangeError("A shipping adjustment needs the method code");
  }
  if (
    input.providerCode !== null &&
    (typeof input.providerCode !== "string" ||
      !SHIPPING_PROVIDER_CODE_PATTERN.test(input.providerCode))
  ) {
    throw new RangeError("The provider code of a shipping adjustment is malformed");
  }
  const candidate = input.price as { amount?: unknown; currency?: unknown } | null | undefined;
  const price =
    typeof candidate === "object" && candidate !== null
      ? createMoney(candidate.amount, candidate.currency)
      : null;
  if (price === null || !price.ok || price.money.amount < 0) {
    throw new RangeError("A shipping price must be valid, non-negative money");
  }
  return Object.freeze({
    kind: "shipping" as const,
    code: input.methodCode,
    label: copyTitle(input.title),
    amount: price.money,
    includedInPrice: false as const,
    source: input.providerCode,
  });
}
