import { minorUnitsToDecimalString } from "./format";

/**
 * Money typed by an admin (plan, "Forms and validation", Money input): decimal TEXT to an integer count of minor units,
 * never through a floating point number. A copy of core's `parseDecimalString` grammar (`packages/core/src/pricing/money.ts`,
 * ADR 0011), keyed by the currency's exponent from `GET /admin/config` instead of core's currency table, because importing
 * `@fluxkit/core` pulls zod and the whole core into the bundle (`apps/admin/README.md`). `money-input.spec.ts` compares it
 * with core over every currency and thousands of generated texts. The API stays the authority: it validates the integer.
 */

/** Largest absolute amount in minor units: core's `MAX_AMOUNT` (10^12; compared in the spec). */
export const MAX_AMOUNT = 1_000_000_000_000;

const MAX_AMOUNT_DIGITS = String(MAX_AMOUNT).length;
const MAX_EXPONENT = 20;

/** core's reasons for text it cannot turn into money (`ParseMoneyFailure` without the type and currency checks). */
export type DecimalFailure =
  "invalid_format" | "too_many_decimals" | "negative_zero" | "amount_out_of_range";

/** What a price field can answer: core's reasons plus the input conveniences a person needs explained. */
export type MoneyInputFailure =
  DecimalFailure | "empty" | "comma_separator" | "inner_space" | "negative_amount";

export type DecimalResult<Reason extends string> =
  { ok: true; amount: number } | { ok: false; reason: Reason };

const DECIMAL_GRAMMAR = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

function assertExponent(exponent: number): void {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_EXPONENT) {
    throw new RangeError(`The currency exponent must be an integer from 0 to ${MAX_EXPONENT}.`);
  }
}

/**
 * Core's strict grammar: an optional minus, ASCII digits, an optional dot with 1 to `exponent` digits. Refused: more
 * decimals than the currency has, a comma, spaces, a plus, `.5`, `5.`, exponent notation, non-ASCII digits, negative zero
 * and anything beyond `MAX_AMOUNT`. The digits are joined as text and converted with BigInt, so nothing is rounded.
 */
export function parseDecimalAmount(text: string, exponent: number): DecimalResult<DecimalFailure> {
  assertExponent(exponent);
  const match = DECIMAL_GRAMMAR.exec(text);
  if (match === null) return { ok: false, reason: "invalid_format" };
  const negative = match[1] === "-";
  const integerPart = match[2] ?? "";
  const fractionPart = match[3] ?? "";
  if (fractionPart.length > exponent) return { ok: false, reason: "too_many_decimals" };
  const significant = integerPart.replace(/^0+/, "");
  // More digits than MAX_AMOUNT can have is out of range whatever they are (no huge BigInt for a pasted wall of nines).
  if (significant.length + exponent > MAX_AMOUNT_DIGITS) {
    return { ok: false, reason: "amount_out_of_range" };
  }
  const minorUnits = BigInt(`${significant}${fractionPart.padEnd(exponent, "0")}` || "0");
  if (negative && minorUnits === 0n) return { ok: false, reason: "negative_zero" };
  if (minorUnits > BigInt(MAX_AMOUNT)) return { ok: false, reason: "amount_out_of_range" };
  const magnitude = Number(minorUnits);
  return { ok: true, amount: negative ? -magnitude : magnitude };
}

/** The text a field shows for a stored amount: core's `toDecimalString` (`1234.56`, `1500`, `1.234`; never `-0`). */
export function amountToInputText(amount: number, exponent: number): string {
  return minorUnitsToDecimalString(amount === 0 ? 0 : amount, exponent);
}

/**
 * A price field's text. Whitespace around the number is trimmed (pasted text); inside it, a space (digit grouping) and a
 * comma are refused with their own reasons: a comma is never taken as the decimal separator, because `1,234` means 1.234
 * in one language and 1234 in another, and a money field must not guess. A price is never negative.
 */
export function parseMoneyInput(text: string, exponent: number): DecimalResult<MoneyInputFailure> {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.includes(",")) return { ok: false, reason: "comma_separator" };
  if (/\s/u.test(trimmed)) return { ok: false, reason: "inner_space" };
  const parsed = parseDecimalAmount(trimmed, exponent);
  if (!parsed.ok) return parsed;
  if (parsed.amount < 0) return { ok: false, reason: "negative_amount" };
  return parsed;
}
