import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { EMAIL_PROVIDER_METADATA } from "@fluxkit/core";
import { providerModule, ResendEmailProvider } from "./index.js";

const KEY = "re_ModuleSpec_0123456789abcdef";

function restore(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "RESEND_API_KEY");
  } else {
    process.env.RESEND_API_KEY = value;
  }
}

describe("the provider module (what the API's loader mounts)", () => {
  const saved = process.env.RESEND_API_KEY;
  const savedWebhook = process.env.RESEND_WEBHOOK_SECRET;

  afterEach(() => {
    restore(saved);
    if (savedWebhook === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = savedWebhook;
  });

  it("provides a marked resend provider and calls nothing at startup", async () => {
    process.env.RESEND_API_KEY = KEY;
    expect(Reflect.getMetadata(EMAIL_PROVIDER_METADATA, ResendEmailProvider)).toEqual({
      code: "resend",
    });
    const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
    const provider = moduleRef.get(ResendEmailProvider);
    expect(provider.code).toBe("resend");
    expect(provider.capabilities).toEqual({ idempotencyKeys: true, maxRecipients: 1 });
    // The no-network guard of this suite fails the file if anything was sent.
    await moduleRef.close();
  });

  it("refuses to start without a key or with a malformed one, naming the variable and never a value", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(Test.createTestingModule({ imports: [providerModule] }).compile()).rejects.toThrow(
      /RESEND_API_KEY is required when EMAIL_PROVIDER=resend/,
    );
    const malformed = "re_short";
    process.env.RESEND_API_KEY = malformed;
    let message = "";
    try {
      await Test.createTestingModule({ imports: [providerModule] }).compile();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/RESEND_API_KEY must be re_ followed by/);
    expect(message).not.toContain("re_short");
  });

  it("exposes a verifier only for a configured valid webhook secret and rejects unsafe configuration", async () => {
    process.env.RESEND_API_KEY = KEY;
    delete process.env.RESEND_WEBHOOK_SECRET;
    const disabled = await Test.createTestingModule({ imports: [providerModule] }).compile();
    expect(disabled.get(ResendEmailProvider).webhookVerifier).toBeUndefined();
    await disabled.close();
    process.env.RESEND_WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const enabled = await Test.createTestingModule({ imports: [providerModule] }).compile();
    expect(enabled.get(ResendEmailProvider).webhookVerifier).toBeTypeOf("function");
    await enabled.close();
    process.env.RESEND_WEBHOOK_SECRET = "invalid";
    await expect(Test.createTestingModule({ imports: [providerModule] }).compile()).rejects.toThrow(
      /^RESEND_WEBHOOK_SECRET /,
    );
  });
});
