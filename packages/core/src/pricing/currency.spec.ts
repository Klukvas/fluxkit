import { describe, expect, it } from "vitest";
import { CURRENCIES, CURRENCY_CODES, exponentOf, isSupportedCurrency } from "./currency.js";

describe("CURRENCIES", () => {
  it("holds the ISO 4217 exponents of the supported currencies", () => {
    expect({ ...CURRENCIES }).toEqual({
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
  });

  it("is frozen and lists its codes", () => {
    expect(Object.isFrozen(CURRENCIES)).toBe(true);
    expect(Object.isFrozen(CURRENCY_CODES)).toBe(true);
    expect([...CURRENCY_CODES].sort()).toEqual(Object.keys(CURRENCIES).sort());
  });
});

describe("isSupportedCurrency", () => {
  it("accepts every code of the table", () => {
    for (const code of CURRENCY_CODES) {
      expect(isSupportedCurrency(code), code).toBe(true);
    }
  });

  it("is exact: upper case, no padding, no look-alikes", () => {
    for (const code of ["uah", "Uah", " UAH", "UAH ", "UAH\n", "UA", "UAHH", "", "ЕUR", "usd"]) {
      expect(isSupportedCurrency(code), JSON.stringify(code)).toBe(false);
    }
  });

  it("rejects codes that are not in the table", () => {
    for (const code of ["RUB", "BTC", "XXX", "AAA"]) {
      expect(isSupportedCurrency(code), code).toBe(false);
    }
  });

  it("is own-property safe: inherited object keys are not currencies", () => {
    for (const key of [
      "__proto__",
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "prototype",
    ]) {
      expect(isSupportedCurrency(key), key).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 0, 840, {}, [], ["UAH"], true, Symbol("UAH")]) {
      expect(isSupportedCurrency(value), typeof value).toBe(false);
    }
  });
});

describe("exponentOf", () => {
  it("returns the number of minor unit digits", () => {
    expect(exponentOf("UAH")).toBe(2);
    expect(exponentOf("JPY")).toBe(0);
    expect(exponentOf("KWD")).toBe(3);
  });

  it("throws RangeError for a code outside the table (misconfiguration, not data)", () => {
    expect(() => exponentOf("RUB" as never)).toThrow(RangeError);
    expect(() => exponentOf("toString" as never)).toThrow(RangeError);
    expect(() => exponentOf("__proto__" as never)).toThrow(RangeError);
  });
});
