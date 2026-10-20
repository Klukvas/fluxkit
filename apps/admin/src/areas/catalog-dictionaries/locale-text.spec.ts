import { describe, expect, it } from "vitest";
import {
  hasDefaultLocale,
  localeFieldNames,
  localeMapFromValues,
  localeValuesFrom,
  optionalLocaleMap,
  resolveLocalized,
} from "./locale-text";

const locales = ["uk", "en"];

describe("localeValuesFrom", () => {
  it("gives every configured locale a string, empty when the map has none", () => {
    expect(localeValuesFrom({ uk: "Колір" }, locales)).toEqual({ uk: "Колір", en: "" });
    expect(localeValuesFrom(null, locales)).toEqual({ uk: "", en: "" });
    expect(localeValuesFrom(undefined, locales)).toEqual({ uk: "", en: "" });
  });

  it("leaves out a stored locale that is not configured (the API would refuse it)", () => {
    expect(localeValuesFrom({ uk: "a", de: "b" }, locales)).toEqual({ uk: "a", en: "" });
  });
});

describe("localeMapFromValues", () => {
  it("omits an empty or blank optional locale and trims the rest", () => {
    expect(localeMapFromValues({ uk: "  Колір ", en: "   " }, locales)).toEqual({ uk: "Колір" });
    expect(localeMapFromValues({ uk: "", en: "Color" }, locales)).toEqual({ en: "Color" });
  });

  it("ignores values of locales that are not configured", () => {
    expect(localeMapFromValues({ uk: "a", de: "b" }, locales)).toEqual({ uk: "a" });
  });
});

describe("optionalLocaleMap", () => {
  it("is undefined when every locale is empty, so a create body leaves the field out", () => {
    expect(optionalLocaleMap({ uk: "", en: " " }, locales)).toBeUndefined();
    expect(optionalLocaleMap({ uk: "a", en: "" }, locales)).toEqual({ uk: "a" });
  });
});

describe("hasDefaultLocale", () => {
  it("requires non-blank text in the default locale", () => {
    expect(hasDefaultLocale({ uk: "a", en: "" }, "uk")).toBe(true);
    expect(hasDefaultLocale({ uk: "  ", en: "b" }, "uk")).toBe(false);
    expect(hasDefaultLocale({ en: "b" }, "uk")).toBe(false);
  });
});

describe("localeFieldNames", () => {
  it("names each locale's field like the API's error path", () => {
    expect(localeFieldNames("name", locales)).toEqual(["name.uk", "name.en"]);
  });
});

describe("resolveLocalized", () => {
  it("prefers the requested locale, then the default, then the first non-empty one", () => {
    expect(resolveLocalized({ uk: "a", en: "b" }, "en", "uk")).toBe("b");
    expect(resolveLocalized({ uk: "a" }, "en", "uk")).toBe("a");
    expect(resolveLocalized({ fr: "y", de: "z" }, "en", "uk")).toBe("z");
    expect(resolveLocalized({ uk: "", en: "b" }, "uk", "uk")).toBe("b");
    expect(resolveLocalized(null, "en", "uk")).toBe("");
    expect(resolveLocalized({}, "en", "uk")).toBe("");
  });
});
