import { createMoney, toDecimalString } from "@fluxkit/core";

/**
 * An amount of an order mail as text, at RENDER time: the exact decimal of the currency's exponent (core
 * `toDecimalString`, integers only, no float) and the ISO code, e.g. `1234.56 UAH`, `1500 JPY`, `12.345 KWD`. No symbol
 * is hardcoded (symbols and grouping are a design choice of a client's template override). The frozen variables hold
 * minor units and the code, never text, so a mail renders the same on every attempt. A negative amount, a fraction or an
 * unsupported currency is a bug of the writer (RangeError): the mail then fails `render_failed`, never prints a guess.
 */
export function formatOrderMoney(amount: number, currency: string): string {
  const money = createMoney(amount, currency);
  if (!money.ok || money.money.amount < 0) {
    throw new RangeError(
      "An order mail amount must be a non-negative amount in a supported currency",
    );
  }
  return `${toDecimalString(money.money)} ${money.money.currency}`;
}
