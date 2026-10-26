import { isSupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";

/*
 * Internal input guards of the payment rules (not re-exported from the barrel). A failed guard is a bug in the caller or
 * corrupt data: RangeError.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function assertUuid(value: unknown, name: string): asserts value is string {
  if (!isUuid(value)) {
    throw new RangeError(`${name} must be a uuid`);
  }
}

export function assertDate(value: unknown, name: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

/** Money of 1 to `MAX_AMOUNT` minor units in a supported currency. */
export function isPositiveMoney(value: unknown): value is Money {
  const money = value as { amount?: unknown; currency?: unknown } | null;
  return (
    typeof money === "object" &&
    money !== null &&
    Number.isSafeInteger(money.amount) &&
    (money.amount as number) >= 1 &&
    (money.amount as number) <= MAX_AMOUNT &&
    isSupportedCurrency(money.currency)
  );
}

export function assertPositiveMoney(value: unknown, name: string): asserts value is Money {
  if (!isPositiveMoney(value)) {
    throw new RangeError(`${name} must be a positive amount in minor units`);
  }
}
