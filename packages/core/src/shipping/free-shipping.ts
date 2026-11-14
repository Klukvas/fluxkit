/**
 * Free-shipping hint from offered, valid free-over methods and the cart subtotal (all available lines).
 * Ignores destination because a cart has none; refuses invalid or negative money or unsupported currency.
 */
import { isSupportedCurrency, type SupportedCurrency } from "../pricing/currency.js";
import { compareMoney, createMoney, subtractMoney, type Money } from "../pricing/money.js";
import { validateShippingPricing } from "./pricing.js";
import { isShippingMethodOffered, type ShippingOfferInput } from "./quote.js";

export type FreeShippingMethod = ShippingOfferInput["method"] & {
  readonly pricing: unknown;
  readonly providerEnabled: boolean;
};

export interface FreeShippingProgress {
  readonly threshold: Money;
  readonly remaining: Money;
}

function moneyIn(amount: number, currency: SupportedCurrency): Money {
  const result = createMoney(amount, currency);
  if (!result.ok) {
    throw new RangeError(`Unexpected money failure: ${result.reason}`);
  }
  return result.money;
}

function compare(left: Money, right: Money): number {
  const result = compareMoney(left, right);
  if (!result.ok) {
    throw new RangeError(`Unexpected money failure: ${result.reason}`);
  }
  return result.ordering;
}

/** Lowest offered free-over threshold, independent of destination; the subtotal includes all available lines. */
export function decideFreeShippingProgress(input: {
  readonly methods: readonly FreeShippingMethod[];
  readonly shopCurrency: SupportedCurrency;
  readonly subtotal: Money;
}): FreeShippingProgress | null {
  const { shopCurrency } = input;
  if (!isSupportedCurrency(shopCurrency)) {
    throw new RangeError(`Unsupported shop currency: ${String(shopCurrency)}`);
  }
  const candidate = input.subtotal as { amount?: unknown; currency?: unknown } | null | undefined;
  const subtotal =
    typeof candidate === "object" && candidate !== null
      ? createMoney(candidate.amount, candidate.currency)
      : null;
  if (subtotal === null || !subtotal.ok || subtotal.money.amount < 0) {
    throw new RangeError("The subtotal must be valid, non-negative money");
  }
  let threshold: Money | null = null;
  for (const method of input.methods) {
    if (
      !isShippingMethodOffered({ method, shopCurrency, providerEnabled: method.providerEnabled }) ||
      method.currency !== subtotal.money.currency
    ) {
      continue;
    }
    const validated = validateShippingPricing(method.pricing);
    if (!validated.ok || validated.pricing.type !== "free_over") {
      continue;
    }
    const next = moneyIn(
      validated.pricing.amount === 0 ? 0 : validated.pricing.freeFrom,
      shopCurrency,
    );
    if (threshold === null || compare(next, threshold) < 0) {
      threshold = next;
    }
  }
  if (threshold === null) {
    return null;
  }
  const remaining =
    compare(subtotal.money, threshold) >= 0
      ? { ok: true as const, money: moneyIn(0, shopCurrency) }
      : subtractMoney(threshold, subtotal.money);
  if (!remaining.ok) {
    throw new RangeError(`Unexpected money failure: ${remaining.reason}`);
  }
  return Object.freeze({ threshold, remaining: remaining.money });
}
