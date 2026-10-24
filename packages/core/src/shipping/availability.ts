import { isSupportedCurrency } from "../pricing/currency.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { COUNTRY_CODE_PATTERN, SHIPPING_LIMITS, SHIPPING_METHOD_KINDS } from "./limits.js";
import type { ShippingMethodKind } from "./limits.js";

/*
 * Which methods a cart may use (ADR 0029 decisions 3, 4 and 7): active, in the shop currency, and serving the destination
 * country. The country check uses the address country for kind `address`, the carrier's country for `pickup_point` (the
 * API passes it, `UA` for Nova Poshta), and for `store_pickup` the address country only when the shopper gave one
 * (ADR 0029 open question 5; plan steps 3 and 6 may refine it). No clock, no I/O.
 */

export interface ShippingMethodFacts {
  readonly kind: ShippingMethodKind;
  readonly isActive: boolean;
  /** The currency of every amount of the method's pricing. */
  readonly currency: string;
  /** ISO alpha-2 codes, validated at write by `validateCountryCodes`. */
  readonly countryCodes: readonly string[];
}

export interface ShippingAvailabilityContext {
  readonly shopCurrency: SupportedCurrency;
  /** The destination country (see above); `undefined` when the shopper has not given one. */
  readonly countryCode?: string;
}

export const SHIPPING_UNAVAILABLE_REASONS = Object.freeze([
  "inactive",
  "currency_not_offered",
  "country_required",
  "country_not_served",
] as const);

export type ShippingUnavailableReason = (typeof SHIPPING_UNAVAILABLE_REASONS)[number];

export type ShippingAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: ShippingUnavailableReason };

const AVAILABLE: ShippingAvailability = Object.freeze({ available: true as const });

function unavailable(reason: ShippingUnavailableReason): ShippingAvailability {
  return Object.freeze({ available: false as const, reason });
}

/**
 * Whether a cart may use the method, with the first reason it may not, in this order: `inactive`, `currency_not_offered`
 * (a method whose currency is not the shop currency is never offered), `country_required` (kind `address` or
 * `pickup_point` without a country), `country_not_served`. An unknown kind or shop currency is a bug (RangeError).
 */
export function decideMethodAvailability(
  method: ShippingMethodFacts,
  context: ShippingAvailabilityContext,
): ShippingAvailability {
  if (!SHIPPING_METHOD_KINDS.includes(method.kind)) {
    throw new RangeError(`Unknown shipping method kind: ${String(method.kind)}`);
  }
  if (!isSupportedCurrency(context.shopCurrency)) {
    throw new RangeError(`Unsupported shop currency: ${String(context.shopCurrency)}`);
  }
  if (method.isActive !== true) {
    return unavailable("inactive");
  }
  if (method.currency !== context.shopCurrency) {
    return unavailable("currency_not_offered");
  }
  const country = context.countryCode;
  if (country === undefined) {
    return method.kind === "store_pickup" ? AVAILABLE : unavailable("country_required");
  }
  return method.countryCodes.includes(country) ? AVAILABLE : unavailable("country_not_served");
}

export type CountryCodesErrorReason =
  "not_an_array" | "empty" | "too_many" | "invalid_format" | "duplicate";

export interface CountryCodesError {
  /** Position in the list, or `null` for the list itself. */
  readonly index: number | null;
  readonly reason: CountryCodesErrorReason;
}

export type CountryCodesResult =
  | { readonly ok: true; readonly countryCodes: readonly string[] }
  | { readonly ok: false; readonly errors: readonly CountryCodesError[] };

/**
 * A method's country list at write: a non-empty list of at most `SHIPPING_LIMITS.maxCountriesPerMethod` distinct
 * ISO alpha-2 codes (two upper-case letters; the pattern only, no list of real countries). Every error at once.
 */
export function validateCountryCodes(value: unknown): CountryCodesResult {
  if (!Array.isArray(value)) {
    return { ok: false, errors: [{ index: null, reason: "not_an_array" }] };
  }
  if (value.length === 0) {
    return { ok: false, errors: [{ index: null, reason: "empty" }] };
  }
  if (value.length > SHIPPING_LIMITS.maxCountriesPerMethod) {
    return { ok: false, errors: [{ index: null, reason: "too_many" }] };
  }
  const errors: CountryCodesError[] = [];
  const seen = new Set<string>();
  value.forEach((code: unknown, index) => {
    if (typeof code !== "string" || !COUNTRY_CODE_PATTERN.test(code)) {
      errors.push({ index, reason: "invalid_format" });
    } else if (seen.has(code)) {
      errors.push({ index, reason: "duplicate" });
    } else {
      seen.add(code);
    }
  });
  return errors.length > 0
    ? { ok: false, errors: Object.freeze(errors) }
    : { ok: true, countryCodes: Object.freeze([...seen]) };
}
