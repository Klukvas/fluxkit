import { describe, expect, it } from "vitest";
import {
  checkIntegrationSecretValue,
  INTEGRATION_SECRET_MAX_BYTES,
  integrationSecretAad,
  parseIntegrationSecretDeclarations,
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
      "a repeated purpose",
      [
        { field: "a", purpose: "outbound", env: "X" },
        { field: "b", purpose: "outbound", env: "Y" },
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
