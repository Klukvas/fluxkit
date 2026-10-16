import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import {
  CONTACT_LIMITS,
  normalizePhone,
  shippingAddressRequired,
  validateAddress,
  validatePersonName,
} from "./contact.js";

describe("normalizePhone", () => {
  const ok = (phone: string) => ({ ok: true, phone });

  it("keeps an optional leading plus and the digits, drops spaces, dashes, dots and parentheses", () => {
    expect(normalizePhone("+380 (44) 123-45-67")).toEqual(ok("+380441234567"));
    expect(normalizePhone("0441234567")).toEqual(ok("0441234567"));
    expect(normalizePhone("+1.202.555.0100")).toEqual(ok("+12025550100"));
    expect(normalizePhone("  (044) 123 45 67  ")).toEqual(ok("0441234567"));
    expect(normalizePhone("+ 380 44 123 45 67")).toEqual(ok("+380441234567"));
  });

  it("does not guess a country: no prefix is added or changed", () => {
    expect(normalizePhone("0441234567")).toEqual(ok("0441234567"));
    expect(normalizePhone("00380441234567")).toEqual(ok("00380441234567"));
  });

  it("accepts 7 and 15 digits, refuses 6 and 16", () => {
    expect(normalizePhone("1234567")).toEqual(ok("1234567"));
    expect(normalizePhone("+123456789012345")).toEqual(ok("+123456789012345"));
    expect(normalizePhone("123456")).toEqual({ ok: false, reason: "too_short" });
    expect(normalizePhone("()")).toEqual({ ok: false, reason: "too_short" });
    expect(normalizePhone("+ - .")).toEqual({ ok: false, reason: "too_short" });
    expect(normalizePhone("1234567890123456")).toEqual({ ok: false, reason: "too_long" });
    expect(normalizePhone("+1234567890123456")).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses letters, a plus in the middle, two pluses, other separators and non-ASCII digits", () => {
    for (const text of [
      "",
      "   ",
      "+",
      "abc1234567",
      "380+441234567",
      "++380441234567",
      "+380/441234567",
      "380,441234567",
      "380_441234567",
      "+380441234567 ext 5",
      "٣٨٠٤٤١٢٣٤٥٦٧", // Arabic-Indic digits
      "＋380441234567", // full-width plus
      "380\n441234567",
    ]) {
      expect(normalizePhone(text), JSON.stringify(text)).toEqual({
        ok: false,
        reason: "invalid_format",
      });
    }
  });

  it("refuses anything that is not text", () => {
    for (const value of [undefined, null, 380441234567, {}, [], true]) {
      expect(normalizePhone(value)).toEqual({ ok: false, reason: "not_a_string" });
    }
  });

  it("is idempotent and returns a plain string", () => {
    const first = normalizePhone("+380 (44) 123-45-67");
    if (!first.ok) throw new Error("expected ok");
    expect(normalizePhone(first.phone)).toEqual(first);
  });

  it("exposes the limits it uses", () => {
    expect(CONTACT_LIMITS).toEqual({
      text: 200,
      postalCode: 20,
      name: 100,
      phoneMinDigits: 7,
      phoneMaxDigits: 15,
    });
    expect(Object.isFrozen(CONTACT_LIMITS)).toBe(true);
  });
});

describe("validatePersonName", () => {
  it("trims and accepts 1 to 100 characters, counted as code points", () => {
    expect(validatePersonName("  Олена ")).toEqual({ ok: true, name: "Олена" });
    expect(validatePersonName("a")).toEqual({ ok: true, name: "a" });
    expect(validatePersonName("a".repeat(100))).toMatchObject({ ok: true });
    expect(validatePersonName("😀".repeat(100))).toMatchObject({ ok: true });
    expect(validatePersonName("😀".repeat(101))).toEqual({ ok: false, reason: "too_long" });
    expect(validatePersonName("a".repeat(101))).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses empty text, other types and unsafe characters", () => {
    expect(validatePersonName("")).toEqual({ ok: false, reason: "empty" });
    expect(validatePersonName("  \t ")).toEqual({ ok: false, reason: "empty" });
    expect(validatePersonName(null)).toEqual({ ok: false, reason: "not_a_string" });
    expect(validatePersonName(5)).toEqual({ ok: false, reason: "not_a_string" });
    for (const text of ["a\u0000b", "a\nb", "a\u0007b", "a\u007fb", "a\ud800b"]) {
      expect(validatePersonName(text), JSON.stringify(text)).toEqual({
        ok: false,
        reason: "invalid_characters",
      });
    }
  });
});

describe("validateAddress", () => {
  const full = {
    countryCode: "UA",
    region: "Київська область",
    city: "Київ",
    postalCode: "01001",
    line1: "вул. Хрещатик, 1",
    line2: "кв. 5",
    recipientFirstName: "Олена",
    recipientLastName: "Шевченко",
    recipientPhone: "+380 44 123 45 67",
  };

  it("accepts a full address and normalizes text and phone", () => {
    expect(validateAddress(deepFreeze({ ...full, city: "  Київ  " }))).toEqual({
      ok: true,
      address: { ...full, city: "Київ", recipientPhone: "+380441234567" },
    });
  });

  it("accepts the shortest address and leaves out the optional fields that were not sent", () => {
    const result = validateAddress({ countryCode: "PL", city: "Kraków", line1: "Rynek 1" });
    expect(result).toEqual({
      ok: true,
      address: { countryCode: "PL", city: "Kraków", line1: "Rynek 1" },
    });
    if (result.ok) {
      expect(Object.keys(result.address).sort()).toEqual(["city", "countryCode", "line1"]);
    }
  });

  it("treats null and undefined optional fields as not sent", () => {
    const result = validateAddress({
      countryCode: "PL",
      city: "Kraków",
      line1: "Rynek 1",
      region: null,
      line2: undefined,
      postalCode: null,
    });
    expect(result).toEqual({
      ok: true,
      address: { countryCode: "PL", city: "Kraków", line1: "Rynek 1" },
    });
  });

  it("has no country-specific rule: any text works for any country, a postal code is just text", () => {
    expect(
      validateAddress({ countryCode: "US", city: "X", line1: "Y", postalCode: "ABC 123 / x" }),
    ).toMatchObject({ ok: true });
    expect(
      validateAddress({ countryCode: "UA", city: "X", line1: "Нова Пошта, відділення №12" }),
    ).toMatchObject({ ok: true });
  });

  it("requires country code, city and line 1, all at once", () => {
    expect(validateAddress({})).toEqual({
      ok: false,
      errors: [
        { field: "countryCode", reason: "required" },
        { field: "city", reason: "required" },
        { field: "line1", reason: "required" },
      ],
    });
  });

  it("checks the country code pattern only: two upper-case ASCII letters", () => {
    for (const countryCode of ["ua", "Ua", "UKR", "U", "", "U1", "У А", "ÜA", "UA "]) {
      const result = validateAddress({ countryCode, city: "X", line1: "Y" });
      expect(result, JSON.stringify(countryCode)).toMatchObject({ ok: false });
    }
    expect(validateAddress({ countryCode: "XX", city: "X", line1: "Y" })).toMatchObject({
      ok: true,
    });
  });

  it("limits text to 200 characters and the postal code to 20", () => {
    const base = { countryCode: "UA", city: "X", line1: "Y" };
    expect(validateAddress({ ...base, line1: "a".repeat(200) })).toMatchObject({ ok: true });
    expect(validateAddress({ ...base, line1: "a".repeat(201) })).toEqual({
      ok: false,
      errors: [{ field: "line1", reason: "too_long" }],
    });
    for (const field of ["region", "city", "line2"]) {
      expect(validateAddress({ ...base, [field]: "a".repeat(201) })).toEqual({
        ok: false,
        errors: [{ field, reason: "too_long" }],
      });
    }
    expect(validateAddress({ ...base, postalCode: "1".repeat(20) })).toMatchObject({ ok: true });
    expect(validateAddress({ ...base, postalCode: "1".repeat(21) })).toEqual({
      ok: false,
      errors: [{ field: "postalCode", reason: "too_long" }],
    });
    expect(validateAddress({ ...base, recipientFirstName: "a".repeat(101) })).toEqual({
      ok: false,
      errors: [{ field: "recipientFirstName", reason: "too_long" }],
    });
  });

  it("refuses empty or blank text for a field that is sent", () => {
    for (const field of ["city", "line1", "region", "line2", "postalCode", "recipientLastName"]) {
      expect(
        validateAddress({ countryCode: "UA", city: "X", line1: "Y", [field]: "   " }),
        field,
      ).toEqual({ ok: false, errors: [{ field, reason: "empty" }] });
    }
  });

  it("refuses control characters, NUL and lone surrogates, and other types", () => {
    const base = { countryCode: "UA", city: "X", line1: "Y" };
    for (const text of ["a\u0000b", "a\nb", "a\tb", "a\ud800b"]) {
      expect(validateAddress({ ...base, line2: text }), JSON.stringify(text)).toEqual({
        ok: false,
        errors: [{ field: "line2", reason: "invalid_characters" }],
      });
    }
    expect(validateAddress({ ...base, city: 5 })).toEqual({
      ok: false,
      errors: [{ field: "city", reason: "not_a_string" }],
    });
    expect(validateAddress({ ...base, region: {} })).toEqual({
      ok: false,
      errors: [{ field: "region", reason: "not_a_string" }],
    });
  });

  it("validates the recipient phone with the phone rules and names the reason", () => {
    const base = { countryCode: "UA", city: "X", line1: "Y" };
    expect(validateAddress({ ...base, recipientPhone: "123" })).toEqual({
      ok: false,
      errors: [{ field: "recipientPhone", reason: "too_short" }],
    });
    expect(validateAddress({ ...base, recipientPhone: "call me" })).toEqual({
      ok: false,
      errors: [{ field: "recipientPhone", reason: "invalid_format" }],
    });
  });

  it("refuses fields it does not know, so nothing unexpected is stored", () => {
    expect(
      validateAddress({ countryCode: "UA", city: "X", line1: "Y", isDefault: true, __proto__x: 1 }),
    ).toEqual({
      ok: false,
      errors: [
        { field: "isDefault", reason: "unknown_field" },
        { field: "__proto__x", reason: "unknown_field" },
      ],
    });
    const parsed = JSON.parse(
      '{"countryCode":"UA","city":"X","line1":"Y","__proto__":{"admin":true}}',
    );
    expect(validateAddress(parsed)).toEqual({
      ok: false,
      errors: [{ field: "__proto__", reason: "unknown_field" }],
    });
  });

  it("reports every error, in the order of the address fields", () => {
    expect(
      validateAddress({ countryCode: "x", city: "", line1: 3, postalCode: "1".repeat(30) }),
    ).toEqual({
      ok: false,
      errors: [
        { field: "countryCode", reason: "invalid_format" },
        { field: "city", reason: "empty" },
        { field: "postalCode", reason: "too_long" },
        { field: "line1", reason: "not_a_string" },
      ],
    });
  });

  it("refuses input that is not a plain object", () => {
    for (const input of [undefined, null, "UA", 5, [], [{ countryCode: "UA" }]]) {
      expect(validateAddress(input), JSON.stringify(input)).toEqual({
        ok: false,
        errors: [{ field: "", reason: "not_an_object" }],
      });
    }
  });

  it("does not mutate its input and returns a frozen address", () => {
    const input = deepFreeze({ ...full });
    const result = validateAddress(input);
    expect(input).toEqual(full);
    if (!result.ok) throw new Error("expected ok");
    expect(Object.isFrozen(result.address)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns a frozen error list", () => {
    const result = validateAddress({});
    if (result.ok) throw new Error("expected errors");
    expect(Object.isFrozen(result.errors)).toBe(true);
    for (const error of result.errors) {
      expect(Object.isFrozen(error)).toBe(true);
    }
  });
});

describe("shippingAddressRequired", () => {
  it("is true when any line needs shipping", () => {
    expect(shippingAddressRequired([{ requiresShipping: false }, { requiresShipping: true }])).toBe(
      true,
    );
    expect(shippingAddressRequired([{ requiresShipping: true }])).toBe(true);
  });

  it("is false for digital goods only, and for no lines", () => {
    expect(
      shippingAddressRequired([{ requiresShipping: false }, { requiresShipping: false }]),
    ).toBe(false);
    expect(shippingAddressRequired([])).toBe(false);
  });

  it("treats a flag that is not a boolean as a bug (RangeError), never as false", () => {
    expect(() =>
      shippingAddressRequired([{ requiresShipping: undefined as unknown as boolean }]),
    ).toThrow(RangeError);
    expect(() =>
      shippingAddressRequired([
        { requiresShipping: false },
        { requiresShipping: 1 as unknown as boolean },
      ]),
    ).toThrow(RangeError);
    expect(() => shippingAddressRequired(null as unknown as [])).toThrow(RangeError);
  });
});
