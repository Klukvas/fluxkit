import { describe, expect, it } from "vitest";
import { parseBrevoEnv, readBrevoWebhookSecret } from "./config.js";

describe("Brevo configuration", () => {
  it("rejects API-key reuse as the webhook credential without disclosing either value", () => {
    const secret = "Invented_Shared_Credential_For_Unit_Tests_0123456789";
    expect(() =>
      readBrevoWebhookSecret({ BREVO_API_KEY: secret, BREVO_WEBHOOK_SECRET: secret }),
    ).toThrow("BREVO_WEBHOOK_SECRET must differ from BREVO_API_KEY (the values are not shown).");
    expect(
      readBrevoWebhookSecret({ BREVO_API_KEY: secret, BREVO_WEBHOOK_SECRET: " " }),
    ).toBeUndefined();
    expect(
      readBrevoWebhookSecret({ BREVO_API_KEY: "different", BREVO_WEBHOOK_SECRET: secret }),
    ).toBe(secret);
  });
  it("accepts bounded header-safe keys without inventing a prefix", () => {
    for (const key of ["x", "arbitrary-prefix_123", "X".repeat(1024)]) {
      expect(parseBrevoEnv({ BREVO_API_KEY: key })).toEqual({ apiKey: key });
    }
  });
  it("rejects missing, oversized, whitespace and control-bearing keys without leaking them", () => {
    for (const key of [
      undefined,
      "",
      " ",
      "x".repeat(1025),
      "x\r\nInjected:1",
      "x\0",
      "é",
      " key",
      "key ",
      "key\n",
    ]) {
      expect(() => parseBrevoEnv({ BREVO_API_KEY: key })).toThrow(/^BREVO_API_KEY /);
    }
    expect(() => parseBrevoEnv({ BREVO_API_KEY: "secret value" })).toThrow(
      "BREVO_API_KEY must contain 1 to 1024 visible ASCII characters without whitespace (the value is not shown).",
    );
  });
});
