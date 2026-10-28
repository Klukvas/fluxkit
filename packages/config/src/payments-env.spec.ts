import { describe, expect, it } from "vitest";
import {
  loadEnv,
  MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER,
  parsePaymentProvidersVariable,
  TEST_ONLY_PAYMENT_PROVIDERS,
} from "./index.js";

const base = { DATABASE_URL: "postgres://x" };
const production = {
  ...base,
  NODE_ENV: "production",
  MEDIA_STORAGE_DRIVER: "none",
  ORDER_TOKEN_SECRET: "p".repeat(40),
};

function messageOf(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("loadEnv did not throw");
}

describe("parsePaymentProvidersVariable", () => {
  it.each([undefined, "", "   ", "\t"])("%j means no online payment", (raw) => {
    expect(parsePaymentProvidersVariable(raw)).toEqual({ ok: true, codes: [] });
  });

  it("reads codes in the order written, ignoring spaces around an entry", () => {
    expect(parsePaymentProvidersVariable("monobank")).toEqual({ ok: true, codes: ["monobank"] });
    expect(parsePaymentProvidersVariable(" fake ,monobank ")).toEqual({
      ok: true,
      codes: ["fake", "monobank"],
    });
    const longest = `a${"b".repeat(63)}`;
    expect(parsePaymentProvidersVariable(longest)).toEqual({ ok: true, codes: [longest] });
  });

  it.each([
    ["an empty entry", "fake,,monobank"],
    ["a trailing comma", "fake,"],
    ["a leading comma", ",fake"],
    ["only commas", ","],
  ])("refuses %s", (_label, raw) => {
    const result = parsePaymentProvidersVariable(raw);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.problem).toMatch(/without an empty entry/);
  });

  it.each([
    "Fake",
    "MONOBANK",
    "mono-bank",
    "1fake",
    "_fake",
    "fa ke",
    "fake!",
    "a".repeat(65),
    "кур'єр",
    "fake;monobank",
  ])("refuses the malformed or inexact code %j", (raw) => {
    const result = parsePaymentProvidersVariable(`monobank,${raw}`);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.problem).toMatch(/each entry must be a provider code/);
  });

  it("refuses a code listed twice", () => {
    const result = parsePaymentProvidersVariable("fake,monobank,fake");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.problem).toMatch(/twice/);
  });

  it("never puts an entry into its problem", () => {
    for (const raw of ["Secret-Token-0123", "fake,fake", "a,,b"]) {
      const result = parsePaymentProvidersVariable(raw);
      expect(result.ok ? "" : result.problem).not.toMatch(/Secret|fake|0123/);
    }
  });
});

describe("PAYMENT_PROVIDERS_ENABLED in loadEnv", () => {
  it("defaults to no provider, for unset and blank", () => {
    expect(loadEnv(base).enabledPaymentProviders).toEqual([]);
    expect(loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "" }).enabledPaymentProviders).toEqual([]);
    expect(loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "  " }).enabledPaymentProviders).toEqual(
      [],
    );
  });

  it("accepts fake, monobank (syntactically; its plugin arrives later) and both", () => {
    expect(loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "fake" }).enabledPaymentProviders).toEqual(
      ["fake"],
    );
    expect(
      loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "monobank" }).enabledPaymentProviders,
    ).toEqual(["monobank"]);
    expect(
      loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "monobank, fake" }).enabledPaymentProviders,
    ).toEqual(["monobank", "fake"]);
  });

  it("names the variable and the rule, never the value", () => {
    for (const value of ["Mono-Secret-0123456789", "fake,,x", "fake,fake"]) {
      const message = messageOf({ ...base, PAYMENT_PROVIDERS_ENABLED: value });
      expect(message).toMatch(/^Invalid environment: PAYMENT_PROVIDERS_ENABLED: /);
      expect(message).not.toContain(value);
      expect(message).not.toContain("Secret");
    }
  });

  it("lists fake as the only test-only provider", () => {
    expect([...TEST_ONLY_PAYMENT_PROVIDERS]).toEqual(["fake"]);
  });

  it.each(["production", "Production", " PRODUCTION "])(
    "refuses the test-only fake provider when NODE_ENV is %j",
    (nodeEnv) => {
      const message = messageOf({
        ...production,
        NODE_ENV: nodeEnv,
        PAYMENT_PROVIDERS_ENABLED: "monobank,fake",
        STOREFRONT_PUBLIC_URL: "https://shop.example",
      });
      expect(message).toMatch(/PAYMENT_PROVIDERS_ENABLED: "fake" is a test-only provider/);
    },
  );

  it("accepts monobank in production and fake outside it", () => {
    expect(
      loadEnv({
        ...production,
        PAYMENT_PROVIDERS_ENABLED: "monobank",
        STOREFRONT_PUBLIC_URL: "https://shop.example",
      }).enabledPaymentProviders,
    ).toEqual(["monobank"]);
    expect(
      loadEnv({ ...base, NODE_ENV: "test", PAYMENT_PROVIDERS_ENABLED: "fake" })
        .enabledPaymentProviders,
    ).toEqual(["fake"]);
  });

  it("needs nothing else in production when no provider is enabled", () => {
    const env = loadEnv({ ...production, PAYMENT_PROVIDERS_ENABLED: "" });
    expect(env.enabledPaymentProviders).toEqual([]);
    expect(env.storefrontPublicUrl).toBeUndefined();
  });
});

describe("ORDER_PAYMENT_TTL_MINUTES with a payment provider", () => {
  it("is 8 minutes at least: the invoice ends 3 minutes early and needs 5 to pay", () => {
    expect(MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER).toBe(8);
  });

  it.each(["5", "6", "7"])("refuses %s with a provider enabled, naming both variables", (ttl) => {
    const message = messageOf({
      ...base,
      PAYMENT_PROVIDERS_ENABLED: "fake",
      ORDER_PAYMENT_TTL_MINUTES: ttl,
    });
    expect(message).toMatch(
      /ORDER_PAYMENT_TTL_MINUTES: must be at least 8 when PAYMENT_PROVIDERS_ENABLED names a provider/,
    );
  });

  it("accepts 8 and the default with a provider, and 5 with none", () => {
    expect(
      loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "fake", ORDER_PAYMENT_TTL_MINUTES: "8" })
        .orderPaymentTtlMinutes,
    ).toBe(8);
    expect(loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "fake" }).orderPaymentTtlMinutes).toBe(30);
    expect(loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: "5" }).orderPaymentTtlMinutes).toBe(5);
    expect(
      loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "  ", ORDER_PAYMENT_TTL_MINUTES: "5" })
        .orderPaymentTtlMinutes,
    ).toBe(5);
  });

  it("keeps the existing 5 minute floor of the variable itself", () => {
    expect(messageOf({ ...base, ORDER_PAYMENT_TTL_MINUTES: "4" })).toMatch(
      /ORDER_PAYMENT_TTL_MINUTES: must be at least 5/,
    );
  });
});

describe("STOREFRONT_PUBLIC_URL with a payment provider", () => {
  const withProvider = { ...production, PAYMENT_PROVIDERS_ENABLED: "monobank" };

  it("is required in production, and must be https", () => {
    expect(messageOf(withProvider)).toMatch(
      /STOREFRONT_PUBLIC_URL: is required when PAYMENT_PROVIDERS_ENABLED names a provider/,
    );
    const http = messageOf({ ...withProvider, STOREFRONT_PUBLIC_URL: "http://shop.example" });
    expect(http).toMatch(/STOREFRONT_PUBLIC_URL: must use https when PAYMENT_PROVIDERS_ENABLED/);
    expect(http).not.toContain("shop.example");
    expect(
      loadEnv({ ...withProvider, STOREFRONT_PUBLIC_URL: "https://shop.example" })
        .storefrontPublicUrl,
    ).toBe("https://shop.example");
  });

  it("outside production a provider works with the default and with http", () => {
    expect(loadEnv({ ...base, PAYMENT_PROVIDERS_ENABLED: "fake" }).storefrontPublicUrl).toBe(
      "http://localhost:3001",
    );
    expect(
      loadEnv({
        ...base,
        PAYMENT_PROVIDERS_ENABLED: "fake",
        STOREFRONT_PUBLIC_URL: "http://127.0.0.1:3101",
      }).storefrontPublicUrl,
    ).toBe("http://127.0.0.1:3101");
  });

  it("does not demand https from a production shop without a payment provider", () => {
    expect(
      loadEnv({ ...production, STOREFRONT_PUBLIC_URL: "http://shop.example" }).storefrontPublicUrl,
    ).toBe("http://shop.example");
  });
});

describe("every refusal at once, without a secret", () => {
  it("reports each variable and echoes no value", () => {
    const secret = "tok_secret-0123456789abcdef";
    const message = messageOf({
      DATABASE_URL: `postgres://user:${secret}@host/db`,
      NODE_ENV: "production",
      MEDIA_STORAGE_DRIVER: "none",
      ORDER_TOKEN_SECRET: secret,
      PAYMENT_PROVIDERS_ENABLED: `Mono-${secret}`,
    });
    expect(message).toMatch(/PAYMENT_PROVIDERS_ENABLED/);
    expect(message).not.toContain(secret);
    const production2 = messageOf({
      ...production,
      PAYMENT_PROVIDERS_ENABLED: "fake",
      ORDER_PAYMENT_TTL_MINUTES: "6",
      STOREFRONT_PUBLIC_URL: "http://shop.example",
    });
    expect(production2).toMatch(/"fake" is a test-only provider/);
    expect(production2).toMatch(/ORDER_PAYMENT_TTL_MINUTES: must be at least 8/);
    expect(production2).toMatch(/STOREFRONT_PUBLIC_URL: must use https/);
    expect(production2).not.toContain(secret);
  });
});
