import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { PAYMENT_PROVIDER_METADATA } from "@fluxkit/core";
import { LiqPayPaymentProvider, providerModule } from "./index.js";

const PUBLIC = "sandbox_public_invented12";
const PRIVATE = "sandbox_private_invented34";

function restore(publicKey: string | undefined, privateKey: string | undefined): void {
  if (publicKey === undefined) {
    Reflect.deleteProperty(process.env, "LIQPAY_PUBLIC_KEY");
  } else {
    process.env.LIQPAY_PUBLIC_KEY = publicKey;
  }
  if (privateKey === undefined) {
    Reflect.deleteProperty(process.env, "LIQPAY_PRIVATE_KEY");
  } else {
    process.env.LIQPAY_PRIVATE_KEY = privateKey;
  }
}

describe("the provider module", () => {
  const savedPublic = process.env.LIQPAY_PUBLIC_KEY;
  const savedPrivate = process.env.LIQPAY_PRIVATE_KEY;

  afterEach(() => {
    restore(savedPublic, savedPrivate);
  });

  it("provides a marked liqpay provider with form-handoff capabilities", async () => {
    process.env.LIQPAY_PUBLIC_KEY = PUBLIC;
    process.env.LIQPAY_PRIVATE_KEY = PRIVATE;
    expect(Reflect.getMetadata(PAYMENT_PROVIDER_METADATA, LiqPayPaymentProvider)).toEqual({
      code: "liqpay",
    });
    const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
    const provider = moduleRef.get(LiqPayPaymentProvider);
    expect(provider.code).toBe("liqpay");
    expect(provider.capabilities).toEqual({
      currencies: ["UAH"],
      partialRefunds: true,
      multipleRefunds: false,
      invalidateUnpaid: false,
      webhooks: true,
      formHandoff: true,
    });
    await moduleRef.close();
  });
});