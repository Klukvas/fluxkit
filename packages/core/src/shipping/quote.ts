import { isSupportedCurrency } from "../pricing/currency.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { addMoney, createMoney } from "../pricing/money.js";
import type { Money } from "../pricing/money.js";
import { decideMethodAvailability, SHIPPING_UNAVAILABLE_REASONS } from "./availability.js";
import type { ShippingMethodFacts } from "./availability.js";
import type { ShippingPayer } from "./limits.js";
import { decideShippingPrice } from "./pricing.js";

/*
 * One method quoted for one cart (ADR 0029 decisions 3, 4 and 5): is it available, what does the shop charge, and what is
 * the total the shopper agrees to. The store options endpoint and the checkout use this same function, so the `total` the
 * storefront sends back as `expectedTotal` is computed exactly as the checkout computes it (the checkout then builds the
 * order totals with `computeOrderTotals`). The carrier's estimate is never an input. No clock, no I/O, outputs are frozen.
 */

export const SHIPPING_QUOTE_UNAVAILABLE_REASONS = Object.freeze([
  ...SHIPPING_UNAVAILABLE_REASONS,
  /** A `pickup_point` method whose provider the shop does not run (`SHIPPING_PROVIDERS_ENABLED`): no point can be resolved. */
  "provider_not_enabled",
  /** The stored pricing breaks the write rules (a row edited by hand): never charged, the method is not offered. */
  "pricing_invalid",
  /** Subtotal plus shipping does not fit the money range: refused, never clamped. */
  "total_out_of_range",
] as const);

export type ShippingQuoteUnavailableReason = (typeof SHIPPING_QUOTE_UNAVAILABLE_REASONS)[number];

export interface ShippingQuoteMethod extends ShippingMethodFacts {
  /** `shipping_method.provider_code`. */
  readonly providerCode: string | null;
  /** `shipping_method.pricing` as stored; validated again here. */
  readonly pricing: unknown;
}

export interface ShippingQuoteInput {
  readonly method: ShippingQuoteMethod;
  /** Whether the method's provider is loaded (`true` for a method without a provider). */
  readonly providerEnabled: boolean;
  readonly shopCurrency: SupportedCurrency;
  /** The destination country (`decideMethodAvailability`); `undefined` when there is none yet. */
  readonly countryCode: string | undefined;
  /** The subtotal of every available cart line, in the shop currency (the threshold basis, ADR 0029 decision 3). */
  readonly subtotal: Money;
}

export type ShippingQuote =
  | {
      readonly available: true;
      readonly price: Money;
      readonly payer: ShippingPayer;
      /** `subtotal + price`: what the shopper agrees to (`expectedTotal`). */
      readonly total: Money;
    }
  | { readonly available: false; readonly reason: ShippingQuoteUnavailableReason };

function unavailable(reason: ShippingQuoteUnavailableReason): ShippingQuote {
  return Object.freeze({ available: false as const, reason });
}

/**
 * Reasons in this order: `inactive`, `currency_not_offered`, `provider_not_enabled` (kind `pickup_point` only: an address
 * method's provider only estimates), `country_required`, `country_not_served`, `pricing_invalid`, `total_out_of_range`.
 * A subtotal that is not valid, non-negative money in the shop currency is a bug of the caller (RangeError).
 */
export function quoteShippingMethod(input: ShippingQuoteInput): ShippingQuote {
  const { method, shopCurrency } = input;
  if (!isSupportedCurrency(shopCurrency)) {
    throw new RangeError(`Unsupported shop currency: ${String(shopCurrency)}`);
  }
  const candidate = input.subtotal as { amount?: unknown; currency?: unknown } | null | undefined;
  const subtotal =
    typeof candidate === "object" && candidate !== null
      ? createMoney(candidate.amount, candidate.currency)
      : null;
  if (
    subtotal === null ||
    !subtotal.ok ||
    subtotal.money.amount < 0 ||
    subtotal.money.currency !== shopCurrency
  ) {
    throw new RangeError("The subtotal must be valid, non-negative money in the shop currency");
  }
  const facts: ShippingMethodFacts = {
    kind: method.kind,
    isActive: method.isActive,
    currency: method.currency,
    countryCodes: method.countryCodes,
  };
  // Inactive and currency first: a method that is not offered at all says so before anything else.
  const offered = decideMethodAvailability(facts, { shopCurrency });
  if (
    !offered.available &&
    (offered.reason === "inactive" || offered.reason === "currency_not_offered")
  ) {
    return unavailable(offered.reason);
  }
  if (method.kind === "pickup_point" && input.providerEnabled !== true) {
    return unavailable("provider_not_enabled");
  }
  const served = decideMethodAvailability(
    facts,
    input.countryCode === undefined
      ? { shopCurrency }
      : { shopCurrency, countryCode: input.countryCode },
  );
  if (!served.available) {
    return unavailable(served.reason);
  }
  const decided = decideShippingPrice(method.pricing, {
    subtotal: subtotal.money,
    currency: shopCurrency,
  });
  if (!decided.ok) {
    if (decided.reason === "invalid_pricing") {
      return unavailable("pricing_invalid");
    }
    // The method currency equals the shop currency (checked above) and so does the subtotal.
    throw new RangeError(`Unexpected shipping price refusal: ${decided.reason}`);
  }
  const total = addMoney(subtotal.money, decided.price);
  if (!total.ok) {
    if (total.reason === "amount_out_of_range") {
      return unavailable("total_out_of_range");
    }
    throw new RangeError(`Unexpected money failure: ${total.reason}`);
  }
  return Object.freeze({
    available: true as const,
    price: decided.price,
    payer: decided.payer,
    total: total.money,
  });
}
