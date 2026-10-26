import { describe, expect, it } from "vitest";
import { formatOrderMoney } from "./order-mail-money.js";

describe("formatOrderMoney (minor units to text at render time, no floats)", () => {
  it("prints the exact decimal of the currency's exponent and the currency code", () => {
    expect(formatOrderMoney(123_456, "UAH")).toBe("1234.56 UAH");
    expect(formatOrderMoney(5, "UAH")).toBe("0.05 UAH");
    expect(formatOrderMoney(0, "UAH")).toBe("0.00 UAH");
    expect(formatOrderMoney(1_999, "EUR")).toBe("19.99 EUR");
  });

  it("uses no fraction for a zero-exponent currency and three digits for a three-exponent one", () => {
    expect(formatOrderMoney(1_500, "JPY")).toBe("1500 JPY");
    expect(formatOrderMoney(0, "JPY")).toBe("0 JPY");
    expect(formatOrderMoney(12_345, "KWD")).toBe("12.345 KWD");
    expect(formatOrderMoney(7, "KWD")).toBe("0.007 KWD");
  });

  it("is exact for amounts a float would round (no float math)", () => {
    expect(formatOrderMoney(999_999_999_999, "UAH")).toBe("9999999999.99 UAH");
    expect(formatOrderMoney(1_000_000_000_000, "KWD")).toBe("1000000000.000 KWD");
    expect(formatOrderMoney(1_000_000_000_000, "JPY")).toBe("1000000000000 JPY");
  });

  it("refuses an amount or currency that is not money (a bug, never printed)", () => {
    expect(() => formatOrderMoney(1.5, "UAH")).toThrow(RangeError);
    expect(() => formatOrderMoney(-1, "UAH")).toThrow(RangeError);
    expect(() => formatOrderMoney(1, "RUB")).toThrow(RangeError);
    expect(() => formatOrderMoney(1, "<script>")).toThrow(RangeError);
    expect(() => formatOrderMoney(Number.NaN, "UAH")).toThrow(RangeError);
  });
});
