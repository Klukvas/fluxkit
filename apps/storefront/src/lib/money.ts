import type { Locale } from "@fluxkit/ui";

/**
 * Display formatting of money. The storefront never adds, multiplies or rounds money (every total comes from the API,
 * ADR 0011), so this file only turns an integer count of minor units into text. No floating point value ever holds an
 * amount here: the digits are cut out of the integer's decimal text with BigInt.
 *
 * The text is built by this file alone, never by `Intl.NumberFormat` (review SQ-06/D-01, 2026-11-02): the currency symbol
 * and the spaces Intl prints come from the runtime's ICU data, which differs between Node and the browser (Node prints
 * `599,00 ₴`, Chromium `599,00 грн`), so a price rendered on the server and again in the browser did not match and React
 * re-rendered every page with a price. The separators and symbols below are fixed per locale, so both sides print the same.
 */

export interface MoneyValue {
  amount: number;
  currency: string;
}

const MAX_EXPONENT = 20;
/** U+00A0: a price never wraps between its digits and its symbol. */
const NO_BREAK_SPACE = " ";

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
 * caller has no exponent; the shop's own exponent comes from `GET /store/config` and wins. An unknown code throws. (This is
 * ISO 4217 data, the same in every runtime; nothing of Intl's output is displayed.)
 */
export function currencyExponent(currency: string): number {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;
  if (digits === undefined) {
    throw new RangeError(`Intl reports no fraction digits for currency "${currency}".`);
  }
  return digits;
}

interface LocaleMoneyFormat {
  /** Between groups of three digits. */
  group: string;
  decimal: string;
  /** `prefix`: `$1,234.56`; `suffix`: `1 234,56 ₴` (always with a no-break space). */
  position: "prefix" | "suffix";
  /** Symbol per ISO code; a code without an entry is shown as the code itself. */
  symbols: Readonly<Record<string, string>>;
}

/**
 * One row per storefront locale (a new locale fails the type check until it has one). The symbols cover every currency the
 * API accepts as `SHOP_CURRENCY` (`SUPPORTED_SHOP_CURRENCIES` of `@fluxkit/config`, checked by `money.spec.ts`). English
 * keeps the ISO code for UAH (`UAH 599.00`): an English-speaking shopper may not know the hryvnia sign.
 */
const MONEY_FORMATS: Readonly<Record<Locale, LocaleMoneyFormat>> = {
  uk: {
    group: NO_BREAK_SPACE,
    decimal: ",",
    position: "suffix",
    symbols: {
      UAH: "₴",
      USD: "$",
      EUR: "€",
      GBP: "£",
      PLN: "zł",
      CZK: "Kč",
      CHF: "CHF",
      CAD: "CA$",
      JPY: "¥",
      KWD: "KWD",
    },
  },
  en: {
    group: ",",
    decimal: ".",
    position: "prefix",
    symbols: {
      UAH: "UAH",
      USD: "$",
      EUR: "€",
      GBP: "£",
      PLN: "PLN",
      CZK: "CZK",
      CHF: "CHF",
      CAD: "CA$",
      JPY: "¥",
      KWD: "KWD",
    },
  },
};

function moneyFormat(locale: string): LocaleMoneyFormat {
  const format = (MONEY_FORMATS as Readonly<Record<string, LocaleMoneyFormat>>)[locale];
  if (format === undefined) throw new RangeError(`No money format for locale "${locale}".`);
  return format;
}

function groupDigits(whole: string, separator: string): string {
  let grouped = "";
  for (let end = whole.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3);
    grouped =
      grouped === "" ? whole.slice(start, end) : `${whole.slice(start, end)}${separator}${grouped}`;
  }
  return grouped;
}

/** `exponent` is the shop's `currencyExponent` from `GET /store/config`; without it the currency's Intl default is used. */
export function formatMoney(
  money: MoneyValue,
  exponent: number | undefined,
  locale: string,
): string {
  const format = moneyFormat(locale);
  const decimal = minorUnitsToDecimalString(
    money.amount,
    exponent ?? currencyExponent(money.currency),
  );
  const negative = decimal.startsWith("-");
  const [whole, fraction] = (negative ? decimal.slice(1) : decimal).split(".") as [string, string?];
  const number =
    groupDigits(whole, format.group) +
    (fraction === undefined ? "" : `${format.decimal}${fraction}`);
  const symbol = format.symbols[money.currency] ?? money.currency;
  const sign = negative ? "-" : "";
  if (format.position === "suffix") return `${sign}${number}${NO_BREAK_SPACE}${symbol}`;
  // A letter code is set apart (`UAH 599.00`); a sign is not (`$9.99`).
  const gap = /\p{L}$/u.test(symbol) ? NO_BREAK_SPACE : "";
  return `${sign}${symbol}${gap}${number}`;
}
