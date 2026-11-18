import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PaymentProviderResult } from "@fluxkit/core";
import { createdPayment, live, providerOn } from "./test-support/fixtures.js";
import { startStubLiqPay, type StubLiqPay } from "./test-support/stub-liqpay.js";

function outcome(result: PaymentProviderResult<unknown>): unknown {
  return result.ok ? "ok" : { reason: result.reason, codes: result.providerCodes };
}

describe("verifyWebhook", () => {
  let stub: StubLiqPay;

  beforeEach(async () => {
    stub = await startStubLiqPay();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("verifies urlencoded data and signature", async () => {
    const { provider } = providerOn(stub);
    const id = await createdPayment(provider, stub);
    stub.pay(id);
    const webhook = stub.webhookFor(id);
    expect(outcome(await provider.verifyWebhook(webhook, live()))).toBe("ok");
  });

  it("refuses a tampered body", async () => {
    const { provider } = providerOn(stub);
    const id = await createdPayment(provider, stub);
    const webhook = stub.webhookFor(id);
    const rawBody = Uint8Array.from(webhook.rawBody);
    const last = rawBody.length - 1;
    expect(last).toBeGreaterThanOrEqual(0);
    rawBody[last] = (rawBody[last] ?? 0) ^ 0x01;
    const result = await provider.verifyWebhook({ headers: webhook.headers, rawBody }, live());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_signature");
    }
  });
});
