import { isSupportedCurrency } from "./currency.js";
import type { SupportedCurrency } from "./currency.js";
import { createMoney } from "./money.js";

/*
 * Price rules (ADR 0011, pricing plan). A price is a non-negative amount in minor units, a currency, and an optional
 * compare-at (old) amount that is strictly greater. The money module owns range and integer checks; this module only
 * adds what is specific to a price. Nothing here converts between currencies.
 */

export interface Price {
  readonly amount: number;
  readonly currency: SupportedCurrency;
  readonly compareAtAmount: number | null;
}

export type PriceFailure =
  | "not_an_object"
  | "not_a_number"
  | "not_an_integer"
  | "amount_out_of_range"
  | "negative_amount"
  | "unsupported_currency"
  | "compare_at_not_a_number"
  | "compare_at_not_an_integer"
  | "compare_at_out_of_range"
  | "compare_at_not_greater";

export type PriceResult =
  | { readonly ok: true; readonly price: Price }
  | { readonly ok: false; readonly reason: PriceFailure };

function fail(reason: PriceFailure): { readonly ok: false; readonly reason: PriceFailure } {
  return { ok: false, reason };
}

/**
 * Checks, in this order: object, amount (type, integer, range, sign), currency, compare-at (type, integer, range,
 * greater than the amount). `null` and `undefined` compare-at mean "no old price". Returns a frozen copy.
 */
export function validatePrice(input: unknown): PriceResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("not_an_object");
  }
  const { amount, currency, compareAtAmount } = input as {
    amount?: unknown;
    currency?: unknown;
    compareAtAmount?: unknown;
  };

  const money = createMoney(amount, currency);
  if (!money.ok) {
    return fail(money.reason);
  }
  if (money.money.amount < 0) {
    return fail("negative_amount");
  }

  if (compareAtAmount === undefined || compareAtAmount === null) {
    return {
      ok: true,
      price: Object.freeze({
        amount: money.money.amount,
        currency: money.money.currency,
        compareAtAmount: null,
      }),
    };
  }
  const compareAt = createMoney(compareAtAmount, money.money.currency);
  if (!compareAt.ok) {
    switch (compareAt.reason) {
      case "not_a_number":
        return fail("compare_at_not_a_number");
      case "not_an_integer":
        return fail("compare_at_not_an_integer");
      default:
        return fail("compare_at_out_of_range");
    }
  }
  if (compareAt.money.amount <= money.money.amount) {
    return fail("compare_at_not_greater");
  }
  return {
    ok: true,
    price: Object.freeze({
      amount: money.money.amount,
      currency: money.money.currency,
      compareAtAmount: compareAt.money.amount,
    }),
  };
}

export type SellablePriceResult =
  | { readonly ok: true; readonly price: Price }
  | { readonly ok: false; readonly reason: "no_price_in_shop_currency" };

/**
 * The price a shop sells at: the one in the shop currency. A price in another currency is never converted and never
 * chosen. Stored prices are unique per currency and checked by the database, so a duplicate or an invalid price in the
 * shop currency is corrupt data and throws a RangeError, as does an unsupported shop currency (misconfiguration).
 */
export function pickSellablePrice(
  prices: readonly Price[],
  shopCurrency: SupportedCurrency,
): SellablePriceResult {
  if (!isSupportedCurrency(shopCurrency)) {
    throw new RangeError(`Unsupported shop currency: ${String(shopCurrency)}`);
  }
  const candidates = prices.filter((price) => price.currency === shopCurrency);
  const [candidate, ...duplicates] = candidates;
  if (candidate === undefined) {
    return { ok: false, reason: "no_price_in_shop_currency" };
  }
  if (duplicates.length > 0) {
    throw new RangeError(`More than one stored price in ${shopCurrency}`);
  }
  const checked = validatePrice(candidate);
  if (!checked.ok) {
    throw new RangeError(`Stored price in ${shopCurrency} is invalid: ${checked.reason}`);
  }
  return { ok: true, price: checked.price };
}
