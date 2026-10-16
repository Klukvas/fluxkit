import { exponentOf, isSupportedCurrency } from "./currency.js";
import type { SupportedCurrency } from "./currency.js";
import {
  BASIS_POINTS_PER_UNIT,
  MAX_AMOUNT,
  MAX_PERCENTAGE_BASIS_POINTS,
  MAX_QUANTITY,
} from "./limits.js";

/*
 * Money is an integer count of minor units and an ISO 4217 code (ADR 0011). No function here uses floating point
 * arithmetic for anything that is rounded or multiplied; no function reads the clock or a random source, mutates its
 * arguments or returns negative zero. Data errors are typed results; only misconfiguration throws a RangeError.
 */

export interface Money {
  readonly amount: number;
  readonly currency: SupportedCurrency;
}

export type RoundingMode = "half_away_from_zero" | "half_even" | "floor" | "ceil";

export const ROUNDING_MODES: readonly RoundingMode[] = Object.freeze([
  "half_away_from_zero",
  "half_even",
  "floor",
  "ceil",
]);

export const DEFAULT_ROUNDING_MODE: RoundingMode = "half_away_from_zero";

export type MoneyFailure =
  | "amount_out_of_range"
  | "currency_mismatch"
  | "invalid_money"
  | "invalid_quantity"
  | "invalid_basis_points";

export type CreateMoneyFailure =
  "not_a_number" | "not_an_integer" | "amount_out_of_range" | "unsupported_currency";

export type ParseMoneyFailure =
  | "not_a_string"
  | "unsupported_currency"
  | "invalid_format"
  | "too_many_decimals"
  | "negative_zero"
  | "amount_out_of_range";

export type MoneyResult<Reason extends string = MoneyFailure> =
  { readonly ok: true; readonly money: Money } | { readonly ok: false; readonly reason: Reason };

export type CompareMoneyResult =
  | { readonly ok: true; readonly ordering: -1 | 0 | 1 }
  | { readonly ok: false; readonly reason: "currency_mismatch" | "invalid_money" };

function fail<Reason extends string>(
  reason: Reason,
): { readonly ok: false; readonly reason: Reason } {
  return { ok: false, reason };
}

/** Never `-0`: JSON and `Object.is` tell it apart from `0`, and `0 * -1` would produce it. */
function build(amount: number, currency: SupportedCurrency): Money {
  return Object.freeze({ amount: amount === 0 ? 0 : amount, currency });
}

function isInRange(amount: number): boolean {
  return amount >= -MAX_AMOUNT && amount <= MAX_AMOUNT;
}

/** Guards against hand-built values (JSON, `as` casts). Typed `Money` from this module always passes. */
function isValidMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  return (
    typeof amount === "number" &&
    Number.isInteger(amount) &&
    isInRange(amount) &&
    isSupportedCurrency(currency)
  );
}

function fromBigInt(
  value: bigint,
  currency: SupportedCurrency,
): MoneyResult<"amount_out_of_range"> {
  const limit = BigInt(MAX_AMOUNT);
  if (value > limit || value < -limit) {
    return fail("amount_out_of_range");
  }
  return { ok: true, money: build(Number(value), currency) };
}

/** Checks in this order: type of the amount, integer, range, currency. */
export function createMoney(amount: unknown, currency: unknown): MoneyResult<CreateMoneyFailure> {
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return fail("not_a_number");
  }
  if (!Number.isInteger(amount)) {
    return fail("not_an_integer");
  }
  if (!isInRange(amount)) {
    return fail("amount_out_of_range");
  }
  if (!isSupportedCurrency(currency)) {
    return fail("unsupported_currency");
  }
  return { ok: true, money: build(amount, currency) };
}

function combine(
  left: Money,
  right: Money,
  operation: (a: number, b: number) => number,
): MoneyResult<"amount_out_of_range" | "currency_mismatch" | "invalid_money"> {
  if (!isValidMoney(left) || !isValidMoney(right)) {
    return fail("invalid_money");
  }
  if (left.currency !== right.currency) {
    return fail("currency_mismatch");
  }
  // Two amounts within the limit add up to far less than 2^53, so this is exact; only the range is checked.
  const amount = operation(left.amount, right.amount);
  if (!isInRange(amount)) {
    return fail("amount_out_of_range");
  }
  return { ok: true, money: build(amount, left.currency) };
}

export function addMoney(
  left: Money,
  right: Money,
): MoneyResult<"amount_out_of_range" | "currency_mismatch" | "invalid_money"> {
  return combine(left, right, (a, b) => a + b);
}

export function subtractMoney(
  left: Money,
  right: Money,
): MoneyResult<"amount_out_of_range" | "currency_mismatch" | "invalid_money"> {
  return combine(left, right, (a, b) => a - b);
}

/** Quantity is an integer from 0 to `MAX_QUANTITY`. The product is computed with BigInt (it can exceed 2^53). */
export function multiplyByQuantity(
  money: Money,
  quantity: number,
): MoneyResult<"amount_out_of_range" | "invalid_money" | "invalid_quantity"> {
  if (!isValidMoney(money)) {
    return fail("invalid_money");
  }
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity > MAX_QUANTITY
  ) {
    return fail("invalid_quantity");
  }
  return fromBigInt(BigInt(money.amount) * BigInt(quantity), money.currency);
}

/** Different currencies have no order: a typed `currency_mismatch`, never a throw and never a comparison of raw numbers. */
export function compareMoney(left: Money, right: Money): CompareMoneyResult {
  if (!isValidMoney(left) || !isValidMoney(right)) {
    return fail("invalid_money");
  }
  if (left.currency !== right.currency) {
    return fail("currency_mismatch");
  }
  const ordering = left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0;
  return { ok: true, ordering };
}

/** The range is symmetric, so negating a valid amount never leaves it; invalid money is a typed `invalid_money`. */
export function negateMoney(money: Money): MoneyResult<"invalid_money"> {
  if (!isValidMoney(money)) {
    return fail("invalid_money");
  }
  return { ok: true, money: build(-money.amount, money.currency) };
}

/**
 * A predicate has no room for a reason, and `false` would hide invalid money, so invalid money is a RangeError (a
 * caller bug, as for a bad rounding mode). Functions that return a result use `invalid_money` instead.
 */
export function isZero(money: Money): boolean {
  if (!isValidMoney(money)) {
    throw new RangeError(
      "isZero needs valid money: an integer amount within the limit and a supported currency",
    );
  }
  return money.amount === 0;
}

/**
 * `money * basisPoints / 10 000` rounded by `mode` (default half away from zero: -2.5 becomes -3, 2.5 becomes 3).
 * Half modes ignore the sign; `floor` goes toward negative infinity and `ceil` toward positive infinity.
 * Computed with BigInt, so the product (up to 10^18) never loses precision. An unknown mode is a RangeError.
 */
export function percentageOf(
  money: Money,
  basisPoints: number,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): MoneyResult<"amount_out_of_range" | "invalid_money" | "invalid_basis_points"> {
  if (!ROUNDING_MODES.includes(mode)) {
    throw new RangeError(`Unknown rounding mode: ${String(mode)}`);
  }
  if (!isValidMoney(money)) {
    return fail("invalid_money");
  }
  if (
    typeof basisPoints !== "number" ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > MAX_PERCENTAGE_BASIS_POINTS
  ) {
    return fail("invalid_basis_points");
  }
  const product = BigInt(money.amount) * BigInt(basisPoints);
  const negative = product < 0n;
  const magnitude = negative ? -product : product;
  const divisor = BigInt(BASIS_POINTS_PER_UNIT);
  let quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const twice = remainder * 2n;
  let roundUpMagnitude: boolean;
  switch (mode) {
    case "half_away_from_zero":
      roundUpMagnitude = twice >= divisor;
      break;
    case "half_even":
      roundUpMagnitude = twice > divisor || (twice === divisor && quotient % 2n === 1n);
      break;
    case "floor":
      // Toward negative infinity: a negative value moves away from zero.
      roundUpMagnitude = negative && remainder > 0n;
      break;
    case "ceil":
      roundUpMagnitude = !negative && remainder > 0n;
      break;
  }
  if (roundUpMagnitude) {
    quotient += 1n;
  }
  return fromBigInt(negative ? -quotient : quotient, money.currency);
}

/** Exact decimal text with exactly `exponent` fraction digits: 123456 UAH is `1234.56`, 5 UAH `0.05`, JPY has none. */
export function toDecimalString(money: Money): string {
  if (!isValidMoney(money)) {
    throw new RangeError("toDecimalString needs valid money");
  }
  const exponent = exponentOf(money.currency);
  const digits = String(Math.abs(money.amount)).padStart(exponent + 1, "0");
  const integerPart = digits.slice(0, digits.length - exponent);
  const fractionPart = digits.slice(digits.length - exponent);
  const sign = money.amount < 0 ? "-" : "";
  return exponent === 0 ? `${sign}${integerPart}` : `${sign}${integerPart}.${fractionPart}`;
}

const DECIMAL_GRAMMAR = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

/**
 * Strict inverse of `toDecimalString`: optional minus, digits, optional dot with 1 to `exponent` digits.
 * Rejects a plus sign, comma, exponent notation, spaces, `.5`, `5.`, negative zero (`-0`, `-0.00`) and any
 * non-ASCII digit. Leading zeros of the integer part are accepted.
 */
export function parseDecimalString(
  text: string,
  currency: SupportedCurrency,
): MoneyResult<ParseMoneyFailure> {
  if (typeof text !== "string") {
    return fail("not_a_string");
  }
  if (!isSupportedCurrency(currency)) {
    return fail("unsupported_currency");
  }
  const match = DECIMAL_GRAMMAR.exec(text);
  if (match === null) {
    return fail("invalid_format");
  }
  const exponent = exponentOf(currency);
  const negative = match[1] === "-";
  const integerPart = match[2] ?? "";
  const fractionPart = match[3] ?? "";
  if (fractionPart.length > exponent) {
    return fail("too_many_decimals");
  }
  const significant = integerPart.replace(/^0+/, "");
  // Cheap guard before BigInt: more digits than MAX_AMOUNT can have is out of range whatever they are.
  if (significant.length + exponent > String(MAX_AMOUNT).length) {
    return fail("amount_out_of_range");
  }
  const minorUnits = BigInt(`${significant}${fractionPart.padEnd(exponent, "0")}` || "0");
  if (negative && minorUnits === 0n) {
    return fail("negative_zero");
  }
  return fromBigInt(negative ? -minorUnits : minorUnits, currency);
}
