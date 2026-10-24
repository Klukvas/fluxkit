import { isSupportedCurrency } from "../pricing/currency.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import { compareMoney, createMoney } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";
import { SHIPPING_LIMITS } from "./limits.js";
import type { ShippingPayer } from "./limits.js";

/*
 * Shipping rates (ADR 0029 decision 3; money logic, TDD). `shipping_method.pricing` is JSON that core validates at write
 * (`validateShippingPricing`) and again when a price is decided (`decideShippingPrice`), so a row edited by hand can make
 * a method unavailable but never charge a wrong amount. Every amount is an integer count of minor units of the method's
 * currency, `0..MAX_AMOUNT`, entered in minor units (the admin converts decimals), so nothing here rounds. Thresholds are
 * compared with `compareMoney`. The carrier's own price is never an input: plugins do not influence an order total
 * (ADR 0029 decision 1). No clock, no I/O, inputs are not mutated, outputs are frozen.
 */

export const SHIPPING_PRICING_TYPES = Object.freeze([
  "flat",
  "free_over",
  "tiers",
  "carrier_on_delivery",
] as const);

export type ShippingPricingType = (typeof SHIPPING_PRICING_TYPES)[number];

export interface ShippingTier {
  /** The tier applies from this subtotal (inclusive) up to the next tier's `fromSubtotal` (exclusive). */
  readonly fromSubtotal: number;
  readonly amount: number;
}

export type ShippingPricing =
  /** The same amount for every cart. */
  | { readonly type: "flat"; readonly amount: number }
  /** `0` when the subtotal is `>= freeFrom`, else `amount`. */
  | { readonly type: "free_over"; readonly amount: number; readonly freeFrom: number }
  /** The tier with the highest `fromSubtotal <= subtotal`; the first tier starts at 0, thresholds strictly ascend. */
  | { readonly type: "tiers"; readonly tiers: readonly ShippingTier[] }
  /** The shop charges 0; the recipient pays the carrier on delivery (the storefront shows the carrier's estimate). */
  | { readonly type: "carrier_on_delivery" };

export type ShippingPricingErrorReason =
  | "not_an_object"
  | "required"
  | "unknown_type"
  | "unknown_field"
  | "not_an_integer"
  | "out_of_range"
  | "not_an_array"
  | "no_tiers"
  | "too_many_tiers"
  | "first_tier_not_zero"
  | "tiers_not_sorted"
  | "duplicate_tier";

export interface ShippingPricingError {
  /** Dotted path inside the pricing object (`amount`, `tiers.2.fromSubtotal`); empty for the object itself. */
  readonly field: string;
  readonly reason: ShippingPricingErrorReason;
}

export type ShippingPricingResult =
  | { readonly ok: true; readonly pricing: ShippingPricing }
  | { readonly ok: false; readonly errors: readonly ShippingPricingError[] };

export interface ShippingPriceInput {
  /** The subtotal of every available cart line (ADR 0029 decision 3, threshold basis); valid, non-negative money. */
  readonly subtotal: Money;
  /** The method's currency, the currency of every amount in its pricing. */
  readonly currency: SupportedCurrency;
}

export type ShippingPriceDecision =
  | { readonly ok: true; readonly price: Money; readonly payer: ShippingPayer }
  | { readonly ok: false; readonly reason: "currency_mismatch" | "invalid_pricing" };

/** The fields of each type, in the order their errors are reported. */
const FIELDS_OF: Readonly<Record<ShippingPricingType, readonly string[]>> = Object.freeze({
  flat: Object.freeze(["type", "amount"]),
  free_over: Object.freeze(["type", "amount", "freeFrom"]),
  tiers: Object.freeze(["type", "tiers"]),
  carrier_on_delivery: Object.freeze(["type"]),
});

const TIER_FIELDS: readonly string[] = Object.freeze(["fromSubtotal", "amount"]);

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPricingType(value: unknown): value is ShippingPricingType {
  return typeof value === "string" && (SHIPPING_PRICING_TYPES as readonly string[]).includes(value);
}

function join(prefix: string, field: string): string {
  return prefix === "" ? field : `${prefix}.${field}`;
}

/** Own keys outside `allowed` (an own `__proto__` from `JSON.parse` included), in key order. */
function unknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  prefix: string,
  errors: ShippingPricingError[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push({ field: join(prefix, key), reason: "unknown_field" });
    }
  }
}

/** An integer of minor units in `0..MAX_AMOUNT`, or `undefined` after recording why not. `-0` becomes `0`. */
function readAmount(
  value: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
  errors: ShippingPricingError[],
): number | undefined {
  const field = join(prefix, key);
  if (!Object.hasOwn(value, key) || value[key] === undefined) {
    errors.push({ field, reason: "required" });
    return undefined;
  }
  const amount = value[key];
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    errors.push({ field, reason: "not_an_integer" });
    return undefined;
  }
  if (amount < 0 || amount > MAX_AMOUNT) {
    errors.push({ field, reason: "out_of_range" });
    return undefined;
  }
  return amount === 0 ? 0 : amount;
}

function readTiers(
  value: Readonly<Record<string, unknown>>,
  errors: ShippingPricingError[],
): ShippingTier[] | undefined {
  if (!Object.hasOwn(value, "tiers") || value.tiers === undefined) {
    errors.push({ field: "tiers", reason: "required" });
    return undefined;
  }
  const list = value.tiers;
  if (!Array.isArray(list)) {
    errors.push({ field: "tiers", reason: "not_an_array" });
    return undefined;
  }
  if (list.length === 0) {
    errors.push({ field: "tiers", reason: "no_tiers" });
    return undefined;
  }
  if (list.length > SHIPPING_LIMITS.maxTiers) {
    errors.push({ field: "tiers", reason: "too_many_tiers" });
    return undefined;
  }
  const before = errors.length;
  const parsed: ShippingTier[] = [];
  list.forEach((entry: unknown, index) => {
    const prefix = `tiers.${String(index)}`;
    if (!isPlainObject(entry)) {
      errors.push({ field: prefix, reason: "not_an_object" });
      return;
    }
    unknownFields(entry, TIER_FIELDS, prefix, errors);
    const fromSubtotal = readAmount(entry, "fromSubtotal", prefix, errors);
    const amount = readAmount(entry, "amount", prefix, errors);
    if (fromSubtotal !== undefined && amount !== undefined) {
      parsed.push(Object.freeze({ fromSubtotal, amount }));
    }
  });
  if (errors.length > before) {
    return undefined;
  }
  // Order rules only once every tier is well formed: a malformed tier has no threshold to compare.
  parsed.forEach((tier, index) => {
    const field = `tiers.${String(index)}.fromSubtotal`;
    const previous = parsed[index - 1];
    if (previous === undefined) {
      if (tier.fromSubtotal !== 0) {
        errors.push({ field, reason: "first_tier_not_zero" });
      }
    } else if (tier.fromSubtotal === previous.fromSubtotal) {
      errors.push({ field, reason: "duplicate_tier" });
    } else if (tier.fromSubtotal < previous.fromSubtotal) {
      errors.push({ field, reason: "tiers_not_sorted" });
    }
  });
  return errors.length > before ? undefined : parsed;
}

/**
 * Validates `shipping_method.pricing` and returns a frozen, normalized copy. Unknown fields (a `currency` included: the
 * method holds it) are refused; every error is reported at once: unknown fields first, then the type's fields in order.
 */
export function validateShippingPricing(value: unknown): ShippingPricingResult {
  if (!isPlainObject(value)) {
    return { ok: false, errors: [{ field: "", reason: "not_an_object" }] };
  }
  if (!Object.hasOwn(value, "type") || value.type === undefined) {
    return { ok: false, errors: [{ field: "type", reason: "required" }] };
  }
  const type = value.type;
  if (!isPricingType(type)) {
    return { ok: false, errors: [{ field: "type", reason: "unknown_type" }] };
  }
  const errors: ShippingPricingError[] = [];
  unknownFields(value, FIELDS_OF[type], "", errors);
  let pricing: ShippingPricing | undefined;
  switch (type) {
    case "flat": {
      const amount = readAmount(value, "amount", "", errors);
      pricing = amount === undefined ? undefined : { type, amount };
      break;
    }
    case "free_over": {
      const amount = readAmount(value, "amount", "", errors);
      const freeFrom = readAmount(value, "freeFrom", "", errors);
      pricing =
        amount === undefined || freeFrom === undefined ? undefined : { type, amount, freeFrom };
      break;
    }
    case "tiers": {
      const tiers = readTiers(value, errors);
      pricing = tiers === undefined ? undefined : { type, tiers: Object.freeze(tiers) };
      break;
    }
    case "carrier_on_delivery":
      pricing = { type };
      break;
  }
  if (errors.length > 0 || pricing === undefined) {
    return { ok: false, errors: Object.freeze(errors) };
  }
  return { ok: true, pricing: Object.freeze(pricing) };
}

function moneyIn(amount: number, currency: SupportedCurrency): Money {
  const created = createMoney(amount, currency);
  if (!created.ok) {
    // Validated amounts and a checked currency always build; anything else is a bug in this module.
    throw new RangeError(`Unexpected money failure: ${created.reason}`);
  }
  return created.money;
}

/** `subtotal >= threshold`, both in `currency`. */
function reaches(subtotal: Money, threshold: number, currency: SupportedCurrency): boolean {
  const compared = compareMoney(subtotal, moneyIn(threshold, currency));
  if (!compared.ok) {
    throw new RangeError(`Unexpected money failure: ${compared.reason}`);
  }
  return compared.ordering >= 0;
}

/**
 * What the shop charges for shipping a cart with `subtotal` by a method with `pricing` in `currency`. Exact: no rounding,
 * no carrier input. Typed refusals: `currency_mismatch` (the subtotal is in another currency than the method) and
 * `invalid_pricing` (stored pricing the write rules refuse). An unsupported `currency` or a subtotal that is not valid,
 * non-negative money is a bug in the caller (RangeError).
 */
export function decideShippingPrice(
  pricing: unknown,
  input: ShippingPriceInput,
): ShippingPriceDecision {
  const { subtotal, currency } = input;
  if (!isSupportedCurrency(currency)) {
    throw new RangeError(`Unsupported method currency: ${String(currency)}`);
  }
  const candidate = subtotal as { amount?: unknown; currency?: unknown } | null | undefined;
  const checked =
    typeof candidate === "object" && candidate !== null
      ? createMoney(candidate.amount, candidate.currency)
      : null;
  if (checked === null || !checked.ok || checked.money.amount < 0) {
    throw new RangeError("The subtotal must be valid, non-negative money");
  }
  if (checked.money.currency !== currency) {
    return Object.freeze({ ok: false as const, reason: "currency_mismatch" as const });
  }
  const validated = validateShippingPricing(pricing);
  if (!validated.ok) {
    return Object.freeze({ ok: false as const, reason: "invalid_pricing" as const });
  }
  const rule = validated.pricing;
  let amount: number;
  let payer: ShippingPayer = "shop_charge";
  switch (rule.type) {
    case "flat":
      amount = rule.amount;
      break;
    case "free_over":
      amount = reaches(checked.money, rule.freeFrom, currency) ? 0 : rule.amount;
      break;
    case "tiers": {
      // Validated: ascending from 0, so the first tier always applies and the last one reached wins.
      let chosen = rule.tiers[0];
      for (const tier of rule.tiers) {
        if (reaches(checked.money, tier.fromSubtotal, currency)) {
          chosen = tier;
        }
      }
      if (chosen === undefined) {
        throw new RangeError("Validated tiers are never empty");
      }
      amount = chosen.amount;
      break;
    }
    case "carrier_on_delivery":
      amount = 0;
      payer = "recipient_on_delivery";
      break;
  }
  return Object.freeze({ ok: true as const, price: moneyIn(amount, currency), payer });
}
