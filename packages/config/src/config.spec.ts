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
