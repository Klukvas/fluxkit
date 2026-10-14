import { describe, expect, it } from "vitest";
import { createTranslator, defaultLocale, isLocale } from "./i18n";

describe("i18n", () => {
  it("translates known keys", () => {
    expect(createTranslator({ hello: "Привіт" })("hello")).toBe("Привіт");
  });

  it("throws on a missing key instead of rendering nothing", () => {
    expect(() => createTranslator({})("nope")).toThrow(/Missing translation key "nope"/);
  });

  it("recognizes supported locales", () => {
    expect(isLocale("uk")).toBe(true);
    expect(isLocale("ru")).toBe(false);
    expect(defaultLocale).toBe("uk");
  });
});
