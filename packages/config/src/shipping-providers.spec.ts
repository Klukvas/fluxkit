import { describe, expect, it } from "vitest";
import { loadEnv, parseEnabledShippingProviders } from "./index.js";

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
