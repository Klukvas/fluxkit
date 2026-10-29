import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { PAYMENT_PROVIDER_METADATA } from "@fluxkit/core";
import { MonobankPaymentProvider, providerModule } from "./index.js";

const TOKEN = "uModuleSpecToken_0123456789abcdef";

function restore(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "MONOBANK_TOKEN");
  } else {
    process.env.MONOBANK_TOKEN = value;
  }
}

describe("the provider module (what the API's loader mounts)", () => {
  const saved = process.env.MONOBANK_TOKEN;

  afterEach(() => {
    restore(saved);
  });

  it("provides a marked monobank provider with the UAH-only capabilities and calls nothing at startup", async () => {
    process.env.MONOBANK_TOKEN = TOKEN;
    expect(Reflect.getMetadata(PAYMENT_PROVIDER_METADATA, MonobankPaymentProvider)).toEqual({
      code: "monobank",
    });
    const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
    const provider = moduleRef.get(MonobankPaymentProvider);
    expect(provider.code).toBe("monobank");
    expect(provider.capabilities).toEqual({
      currencies: ["UAH"],
      partialRefunds: true,
      multipleRefunds: true,
      invalidateUnpaid: true,
      webhooks: true,
    });
    // The no-network guard of this suite fails the file if anything was sent.
    await moduleRef.close();
  });

  it("refuses to start without a token or with a malformed one, naming the variable and never a value", async () => {
    delete process.env.MONOBANK_TOKEN;
    await expect(Test.createTestingModule({ imports: [providerModule] }).compile()).rejects.toThrow(
      /MONOBANK_TOKEN is required when monobank is in PAYMENT_PROVIDERS_ENABLED/,
    );
    const malformed = "uShort token";
    process.env.MONOBANK_TOKEN = malformed;
    let message = "";
    try {
      await Test.createTestingModule({ imports: [providerModule] }).compile();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/MONOBANK_TOKEN must be 20 to 256 visible ASCII characters/);
    expect(message).not.toContain("uShort");
  });
});
