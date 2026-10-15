import { describe, expect, it } from "vitest";
import { loadEnv, parseEnabledFeatures } from "./index.js";

describe("parseEnabledFeatures", () => {
  it("returns an empty list for unset or blank input", () => {
    expect(parseEnabledFeatures(undefined)).toEqual([]);
    expect(parseEnabledFeatures("  ")).toEqual([]);
  });

  it("trims, lowercases and de-duplicates names", () => {
    expect(parseEnabledFeatures(" Example, wishlist ,example")).toEqual(["example", "wishlist"]);
  });

  it("rejects invalid feature names loudly", () => {
    expect(() => parseEnabledFeatures("ok,Bad Name!")).toThrow(/Invalid feature name/);
  });
});

describe("loadEnv", () => {
  it("applies defaults and parses features", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://x", FEATURES_ENABLED: "example" });
    expect(env.port).toBe(3000);
    expect(env.enabledFeatures).toEqual(["example"]);
    expect(env.redisUrl).toBeUndefined();
  });

  it("fails with a readable message when DATABASE_URL is missing", () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment: DATABASE_URL/);
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadEnv({ DATABASE_URL: "x", PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("loadEnv locales", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to uk with locales uk and en", () => {
    const env = loadEnv(base);
    expect(env.defaultLocale).toBe("uk");
    expect(env.locales).toEqual(["uk", "en"]);
  });

  it("parses a custom list, trimming spaces", () => {
    const env = loadEnv({ ...base, DEFAULT_LOCALE: "en", LOCALES: "en, uk ,pl" });
    expect(env.defaultLocale).toBe("en");
    expect(env.locales).toEqual(["en", "uk", "pl"]);
  });

  it("accepts region segments", () => {
    const env = loadEnv({ ...base, DEFAULT_LOCALE: "en-us", LOCALES: "en-us,uk" });
    expect(env.locales).toEqual(["en-us", "uk"]);
  });

  it("rejects a default locale missing from the list", () => {
    expect(() => loadEnv({ ...base, DEFAULT_LOCALE: "de" })).toThrow(/DEFAULT_LOCALE/);
  });

  it("rejects duplicates", () => {
    expect(() => loadEnv({ ...base, LOCALES: "uk,en,uk" })).toThrow(/duplicate/i);
  });

  it.each(["UK,en", "u,en", "uk,e n", "uk,,en", "uk,en_US", "uk,-en", "uk,en-", "abcdefghi,uk"])(
    "rejects invalid locale list %j",
    (locales) => {
      expect(() => loadEnv({ ...base, LOCALES: locales })).toThrow(/LOCALES/);
    },
  );

  it("rejects an invalid default locale code", () => {
    expect(() => loadEnv({ ...base, DEFAULT_LOCALE: "UK" })).toThrow(/DEFAULT_LOCALE/);
  });

  it("rejects an empty LOCALES value", () => {
    expect(() => loadEnv({ ...base, LOCALES: "" })).toThrow(/LOCALES/);
  });
});
