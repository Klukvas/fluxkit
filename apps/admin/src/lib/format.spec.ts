import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, minorUnitsToDecimalString } from "./format";

describe("minorUnitsToDecimalString", () => {
  it("cuts the digits of an integer by the exponent, without floating point", () => {
    expect(minorUnitsToDecimalString(123456, 2)).toBe("1234.56");
    expect(minorUnitsToDecimalString(5, 2)).toBe("0.05");
    expect(minorUnitsToDecimalString(0, 2)).toBe("0.00");
    expect(minorUnitsToDecimalString(1500, 0)).toBe("1500");
    expect(minorUnitsToDecimalString(1234, 3)).toBe("1.234");
    expect(minorUnitsToDecimalString(-250, 2)).toBe("-2.50");
    expect(minorUnitsToDecimalString(1_000_000_000_000, 2)).toBe("10000000000.00");
  });

  it("refuses a non-integer amount or a bad exponent (a bug in the caller)", () => {
    expect(() => minorUnitsToDecimalString(1.5, 2)).toThrow(RangeError);
    expect(() => minorUnitsToDecimalString(Number.NaN, 2)).toThrow(RangeError);
    expect(() => minorUnitsToDecimalString(2 ** 60, 2)).toThrow(RangeError);
    expect(() => minorUnitsToDecimalString(1, -1)).toThrow(RangeError);
    expect(() => minorUnitsToDecimalString(1, 2.5)).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("formats minor units with the exponent of the admin config, never rounding", () => {
    const uah = formatMoney({ amount: 123456, currency: "UAH" }, 2, "en");
    expect(uah).toContain("1,234.56");
    expect(formatMoney({ amount: 1500, currency: "JPY" }, 0, "en")).toContain("1,500");
    expect(formatMoney({ amount: 1234, currency: "KWD" }, 3, "en")).toContain("1.234");
    // An exact amount is never rounded: the cents stay.
    expect(formatMoney({ amount: 999_999_999_999, currency: "USD" }, 2, "en")).toContain(
      "9,999,999,999.99",
    );
  });

  it("uses the UI language's separators", () => {
    const text = formatMoney({ amount: 123456, currency: "UAH" }, 2, "uk");
    expect(text.replace(/\s/g, " ")).toMatch(/1 234,56/);
  });
});

describe("formatDate and formatDateTime", () => {
  it("formats an instant in the given time zone and language", () => {
    const instant = "2026-10-19T21:30:00.000Z";
    expect(formatDate(instant, "en", { timeZone: "UTC" })).toBe("October 19, 2026");
    expect(formatDate(instant, "en", { timeZone: "Europe/Kyiv" })).toBe("October 20, 2026");
    expect(formatDateTime(instant, "en", { timeZone: "UTC" })).toContain("9:30");
  });

  it("refuses an invalid date instead of printing 'Invalid Date'", () => {
    expect(() => formatDate("not a date", "en")).toThrow(RangeError);
  });
});
