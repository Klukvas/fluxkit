import {
  CURRENCIES,
  MAX_AMOUNT as CORE_MAX_AMOUNT,
  parseDecimalString,
  toDecimalString,
  type SupportedCurrency,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { minorUnitsToDecimalString } from "./format";
import { MAX_AMOUNT, amountToInputText, parseDecimalAmount, parseMoneyInput } from "./money-input";

const UAH = 2;
const JPY = 0;
const KWD = 3;

describe("MAX_AMOUNT", () => {
  it("is core's limit (10^12 minor units), copied because the SPA does not import core", () => {
    expect(MAX_AMOUNT).toBe(CORE_MAX_AMOUNT);
  });
});

describe("parseDecimalAmount (core's strict grammar, by exponent)", () => {
  it("turns decimal text into integer minor units without floating point", () => {
    expect(parseDecimalAmount("1234.56", UAH)).toEqual({ ok: true, amount: 123456 });
    expect(parseDecimalAmount("0.05", UAH)).toEqual({ ok: true, amount: 5 });
    expect(parseDecimalAmount("0.1", UAH)).toEqual({ ok: true, amount: 10 });
    expect(parseDecimalAmount("12", UAH)).toEqual({ ok: true, amount: 1200 });
    expect(parseDecimalAmount("1500", JPY)).toEqual({ ok: true, amount: 1500 });
    expect(parseDecimalAmount("1.234", KWD)).toEqual({ ok: true, amount: 1234 });
    expect(parseDecimalAmount("1.2", KWD)).toEqual({ ok: true, amount: 1200 });
    expect(parseDecimalAmount("007.50", UAH)).toEqual({ ok: true, amount: 750 });
    expect(parseDecimalAmount("-2.50", UAH)).toEqual({ ok: true, amount: -250 });
  });

  it("never rounds: 0.1 + 0.2 style values stay exact, and too many decimals are refused", () => {
    expect(parseDecimalAmount("0.30", UAH)).toEqual({ ok: true, amount: 30 });
    expect(parseDecimalAmount("19.999", UAH)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseDecimalAmount("1.5", JPY)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseDecimalAmount("1.0", JPY)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseDecimalAmount("1.2345", KWD)).toEqual({ ok: false, reason: "too_many_decimals" });
  });

  it("accepts exactly the maximum and refuses one minor unit more, for every exponent", () => {
    expect(parseDecimalAmount("10000000000.00", UAH)).toEqual({ ok: true, amount: MAX_AMOUNT });
    expect(parseDecimalAmount("10000000000.01", UAH)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseDecimalAmount("1000000000000", JPY)).toEqual({ ok: true, amount: MAX_AMOUNT });
    expect(parseDecimalAmount("1000000000001", JPY)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseDecimalAmount("1000000000.000", KWD)).toEqual({ ok: true, amount: MAX_AMOUNT });
    expect(parseDecimalAmount("1000000000.001", KWD)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseDecimalAmount("-10000000000.00", UAH)).toEqual({ ok: true, amount: -MAX_AMOUNT });
  });

  it("refuses digits far beyond the range without building a huge number (integer overflow bound)", () => {
    expect(parseDecimalAmount("9".repeat(400), UAH)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseDecimalAmount("9007199254740993", JPY)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
  });

  it("refuses everything outside the grammar", () => {
    for (const text of [
      "",
      " ",
      "1,50",
      "1 000",
      "1.",
      ".5",
      "+5",
      "1e3",
      "0x10",
      "١٢",
      "１２",
      "--1",
      "1.2.3",
      " 1",
      "1 ",
      "Infinity",
      "NaN",
    ]) {
      expect(parseDecimalAmount(text, UAH), text).toEqual({ ok: false, reason: "invalid_format" });
    }
  });

  it("refuses negative zero in every spelling", () => {
    for (const text of ["-0", "-0.00", "-00", "-0.0"]) {
      expect(parseDecimalAmount(text, UAH), text).toEqual({ ok: false, reason: "negative_zero" });
    }
  });

  it("refuses an exponent that no currency has (a bug in the caller)", () => {
    expect(() => parseDecimalAmount("1", -1)).toThrow(RangeError);
    expect(() => parseDecimalAmount("1", 2.5)).toThrow(RangeError);
    expect(() => parseDecimalAmount("1", 21)).toThrow(RangeError);
  });

  it("answers exactly what core's parseDecimalString answers, for every currency and many generated texts", () => {
    const texts = generatedTexts();
    expect(texts.length).toBeGreaterThan(1000);
    for (const code of Object.keys(CURRENCIES) as SupportedCurrency[]) {
      const exponent = CURRENCIES[code];
      for (const text of texts) {
        const core = parseDecimalString(text, code);
        const ours = parseDecimalAmount(text, exponent);
        const expected = core.ok
          ? { ok: true, amount: core.money.amount }
          : { ok: false, reason: core.reason };
        expect(ours, `${code} ${JSON.stringify(text)}`).toEqual(expected);
      }
    }
  });
});

describe("amountToInputText (what the input shows for a stored amount)", () => {
  it("is core's toDecimalString for every currency and many amounts, and parses back exactly", () => {
    const amounts = generatedAmounts();
    for (const code of Object.keys(CURRENCIES) as SupportedCurrency[]) {
      const exponent = CURRENCIES[code];
      for (const amount of amounts) {
        const text = amountToInputText(amount, exponent);
        expect(text, `${code} ${amount}`).toBe(toDecimalString({ amount, currency: code }));
        expect(text).toBe(minorUnitsToDecimalString(amount, exponent));
        expect(parseDecimalAmount(text, exponent)).toEqual({ ok: true, amount });
      }
    }
  });

  it("never writes negative zero", () => {
    expect(amountToInputText(-0, UAH)).toBe("0.00");
    expect(amountToInputText(-0, JPY)).toBe("0");
  });
});

describe("parseMoneyInput (what an admin types into a price field)", () => {
  it("accepts a plain decimal and trims the whitespace around it (pasted text)", () => {
    expect(parseMoneyInput("  1234.56 ", UAH)).toEqual({ ok: true, amount: 123456 });
    expect(parseMoneyInput(" 12 ", UAH)).toEqual({ ok: true, amount: 1200 });
    expect(parseMoneyInput("0", UAH)).toEqual({ ok: true, amount: 0 });
    expect(parseMoneyInput("0.00", UAH)).toEqual({ ok: true, amount: 0 });
    expect(parseMoneyInput("1500", JPY)).toEqual({ ok: true, amount: 1500 });
    expect(parseMoneyInput("0.125", KWD)).toEqual({ ok: true, amount: 125 });
  });

  it("calls empty text empty (the caller decides whether a value is required)", () => {
    expect(parseMoneyInput("", UAH)).toEqual({ ok: false, reason: "empty" });
    expect(parseMoneyInput("   ", UAH)).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a comma with its own reason: the decimal separator is a dot (never guessed: 1,234 is ambiguous)", () => {
    expect(parseMoneyInput("12,50", UAH)).toEqual({ ok: false, reason: "comma_separator" });
    expect(parseMoneyInput("1,234", KWD)).toEqual({ ok: false, reason: "comma_separator" });
    expect(parseMoneyInput("1,234.56", UAH)).toEqual({ ok: false, reason: "comma_separator" });
  });

  it("refuses spaces inside the number (digit grouping) with its own reason", () => {
    expect(parseMoneyInput("1 234.56", UAH)).toEqual({ ok: false, reason: "inner_space" });
    expect(parseMoneyInput("1 234", UAH)).toEqual({ ok: false, reason: "inner_space" });
    expect(parseMoneyInput("1 234", UAH)).toEqual({ ok: false, reason: "inner_space" });
  });

  it("refuses a negative price and negative zero (a price is never below zero)", () => {
    expect(parseMoneyInput("-1", UAH)).toEqual({ ok: false, reason: "negative_amount" });
    expect(parseMoneyInput("-0.01", UAH)).toEqual({ ok: false, reason: "negative_amount" });
    expect(parseMoneyInput("-0", UAH)).toEqual({ ok: false, reason: "negative_zero" });
    expect(parseMoneyInput("-0.00", UAH)).toEqual({ ok: false, reason: "negative_zero" });
  });

  it("passes on core's reasons for everything else", () => {
    expect(parseMoneyInput("1.999", UAH)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseMoneyInput("1.5", JPY)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseMoneyInput("10000000000.01", UAH)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseMoneyInput("1e3", UAH)).toEqual({ ok: false, reason: "invalid_format" });
    expect(parseMoneyInput("abc", UAH)).toEqual({ ok: false, reason: "invalid_format" });
    expect(parseMoneyInput(".5", UAH)).toEqual({ ok: false, reason: "invalid_format" });
  });

  it("agrees with core on every trimmed text without comma or inner space", () => {
    for (const code of Object.keys(CURRENCIES) as SupportedCurrency[]) {
      const exponent = CURRENCIES[code];
      for (const text of generatedTexts()) {
        if (text.trim() === "" || /,/.test(text) || /\S\s+\S/.test(text)) continue;
        const core = parseDecimalString(text.trim(), code);
        const ours = parseMoneyInput(text, exponent);
        if (core.ok && core.money.amount >= 0) {
          expect(ours, `${code} ${JSON.stringify(text)}`).toEqual({
            ok: true,
            amount: core.money.amount,
          });
        } else {
          expect(ours.ok, `${code} ${JSON.stringify(text)}`).toBe(false);
        }
      }
    }
  });
});

/** A deterministic mix of valid and invalid decimal texts (no random source: the test must be reproducible). */
function generatedTexts(): string[] {
  const integers = [
    "0",
    "00",
    "1",
    "7",
    "10",
    "99",
    "100",
    "1234",
    "007",
    "999999999",
    "1000000000",
  ];
  const bigIntegers = [
    "9999999999",
    "10000000000",
    "100000000000",
    "999999999999",
    "1000000000000",
  ];
  const fractions = ["", ".", ".0", ".5", ".05", ".50", ".123", ".1234", ".999", ".000", ".00001"];
  const signs = ["", "-", "+", "--"];
  const texts = new Set<string>();
  for (const sign of signs) {
    for (const integer of [...integers, ...bigIntegers]) {
      for (const fraction of fractions) texts.add(`${sign}${integer}${fraction}`);
    }
  }
  for (const odd of [
    "",
    " ",
    "1,5",
    "1 5",
    ".5",
    "5.",
    "1e2",
    "1E2",
    "0x1",
    "Infinity",
    "-Infinity",
    "NaN",
    "١",
    "１",
    "1.2.3",
    "\t1",
    "1\n",
    "-.5",
    "+.5",
    "1_000",
    "1'000",
    "9".repeat(30),
    `0.${"0".repeat(30)}1`,
  ]) {
    texts.add(odd);
  }
  // A walk over magnitudes and digit patterns, every exponent's boundary included.
  let value = 1n;
  for (let step = 0; step < 60; step += 1) {
    value = value * 7n + BigInt(step);
    const digits = value.toString();
    for (let cut = 0; cut <= 4 && cut < digits.length; cut += 1) {
      const text = cut === 0 ? digits : `${digits.slice(0, -cut)}.${digits.slice(-cut)}`;
      texts.add(text);
      texts.add(`-${text}`);
    }
  }
  return [...texts];
}

function generatedAmounts(): number[] {
  const amounts = new Set<number>([0, 1, 5, 9, 10, 99, 100, 101, 999, 1000, 1001, 123456]);
  for (const limit of [MAX_AMOUNT, MAX_AMOUNT - 1, -MAX_AMOUNT, -1, -5, -100]) amounts.add(limit);
  let value = 3;
  for (let step = 0; step < 200; step += 1) {
    value = (value * 48271 + step) % MAX_AMOUNT;
    amounts.add(value);
    amounts.add(-value);
  }
  return [...amounts];
}
