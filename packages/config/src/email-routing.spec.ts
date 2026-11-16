import { describe, expect, it } from "vitest";
import { loadEnv, parseEmailFallbackProviders, parseEmailUsageLimits } from "./index.js";

const base = {
  DATABASE_URL: "postgres://x",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "shop@example.test",
};

function errorOf(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected invalid environment");
}

describe("ordered email fallback configuration", () => {
  it("keeps defaults/off and normalizes an ordered nonempty list", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://x" }).emailFallbackProviders).toEqual([]);
    expect(loadEnv({ ...base, EMAIL_FALLBACK_PROVIDERS: " \t " }).emailFallbackProviders).toEqual(
      [],
    );
    expect(
      loadEnv({ ...base, EMAIL_FALLBACK_PROVIDERS: " BrEvO , FaKe " }).emailFallbackProviders,
    ).toEqual(["brevo", "fake"]);
  });

  it.each([
    "none",
    "brevo,,fake",
    ",brevo",
    "brevo,",
    "resend",
    "brevo,BREVO",
    "smtp",
    "secret-value",
  ])("refuses invalid list %j without echoing it", (raw) => {
    const error = errorOf({ ...base, EMAIL_FALLBACK_PROVIDERS: raw });
    expect(error).toContain("EMAIL_FALLBACK_PROVIDERS");
    if (raw !== "none") expect(error).not.toContain(raw);
  });

  it("requires a primary and rejects production fake in every chain position", () => {
    expect(parseEmailFallbackProviders("brevo", "none").ok).toBe(false);
    const production = {
      ...base,
      NODE_ENV: "production",
      MEDIA_STORAGE_DRIVER: "none",
      ORDER_TOKEN_SECRET: "x".repeat(40),
      STOREFRONT_PUBLIC_URL: "https://shop.example",
    };
    expect(
      errorOf({ ...production, EMAIL_PROVIDER: "fake", EMAIL_FALLBACK_PROVIDERS: "resend" }),
    ).toMatch(/EMAIL_PROVIDER.*test-only/);
    expect(errorOf({ ...production, EMAIL_FALLBACK_PROVIDERS: "fake,brevo" })).toMatch(
      /EMAIL_FALLBACK_PROVIDERS.*test-only/,
    );
    expect(errorOf({ ...production, EMAIL_FALLBACK_PROVIDERS: "brevo,fake" })).toMatch(
      /EMAIL_FALLBACK_PROVIDERS.*test-only/,
    );
  });
});

describe("EMAIL_USAGE_LIMITS", () => {
  it("defaults unset/blank to no overrides and preserves explicit null caps", () => {
    expect(loadEnv(base).emailUsageLimits).toEqual({});
    expect(parseEmailUsageLimits(" \t ")).toEqual({ ok: true, value: {} });
    const raw = '{"resend":{"daily":100,"monthly":null},"brevo":{"daily":300,"monthly":null}}';
    expect(loadEnv({ ...base, EMAIL_USAGE_LIMITS: raw }).emailUsageLimits).toEqual({
      resend: { daily: 100, monthly: null },
      brevo: { daily: 300, monthly: null },
    });
  });

  it.each([
    "secret-not-json",
    "null",
    "[]",
    "4",
    '"secret"',
    '{"unknown-secret":{"daily":1,"monthly":1}}',
    '{"none":{"daily":1,"monthly":1}}',
    '{"resend":{"daily":1,"monthly":1,"secret":2}}',
    '{"resend":{"daily":1}}',
    '{"resend":{"daily":0,"monthly":1}}',
    '{"resend":{"daily":-1,"monthly":1}}',
    '{"resend":{"daily":1.5,"monthly":1}}',
    '{"resend":{"daily":9007199254740992,"monthly":1}}',
    '{"resend":{"daily":"1","monthly":1}}',
    '{"resend":null}',
    '{"resend":{"daily":100,"monthly":1000,"secret":"never-echo"}}',
    '{"resend":{"daily":100}}',
    '{"resend":{"daily":1,"daily":2,"monthly":3}}',
    '{"resend":{"daily":1,"monthly":2},"resend":{"daily":3,"monthly":4}}',
    '{"resend":{"daily":1e999,"monthly":1}}',
    " ".repeat(8193) + "{}",
  ])("refuses malformed or unsafe limits without JSON/parser/value leakage", (raw) => {
    const error = errorOf({ ...base, EMAIL_USAGE_LIMITS: raw });
    expect(error).toMatch(/EMAIL_USAGE_LIMITS: must be a bounded JSON object/);
    expect(error).not.toContain("secret");
    if (raw !== "null") expect(error).not.toContain(raw);
  });
});
