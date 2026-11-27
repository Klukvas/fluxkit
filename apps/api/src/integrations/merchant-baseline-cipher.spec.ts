import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testSecretsKeyRing } from "../test/integration-provider-fixture.js";
import { DISABLED_INTEGRATIONS_CONFIG } from "./integrations.config.js";
import { MerchantBaselineCipher } from "./merchant-baseline-cipher.js";

const identity = {
  baselineId: randomUUID(),
  integrationId: randomUUID(),
  kind: "payment" as const,
  providerCode: "testpay",
  environment: "default",
};

describe("merchant baseline encryption", () => {
  const cipher = new MerchantBaselineCipher({
    ...DISABLED_INTEGRATIONS_CONFIG,
    keyRing: testSecretsKeyRing("baseline-test"),
  });
  it("authenticates the permanent baseline's own identity and never exposes plaintext in its envelope", () => {
    const sealed = cipher.seal(identity, "merchant-sentinel");
    expect(cipher.open(identity, sealed)).toBe("merchant-sentinel");
    expect(JSON.stringify(sealed)).not.toContain("merchant-sentinel");
    for (const changed of [
      { ...identity, baselineId: randomUUID() },
      { ...identity, integrationId: randomUUID() },
      { ...identity, environment: "production" },
      { ...identity, providerCode: "otherpay" },
    ])
      expect(() => cipher.open(changed, sealed)).toThrow(
        "integration_merchant_baseline_unavailable",
      );
  });
  it("bounds opaque identity by UTF-8 bytes and uses a fresh nonce", () => {
    expect(() => cipher.seal(identity, "")).toThrow();
    expect(() => cipher.seal(identity, "é".repeat(129))).toThrow();
    expect(cipher.seal(identity, "merchant").nonce).not.toEqual(
      cipher.seal(identity, "merchant").nonce,
    );
  });
});
