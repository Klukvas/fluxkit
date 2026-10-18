/**
 * Display formatting of money. The storefront never adds, multiplies or rounds money (every total comes from the API,
 * ADR 0011), so this file only turns an integer count of minor units into text. No floating point value ever holds an
 * amount here: the digits are cut out of the integer's decimal text and handed to `Intl.NumberFormat` as a decimal
 * STRING, which Intl formats exactly (ES2023 NumberFormat v3, Node 22 and every current browser).
 */

export interface MoneyValue {
  amount: number;
  currency: string;
}

const MAX_EXPONENT = 20;

/**
 * Decimal text of `amount` minor units with `exponent` fraction digits: `(123456, 2)` is `"1234.56"`. Integer arithmetic
 * only; a non-integer, unsafe or non-finite amount is a bug in the caller and throws.
 */
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

/**
 * The number of minor-unit digits Intl knows for an ISO 4217 code (UAH, EUR, USD: 2; JPY: 0; KWD: 3). Used only when the
 * caller has no exponent; the shop's own exponent comes from `GET /store/config` and wins. An unknown code throws.
 */
export function currencyExponent(currency: string): number {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;
  if (digits === undefined) {
    throw new RangeError(`Intl reports no fraction digits for currency "${currency}".`);
  }
  return digits;
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

/** `exponent` is the shop's `currencyExponent` from `GET /store/config`; without it the currency's Intl default is used. */
export function formatMoney(
  money: MoneyValue,
  exponent: number | undefined,
  locale: string,
): string {
  const digits = exponent ?? currencyExponent(money.currency);
  const decimal = minorUnitsToDecimalString(money.amount, digits);
  return formatterFor(locale, money.currency, digits).format(decimal);
}
