import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocaleMismatchError,
  assertLocalesSupported,
  findUnsupportedLocales,
} from "./locale-check";

afterEach(() => vi.restoreAllMocks());

describe("findUnsupportedLocales", () => {
  it("returns the storefront locales the API does not offer", () => {
    expect(findUnsupportedLocales(["uk", "en"], ["uk", "en", "pl"])).toEqual([]);
    expect(findUnsupportedLocales(["uk", "en"], ["uk"])).toEqual(["en"]);
    expect(findUnsupportedLocales(["uk", "en"], [])).toEqual(["uk", "en"]);
  });

  it("compares exactly, not by prefix or case", () => {
    expect(findUnsupportedLocales(["en"], ["en-US"])).toEqual(["en"]);
    expect(findUnsupportedLocales(["uk"], ["UK"])).toEqual(["uk"]);
  });
});

describe("assertLocalesSupported", () => {
  it("passes silently when the API offers every storefront locale", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertLocalesSupported(["uk", "en"], { locales: ["en", "uk"] })).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it("logs and throws loudly when a locale is missing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertLocalesSupported(["uk", "en"], { locales: ["uk"] })).toThrow(
      LocaleMismatchError,
    );
    expect(error).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).toContain("en");
    expect(logged).toContain("LOCALES");
  });
});
