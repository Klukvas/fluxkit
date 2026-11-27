import { describe, expect, it } from "vitest";
import {
  checkIntegrationSecretValue,
  INTEGRATION_SECRET_MAX_BYTES,
  integrationSecretAad,
  integrationMerchantBaselineAad,
  type IntegrationMerchantBaselineIdentity,
  parseIntegrationSecretDeclarations,
  parseIntegrationEnvironments,
  type IntegrationSecretIdentity,
} from "./secrets.js";

const IDENTITY: IntegrationSecretIdentity = {
  secretId: "11111111-1111-4111-8111-111111111111",
  integrationId: "22222222-2222-4222-8222-222222222222",
  kind: "email",
  providerCode: "resend",
  field: "api_key",
  generation: 1,
  keyId: "k1",
};

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("integrationSecretAad", () => {
  it("starts with the length-prefixed versioned label", () => {
    const aad = integrationSecretAad(IDENTITY);
    const label = "fluxkit.integration-secret/v1";
    expect(new DataView(aad.buffer).getUint32(0, false)).toBe(label.length);
    expect(String.fromCharCode(...aad.subarray(4, 4 + label.length))).toBe(label);
  });

  it.each([
    ["secretId", { secretId: "33333333-3333-4333-8333-333333333333" }],
    ["integrationId", { integrationId: "33333333-3333-4333-8333-333333333333" }],
    ["kind", { kind: "payment" as const }],
    ["providerCode", { providerCode: "brevo" }],
    ["field", { field: "webhook_secret" }],
    ["generation", { generation: 2 }],
    ["keyId", { keyId: "k2" }],
  ])("changes when %s changes", (_name, change) => {
    expect(hex(integrationSecretAad({ ...IDENTITY, ...change }))).not.toBe(
      hex(integrationSecretAad(IDENTITY)),
    );
  });

  it("does not let neighbouring parts trade characters", () => {
    const left = integrationSecretAad({ ...IDENTITY, providerCode: "ab", field: "c" });
    const right = integrationSecretAad({ ...IDENTITY, providerCode: "a", field: "bc" });
    expect(hex(left)).not.toBe(hex(right));
  });

  it("refuses an identity that is not ASCII", () => {
    expect(() => integrationSecretAad({ ...IDENTITY, providerCode: "пошта" })).toThrow(/ASCII/);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses the generation %s", (generation) => {
    expect(() => integrationSecretAad({ ...IDENTITY, generation })).toThrow(/generation/);
  });
});

describe("parseIntegrationSecretDeclarations", () => {
  it("treats an absent list as no managed secret", () => {
    expect(parseIntegrationSecretDeclarations(undefined)).toEqual({ ok: true, fields: [] });
  });

  it("reads field, purpose and variable", () => {
    expect(
      parseIntegrationSecretDeclarations([
        { field: "api_key", purpose: "outbound", env: "RESEND_API_KEY" },
        { field: "webhook_secret", purpose: "webhook", env: "RESEND_WEBHOOK_SECRET" },
      ]),
    ).toEqual({
      ok: true,
      fields: [
        { field: "api_key", purpose: "outbound", envVariable: "RESEND_API_KEY" },
        { field: "webhook_secret", purpose: "webhook", envVariable: "RESEND_WEBHOOK_SECRET" },
      ],
    });
  });

  it("accepts several fields in one purpose", () => {
    expect(
      parseIntegrationSecretDeclarations([
        { field: "public_key", purpose: "outbound", env: "LIQPAY_PUBLIC_KEY" },
        { field: "private_key", purpose: "outbound", env: "LIQPAY_PRIVATE_KEY" },
      ]),
    ).toEqual({
      ok: true,
      fields: [
        { field: "public_key", purpose: "outbound", envVariable: "LIQPAY_PUBLIC_KEY" },
        { field: "private_key", purpose: "outbound", envVariable: "LIQPAY_PRIVATE_KEY" },
      ],
    });
  });

  it.each([
    ["not an array", { field: "a" }],
    ["a non-object entry", ["api_key"]],
    ["a bad field name", [{ field: "API", purpose: "outbound", env: "X" }]],
    ["an unknown purpose", [{ field: "a", purpose: "inbound", env: "X" }]],
    ["a lower case variable", [{ field: "a", purpose: "outbound", env: "x" }]],
    [
      "a repeated field",
      [
        { field: "a", purpose: "outbound", env: "X" },
        { field: "a", purpose: "webhook", env: "Y" },
      ],
    ],
    [
      "a repeated variable",
      [
        { field: "a", purpose: "outbound", env: "X" },
        { field: "b", purpose: "webhook", env: "X" },
      ],
    ],
    ["too many entries", Array.from({ length: 9 }, () => ({}))],
  ])("refuses %s", (_name, raw) => {
    expect(parseIntegrationSecretDeclarations(raw).ok).toBe(false);
  });
});

describe("checkIntegrationSecretValue", () => {
  it("accepts printable ASCII without spaces", () => {
    expect(checkIntegrationSecretValue("re_AbC-123_xyz~!")).toBeNull();
  });

  it.each([
    ["", "required"],
    ["a".repeat(INTEGRATION_SECRET_MAX_BYTES + 1), "too_long"],
    ["has space", "invalid_characters"],
    ["line\nbreak", "invalid_characters"],
    ["ключ", "invalid_characters"],
  ])("refuses %j as %s", (value, problem) => {
    expect(checkIntegrationSecretValue(value)).toBe(problem);
  });
});

describe("parseIntegrationEnvironments", () => {
  it("uses a fixed default when absent", () => {
    expect(parseIntegrationEnvironments(undefined, "demo")).toEqual({
      ok: true,
      environments: undefined,
    });
  });
  it("reads distinct codes, a member default and an own-prefix selector", () => {
    expect(
      parseIntegrationEnvironments(
        { values: ["sandbox", "production"], default: "sandbox", env: "DEMO_ENVIRONMENT" },
        "demo",
      ),
    ).toEqual({
      ok: true,
      environments: {
        values: ["sandbox", "production"],
        default: "sandbox",
        envVariable: "DEMO_ENVIRONMENT",
      },
    });
  });
  it.each([
    null,
    {},
    { values: [], default: "default", env: "DEMO_ENV" },
    { values: ["sandbox", "sandbox"], default: "sandbox", env: "DEMO_ENV" },
    { values: ["Sandbox"], default: "Sandbox", env: "DEMO_ENV" },
    { values: ["sandbox"], default: "production", env: "DEMO_ENV" },
    { values: ["sandbox"], default: "sandbox", env: "OTHER_ENV" },
    {
      values: Array.from({ length: 9 }, (_, n) => `env${String(n)}`),
      default: "env0",
      env: "DEMO_ENV",
    },
  ])("refuses an invalid environment declaration %j", (raw) => {
    expect(parseIntegrationEnvironments(raw, "demo").ok).toBe(false);
  });
});

describe("integrationMerchantBaselineAad", () => {
  const identity: IntegrationMerchantBaselineIdentity = {
    baselineId: "11111111-1111-4111-8111-111111111111",
    integrationId: "22222222-2222-4222-8222-222222222222",
    kind: "payment",
    providerCode: "monobank",
    environment: "default",
    keyId: "k1",
  };
  it("uses its own length-prefixed v1 domain and complete identity", () => {
    const aad = integrationMerchantBaselineAad(identity);
    const parts: string[] = [];
    for (let offset = 0; offset < aad.length;) {
      const length = new DataView(aad.buffer).getUint32(offset, false);
      parts.push(String.fromCharCode(...aad.subarray(offset + 4, offset + 4 + length)));
      offset += 4 + length;
    }
    expect(parts).toEqual([
      "fluxkit.integration-merchant-baseline/v1",
      identity.baselineId,
      identity.integrationId,
      "payment",
      "monobank",
      "default",
      "k1",
    ]);
  });
  it.each([
    { baselineId: "other" },
    { integrationId: "other" },
    { kind: "shipping" as const },
    { providerCode: "other" },
    { environment: "sandbox" },
    { keyId: "k2" },
  ])("binds every identity component %j", (change) => {
    expect(hex(integrationMerchantBaselineAad({ ...identity, ...change }))).not.toBe(
      hex(integrationMerchantBaselineAad(identity)),
    );
  });
  it("separates adjacent components and rejects non-ASCII identity", () => {
    expect(
      hex(integrationMerchantBaselineAad({ ...identity, providerCode: "ab", environment: "c" })),
    ).not.toBe(
      hex(integrationMerchantBaselineAad({ ...identity, providerCode: "a", environment: "bc" })),
    );
    expect(() => integrationMerchantBaselineAad({ ...identity, environment: "місто" })).toThrow(
      /ASCII/,
    );
  });
});
