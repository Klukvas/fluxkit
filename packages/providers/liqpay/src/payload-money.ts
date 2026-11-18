import type { Money } from "@fluxkit/core";

/*
 * Amount conversion without float money arithmetic (ADR 0059 review). Outbound major amounts are built from
 * integer quotient/remainder; inbound answers may be numbers or decimal strings (LiqPay docs use both).
 */

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Exact major-unit text with two decimals (truncate toward zero). */
export function majorAmountText(amount: Money): string | undefined {
  if (!Number.isSafeInteger(amount.amount) || amount.amount < 0) {
    return undefined;
  }
  const whole = Math.trunc(amount.amount / 100);
  const frac = Math.abs(amount.amount % 100);
  return `${String(whole)}.${String(frac).padStart(2, "0")}`;
}

/**
 * Major amount as a JSON number derived from integer minor units (two decimal places). Prefer embedding
 * `majorAmountText` in signed payloads when the host accepts a string; LiqPay checkout docs type `amount` as Number.
 */
export function majorAmountOf(amount: Money): number {
  const text = majorAmountText(amount);
  if (text === undefined) {
    return Number.NaN;
  }
  return Number(text);
}

/** Parse a LiqPay major amount (number or decimal string, at most two fractional digits) into minor units. */
export function minorAmountOf(major: number | string): number | undefined {
  if (typeof major === "number") {
    if (!Number.isFinite(major) || major < 0) {
      return undefined;
    }
    return minorFromDecimalText(String(major));
  }
  if (typeof major !== "string") {
    return undefined;
  }
  return minorFromDecimalText(major.trim());
}

function minorFromDecimalText(text: string): number | undefined {
  const match = DECIMAL.exec(text);
  if (match === null) {
    return undefined;
  }
  const wholeText = match[1] ?? "";
  const fracRaw = match[2] ?? "";
  if (fracRaw.length > 2) {
    return undefined;
  }
  if (!/^\d+$/.test(wholeText) || wholeText.length > 15) {
    return undefined;
  }
  const whole = Number(wholeText);
  const frac = Number((fracRaw + "00").slice(0, 2));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(frac)) {
    return undefined;
  }
  const minor = whole * 100 + frac;
  return Number.isSafeInteger(minor) ? minor : undefined;
}
