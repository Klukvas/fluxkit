import { describe, expect, it } from "vitest";
import { loadEnv, parseEnabledShippingProviders, TEST_ONLY_SHIPPING_PROVIDERS } from "./index.js";

describe("parseEnabledShippingProviders", () => {
  it("returns an empty list for unset, empty or blank input", () => {
    expect(parseEnabledShippingProviders(undefined)).toEqual([]);
    expect(parseEnabledShippingProviders("")).toEqual([]);
    expect(parseEnabledShippingProviders("  ")).toEqual([]);
    expect(parseEnabledShippingProviders(" , ,")).toEqual([]);
  });

  it("trims, lowercases and de-duplicates codes, keeping the first-seen order", () => {
    expect(parseEnabledShippingProviders(" Fake, nova_poshta ,fake")).toEqual([
      "fake",
      "nova_poshta",
    ]);
  });

  it.each(["nova-poshta", "1fake", "_fake", "fa ke", "fake!", "a".repeat(65), "кур'єр"])(
    "rejects the malformed code %s loudly, naming the variable",
    (code) => {
      expect(() => parseEnabledShippingProviders(`fake,${code}`)).toThrow(
        /SHIPPING_PROVIDERS_ENABLED/,
      );
    },
  );

  it("accepts the longest code (64 characters)", () => {
    const code = `a${"b".repeat(63)}`;
    expect(parseEnabledShippingProviders(code)).toEqual([code]);
  });
});

describe("loadEnv shipping providers", () => {
  it("defaults to no provider", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://x" }).enabledShippingProviders).toEqual([]);
  });

  it("parses SHIPPING_PROVIDERS_ENABLED", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://x", SHIPPING_PROVIDERS_ENABLED: "fake" });
    expect(env.enabledShippingProviders).toEqual(["fake"]);
  });

  it("fails startup on a malformed code", () => {
    expect(() =>
      loadEnv({ DATABASE_URL: "postgres://x", SHIPPING_PROVIDERS_ENABLED: "Nova-Poshta" }),
    ).toThrow(/Invalid shipping provider code "nova-poshta"/);
  });
});

describe("the test-only fake provider in production (review m-5)", () => {
  const production = {
    DATABASE_URL: "postgres://x",
    NODE_ENV: "production",
    ORDER_TOKEN_SECRET: "s".repeat(32),
    MEDIA_STORAGE_DRIVER: "none",
  };

  it.each(["fake", "nova_poshta,fake", " FAKE "])(
    "refuses SHIPPING_PROVIDERS_ENABLED=%j when NODE_ENV is production, loudly and naming the variable",
    (value) => {
      expect(() => loadEnv({ ...production, SHIPPING_PROVIDERS_ENABLED: value })).toThrow(
        /SHIPPING_PROVIDERS_ENABLED: .*"fake" is a test-only provider/,
      );
    },
  );

  it("accepts it outside production and accepts other providers in production", () => {
    expect(
      loadEnv({ DATABASE_URL: "postgres://x", SHIPPING_PROVIDERS_ENABLED: "fake" })
        .enabledShippingProviders,
    ).toEqual(["fake"]);
    expect(
      loadEnv({ ...production, SHIPPING_PROVIDERS_ENABLED: "nova_poshta" })
        .enabledShippingProviders,
    ).toEqual(["nova_poshta"]);
    expect(TEST_ONLY_SHIPPING_PROVIDERS).toEqual(["fake"]);
  });
});
