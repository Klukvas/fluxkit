import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseLiqPayEnv } from "./config.js";
import { createInput, live, providerOn, REFUND_ID } from "./test-support/fixtures.js";
import {
  STUB_PRIVATE_KEY,
  STUB_PUBLIC_KEY,
  startStubLiqPay,
  type StubLiqPay,
} from "./test-support/stub-liqpay.js";

describe("no keys in logs or results", () => {
  let stub: StubLiqPay;

  beforeEach(async () => {
    stub = await startStubLiqPay();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("never echoes public or private key material", async () => {
    const { provider, logger } = providerOn(stub);
    const seen: string[] = [];
    const capture = async (work: () => Promise<unknown>) => {
      try {
        seen.push(JSON.stringify(await work()));
      } catch (error) {
        seen.push(`${(error as Error).name}: ${(error as Error).message}`);
      }
    };
    const id = await provider.createPayment(createInput(), live());
    const orderId = id.ok ? id.value.providerPaymentId : "x";
    stub.register(orderId, 125_000);
    stub.pay(orderId);
    await capture(() => provider.getPayment(orderId, live()));
    await capture(() => provider.buildCheckoutHandoff(createInput(), live()));
    await capture(() =>
      provider.refund(
        {
          providerPaymentId: orderId,
          refundId: REFUND_ID,
          amount: { amount: 100, currency: "UAH" },
          full: false,
        },
        live(),
      ),
    );
    await capture(() => provider.verifyWebhook(stub.webhookFor(orderId), live()));
    await capture(() => Promise.resolve(parseLiqPayEnv({ LIQPAY_PUBLIC_KEY: "short" })));

    const everything = [...logger.lines, ...seen].join("\n");
    expect(everything).not.toContain(STUB_PRIVATE_KEY);
    expect(everything).not.toContain(STUB_PUBLIC_KEY);
    for (let start = 0; start + 8 <= STUB_PRIVATE_KEY.length; start += 1) {
      expect(everything).not.toContain(STUB_PRIVATE_KEY.slice(start, start + 8));
    }
  });
});
