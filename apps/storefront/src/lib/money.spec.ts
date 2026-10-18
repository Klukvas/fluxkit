import { describe, expect, it } from "vitest";
import { currencyExponent, formatMoney, minorUnitsToDecimalString } from "./money";

describe("minorUnitsToDecimalString", () => {
  it.each([
    [0, 2, "0.00"],
    [5, 2, "0.05"],
    [100, 2, "1.00"],
    [123456, 2, "1234.56"],
    [-5, 2, "-0.05"],
    [-123456, 2, "-1234.56"],
    [12345, 0, "12345"],
    [0, 0, "0"],
    [-7, 0, "-7"],
    [1, 3, "0.001"],
    [1234567, 3, "1234.567"],
    [-1, 3, "-0.001"],
    [1_000_000_000_000, 2, "10000000000.00"],
    [1_000_000_000_000, 0, "1000000000000"],
    [1_000_000_000_000, 3, "1000000000.000"],
    [-1_000_000_000_000, 2, "-10000000000.00"],
    [Number.MAX_SAFE_INTEGER, 2, "90071992547409.91"],
  ])("%d minor units with exponent %d is %s", (amount, exponent, expected) => {
    expect(minorUnitsToDecimalString(amount, exponent)).toBe(expected);
  });

  it("never produces scientific notation or float artifacts", () => {
    for (const amount of [1e12, 999_999_999_999, 123_456_789_012, 10]) {
      expect(minorUnitsToDecimalString(amount, 2)).toMatch(/^-?\d+\.\d{2}$/);
    }
    // 0.1 + 0.2 style artifacts: 29 cents is exactly 0.29, not 0.28999999999999998.
    expect(minorUnitsToDecimalString(29, 2)).toBe("0.29");
    expect(minorUnitsToDecimalString(1_000_000_000_001, 2)).toBe("10000000000.01");
  });

  it("does not return negative zero text", () => {
    expect(minorUnitsToDecimalString(-0, 2)).toBe("0.00");
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    "refuses %s: an amount is a safe integer",
    (amount) => {
      expect(() => minorUnitsToDecimalString(amount, 2)).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, 21, Number.NaN])("refuses exponent %s", (exponent) => {
    expect(() => minorUnitsToDecimalString(1, exponent)).toThrow(RangeError);
  });
});

describe("currencyExponent", () => {
  it.each([
    ["UAH", 2],
    ["EUR", 2],
    ["USD", 2],
    ["JPY", 0],
    ["KWD", 3],
  ])("%s has %d minor-unit digits", (currency, exponent) => {
    expect(currencyExponent(currency)).toBe(exponent);
  });

  it("does not depend on the display locale", () => {
    expect(currencyExponent("JPY")).toBe(0);
  });

  it("throws for a code Intl does not know instead of guessing", () => {
    expect(() => currencyExponent("not-a-currency")).toThrow(RangeError);
  });
});

/** Intl output uses non-breaking and narrow spaces; compare with plain spaces. */
function plain(text: string): string {
  return text.replace(/[  ]/g, " ");
}

describe("formatMoney", () => {
  it("formats UAH in uk and en with the shop's exponent", () => {
    expect(plain(formatMoney({ amount: 123456, currency: "UAH" }, 2, "uk"))).toBe("1 234,56 ₴");
    expect(plain(formatMoney({ amount: 123456, currency: "UAH" }, 2, "en"))).toBe("UAH 1,234.56");
  });

  it("formats EUR and USD", () => {
    expect(plain(formatMoney({ amount: 999, currency: "EUR" }, 2, "en"))).toBe("€9.99");
    expect(plain(formatMoney({ amount: 999, currency: "USD" }, 2, "en"))).toBe("$9.99");
    expect(plain(formatMoney({ amount: 999, currency: "EUR" }, 2, "uk"))).toBe("9,99 EUR");
  });

  it("formats exponent 0 (JPY) without fraction digits and exponent 3 with three", () => {
    expect(plain(formatMoney({ amount: 1500, currency: "JPY" }, 0, "en"))).toBe("¥1,500");
    expect(plain(formatMoney({ amount: 1234567, currency: "KWD" }, 3, "en"))).toBe("KWD 1,234.567");
  });

  it("derives the exponent from the currency when none is given", () => {
    expect(plain(formatMoney({ amount: 1500, currency: "JPY" }, undefined, "en"))).toBe("¥1,500");
    expect(plain(formatMoney({ amount: 150, currency: "EUR" }, undefined, "en"))).toBe("€1.50");
  });

  it("keeps the exponent the caller gives even when Intl would use another", () => {
    // The API's exponent is authoritative; the formatter must neither round nor pad differently.
    expect(plain(formatMoney({ amount: 1234, currency: "UAH" }, 3, "en"))).toBe("UAH 1.234");
  });

  it("formats zero and negative amounts", () => {
    expect(plain(formatMoney({ amount: 0, currency: "UAH" }, 2, "en"))).toBe("UAH 0.00");
    expect(plain(formatMoney({ amount: -250, currency: "USD" }, 2, "en"))).toBe("-$2.50");
  });

  it("keeps every digit of the largest amounts (10^12 minor units)", () => {
    expect(plain(formatMoney({ amount: 1_000_000_000_000, currency: "USD" }, 2, "en"))).toBe(
      "$10,000,000,000.00",
    );
    expect(plain(formatMoney({ amount: 999_999_999_999, currency: "USD" }, 2, "en"))).toBe(
      "$9,999,999,999.99",
    );
    expect(plain(formatMoney({ amount: 1_000_000_000_001, currency: "USD" }, 2, "en"))).toBe(
      "$10,000,000,000.01",
    );
    expect(plain(formatMoney({ amount: -1_000_000_000_000, currency: "UAH" }, 2, "uk"))).toBe(
      "-10 000 000 000,00 ₴",
    );
    expect(plain(formatMoney({ amount: 1_000_000_000_000, currency: "JPY" }, 0, "en"))).toBe(
      "¥1,000,000,000,000",
    );
  });

  it("never prints scientific notation", () => {
    for (const amount of [1_000_000_000_000, 123_456_789_012, 1]) {
      expect(formatMoney({ amount, currency: "USD" }, 2, "en")).not.toMatch(/e[+-]?\d/i);
    }
  });

  it("is exact where a float would not be: digits beyond 2^53 / 100 survive", () => {
    // 90071992547409.91 is not representable as a double (it prints as ...9.9). The decimal STRING path keeps it.
    expect(plain(formatMoney({ amount: Number.MAX_SAFE_INTEGER, currency: "USD" }, 2, "en"))).toBe(
      "$90,071,992,547,409.91",
    );
  });

  it("refuses a non-integer amount instead of rounding it", () => {
    expect(() => formatMoney({ amount: 10.5, currency: "USD" }, 2, "en")).toThrow(RangeError);
  });
});
