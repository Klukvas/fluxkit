import { minorUnitsToDecimalString } from "./money";

/**
 * The price filter of the search page talks to the shopper in major units ("12.50") and to the API in minor units
 * (`price=1250..5000`). Both directions work on decimal TEXT and integers: no amount is ever a floating point number
 * (`0.29 * 100` is `28.999...`).
 */

/**
 * `"12.5"` or `"12,5"` with 2 digits is `1250`. Plain decimal text only: no sign, no exponent, no spaces inside, at most
 * `exponent` fraction digits. `null` for anything else, so a typo is shown to the shopper instead of becoming a wrong filter.
 */
export function decimalToMinorUnits(text: string, exponent: number): number | null {
  const match = /^(\d{1,15})(?:[.,](\d+))?$/.exec(text.trim());
  if (match === null) return null;
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  const amount = Number(`${whole}${fraction.padEnd(exponent, "0")}`);
  return Number.isSafeInteger(amount) ? amount : null;
}

/** The text for a price box: `(1250, 2)` is `"12.5"`, `(1200, 2)` is `"12"`. */
export function minorUnitsToInput(amount: number, exponent: number): string {
  const text = minorUnitsToDecimalString(amount, exponent);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
