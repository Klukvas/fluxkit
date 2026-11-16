import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { EMAIL_PROVIDER_METADATA } from "@fluxkit/core";
import { BrevoEmailProvider, providerModule } from "./index.js";

describe("Brevo module", () => {
  const saved = process.env.BREVO_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = saved;
  });
  it("boots without any network call and declares unverified idempotency unsupported", async () => {
    process.env.BREVO_API_KEY = "Invented_ModuleKey";
    const module = await Test.createTestingModule({ imports: [providerModule] }).compile();
    try {
      const provider = module.get(BrevoEmailProvider);
      expect(provider.code).toBe("brevo");
      expect(provider.capabilities).toEqual({ idempotencyKeys: false, maxRecipients: 1 });
      expect(Reflect.getMetadata(EMAIL_PROVIDER_METADATA, BrevoEmailProvider)).toEqual({
        code: "brevo",
      });
    } finally {
      await module.close();
    }
  });
  it("fails startup for a missing or unsafe key", async () => {
    for (const key of ["", "unsafe key"]) {
      process.env.BREVO_API_KEY = key;
      await expect(
        Test.createTestingModule({ imports: [providerModule] }).compile(),
      ).rejects.toThrow(/^BREVO_API_KEY /);
    }
  });
});
