import { describe, expect, it } from "vitest";
import { resolveText, validateI18nText } from "./i18n.js";
import { deepFreeze } from "./test-support.js";

const base = { defaultLocale: "uk", locales: ["uk", "en"], maxLength: 10, required: true } as const;

describe("validateI18nText", () => {
  it("accepts a map with the default locale", () => {
    expect(validateI18nText({ uk: "Футболка" }, base)).toEqual({ ok: true });
  });

  it("accepts several allowed locales", () => {
    expect(validateI18nText({ uk: "Футболка", en: "T-shirt" }, base)).toEqual({ ok: true });
  });

  it("rejects a missing value when required", () => {
    for (const value of [undefined, null, {}]) {
      expect(validateI18nText(value, base)).toEqual({
        ok: false,
        errors: [{ reason: "required" }],
      });
    }
  });

  it("rejects values that are not plain objects", () => {
    for (const value of ["text", 5, true, ["uk"]]) {
      expect(validateI18nText(value, base)).toEqual({
        ok: false,
        errors: [{ reason: "not_an_object" }],
      });
    }
  });

  it("requires the default locale", () => {
    expect(validateI18nText({ en: "T-shirt" }, base)).toEqual({
      ok: false,
      errors: [{ reason: "default_locale_missing", locale: "uk" }],
    });
  });

  it("treats a blank default locale as empty", () => {
    expect(validateI18nText({ uk: "   " }, base)).toEqual({
      ok: false,
      errors: [{ reason: "empty", locale: "uk" }],
    });
  });

  it("rejects an empty non-default locale instead of hiding the fallback", () => {
    expect(validateI18nText({ uk: "Так", en: "" }, base)).toEqual({
      ok: false,
      errors: [{ reason: "empty", locale: "en" }],
    });
  });

  it("rejects locales that are not configured", () => {
    expect(validateI18nText({ uk: "Так", de: "Ja" }, base)).toEqual({
      ok: false,
      errors: [{ reason: "locale_not_allowed", locale: "de" }],
    });
  });

  it("rejects non-string values per locale", () => {
    expect(validateI18nText({ uk: "Так", en: 5 }, base)).toEqual({
      ok: false,
      errors: [{ reason: "not_a_string", locale: "en" }],
    });
  });

  it("enforces the maximum length per locale, counted in code points", () => {
    expect(validateI18nText({ uk: "1234567890" }, base)).toEqual({ ok: true });
    expect(validateI18nText({ uk: "12345678901", en: "ok" }, base)).toEqual({
      ok: false,
      errors: [{ reason: "too_long", locale: "uk", limit: 10 }],
    });
    // 6 emoji are 12 UTF-16 units but 6 code points.
    expect(validateI18nText({ uk: "😀😀😀😀😀😀" }, base)).toEqual({ ok: true });
  });

  it("enforces an optional minimum length per locale", () => {
    expect(validateI18nText({ uk: "ab" }, { ...base, minLength: 3 })).toEqual({
      ok: false,
      errors: [{ reason: "too_short", locale: "uk", limit: 3 }],
    });
  });

  it("returns every error at once", () => {
    const result = validateI18nText({ de: "x", en: "12345678901" }, base);
    expect(result).toEqual({
      ok: false,
      errors: [
        { reason: "locale_not_allowed", locale: "de" },
        { reason: "too_long", locale: "en", limit: 10 },
        { reason: "default_locale_missing", locale: "uk" },
      ],
    });
  });

  describe("optional text", () => {
    const optional = { ...base, required: false };

    it("accepts absent and empty values", () => {
      for (const value of [undefined, null, {}]) {
        expect(validateI18nText(value, optional)).toEqual({ ok: true });
      }
    });

    it("still requires the default locale when anything is given", () => {
      expect(validateI18nText({ en: "x" }, optional)).toEqual({
        ok: false,
        errors: [{ reason: "default_locale_missing", locale: "uk" }],
      });
    });
  });

  it("does not mutate frozen input and is deterministic", () => {
    const input = deepFreeze({ uk: "Так", en: "Yes" });
    const first = validateI18nText(input, base);
    const second = validateI18nText(input, base);
    expect(first).toEqual(second);
    expect(input).toEqual({ uk: "Так", en: "Yes" });
  });
});

describe("resolveText", () => {
  const map = deepFreeze({ uk: "Футболка", en: "T-shirt" });

  it("returns the requested locale", () => {
    expect(resolveText(map, "en", "uk")).toBe("T-shirt");
  });

  it("falls back to the default locale per field", () => {
    expect(resolveText({ uk: "Футболка" }, "en", "uk")).toBe("Футболка");
  });

  it("returns undefined when neither locale exists or the map is missing", () => {
    expect(resolveText({ en: "T-shirt" }, "de", "uk")).toBeUndefined();
    expect(resolveText(null, "uk", "uk")).toBeUndefined();
    expect(resolveText(undefined, "uk", "uk")).toBeUndefined();
  });

  it("returns the default locale when it is the requested one", () => {
    expect(resolveText(map, "uk", "uk")).toBe("Футболка");
  });
});
