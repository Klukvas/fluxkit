import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { EMAIL_PROVIDER_METADATA } from "@fluxkit/core";
import { BrevoEmailProvider, providerModule } from "./index.js";

describe("Brevo module", () => {
  const saved = process.env.BREVO_API_KEY;
  const savedWebhook = process.env.BREVO_WEBHOOK_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = saved;
    if (savedWebhook === undefined) delete process.env.BREVO_WEBHOOK_SECRET;
    else process.env.BREVO_WEBHOOK_SECRET = savedWebhook;
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
  it("enables authenticated ingestion only with its dedicated valid webhook secret", async () => {
    process.env.BREVO_API_KEY = "Invented_ModuleKey";
    delete process.env.BREVO_WEBHOOK_SECRET;
    const disabled = await Test.createTestingModule({ imports: [providerModule] }).compile();
    expect(disabled.get(BrevoEmailProvider).webhookVerifier).toBeUndefined();
    await disabled.close();
    process.env.BREVO_WEBHOOK_SECRET = "Invented_Webhook_Token_For_Unit_Tests_0123456789";
    const enabled = await Test.createTestingModule({ imports: [providerModule] }).compile();
    expect(enabled.get(BrevoEmailProvider).webhookVerifier).toBeTypeOf("function");
    await enabled.close();
    process.env.BREVO_WEBHOOK_SECRET = "invalid";
    await expect(Test.createTestingModule({ imports: [providerModule] }).compile()).rejects.toThrow(
      /^BREVO_WEBHOOK_SECRET /,
    );
  });
});
