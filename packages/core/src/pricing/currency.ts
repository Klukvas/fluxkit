/**
 * ISO 4217 currencies the template can sell in, with their minor unit exponent (digits after the decimal point).
 * A plain frozen object on purpose; lookups go through `Object.hasOwn`, so `__proto__`, `constructor` and
 * `toString` are never currencies.
 */
export const CURRENCIES = Object.freeze({
  UAH: 2,
  USD: 2,
  EUR: 2,
  PLN: 2,
  GBP: 2,
  CZK: 2,
  CHF: 2,
  CAD: 2,
  JPY: 0,
  KWD: 3,
});

export type SupportedCurrency = keyof typeof CURRENCIES;

export const CURRENCY_CODES: readonly SupportedCurrency[] = Object.freeze(
  Object.keys(CURRENCIES) as SupportedCurrency[],
);

/** Exact match: upper case, three letters, in the table. */
export function isSupportedCurrency(code: unknown): code is SupportedCurrency {
  return typeof code === "string" && Object.hasOwn(CURRENCIES, code);
}

/** A code outside the table is a programming or configuration error, not user data: validate with `isSupportedCurrency` first. */
export function exponentOf(code: SupportedCurrency): number {
  if (!isSupportedCurrency(code)) {
    throw new RangeError(`Unsupported currency: ${String(code)}`);
  }
  return CURRENCIES[code];
}
