/**
 * Display formatting of money and dates (copied from the storefront's `lib/money.ts` and `lib/date.ts`; apps may not import
 * each other). No floating point value ever holds an amount: the digits are cut out of the integer's decimal text and
 * handed to `Intl.NumberFormat` as a decimal STRING, which Intl formats exactly. The exponent comes from the admin config
 * (`GET /admin/config`: `currencyExponent`, `supportedCurrencies[].exponent`), never from `amount / 100`.
 *
 * `@fluxkit/core` (`toDecimalString`, the currency table) is NOT imported: core has a single entry and no
 * `"sideEffects": false`, so one import pulls zod and the whole core into the bundle (measured in step 4b: 88.6 KB
 * minified for `parseDecimalString` plus `toDecimalString`; see `apps/admin/README.md`).
 */

export interface MoneyValue {
  amount: number;
  currency: string;
}

const MAX_EXPONENT = 20;

/** Decimal text of `amount` minor units with `exponent` fraction digits: `(123456, 2)` is `"1234.56"`. Throws on a bug. */
export function minorUnitsToDecimalString(amount: number, exponent: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("A money amount must be a safe integer count of minor units.");
  }
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_EXPONENT) {
    throw new RangeError(`The currency exponent must be an integer from 0 to ${MAX_EXPONENT}.`);
  }
  const magnitude = BigInt(amount) < 0n ? -BigInt(amount) : BigInt(amount);
  const sign = amount < 0 ? "-" : "";
  if (exponent === 0) return `${sign}${magnitude}`;
  const digits = magnitude.toString().padStart(exponent + 1, "0");
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: string, currency: string, exponent: number): Intl.NumberFormat {
  const key = `${locale}|${currency}|${exponent}`;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    // Minimum and maximum are both the exponent, so Intl neither rounds an exact amount nor drops a trailing zero.
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** `exponent` is the currency's exponent from the admin config. */
export function formatMoney(money: MoneyValue, exponent: number, locale: string): string {
  const decimal = minorUnitsToDecimalString(money.amount, exponent);
  // Digits and at most one dot by construction, which is what the string-numeric type states.
  return formatterFor(locale, money.currency, exponent).format(decimal as `${number}`);
}

export interface DateFormatOptions {
  /** IANA zone. Omitted: the browser's zone (there is no shop time zone setting, plan gap 18). */
  timeZone?: string;
}

function toDate(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Cannot format an invalid date.");
  }
  return date;
}

function format(
  value: string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  zone: DateFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    ...(zone.timeZone === undefined ? {} : { timeZone: zone.timeZone }),
  }).format(toDate(value));
}

/** Calendar date, for example "19 жовтня 2026 р." or "October 19, 2026". An invalid date throws. */
export function formatDate(
  value: string | Date,
  locale: string,
  zone: DateFormatOptions = {},
): string {
  return format(value, locale, { dateStyle: "long" }, zone);
}

/** Date and time, for example the last sign-in. An invalid date throws. */
export function formatDateTime(
  value: string | Date,
  locale: string,
  zone: DateFormatOptions = {},
): string {
  return format(value, locale, { dateStyle: "long", timeStyle: "short" }, zone);
}
