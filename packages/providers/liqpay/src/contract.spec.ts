import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPaymentProviderContract } from "@fluxkit/core";
import {
  aborted,
  createInput,
  createdPayment,
  live,
  PAYMENT_ID,
  providerOn,
} from "./test-support/fixtures.js";
import { startStubLiqPay, type StubLiqPay } from "./test-support/stub-liqpay.js";

describe("checkPaymentProviderContract", () => {
  let stub: StubLiqPay;

  beforeEach(async () => {
    stub = await startStubLiqPay();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("finds no violation", async () => {
    const { provider } = providerOn(stub);
    stub.register(PAYMENT_ID, 125_000);
    const otherPaymentId = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
    const paidId = await createdPayment(provider, stub, { paymentId: otherPaymentId });
    stub.pay(paidId);
    const violations = await checkPaymentProviderContract(provider, {
      create: createInput(),
      succeededPayment: {
        providerPaymentId: paidId,
        reference: otherPaymentId,
        amount: { amount: 125_000, currency: "UAH" },
      },
      unknownProviderPaymentId: "p2_unknown000",
      webhookFor: (providerPaymentId) => stub.webhookFor(providerPaymentId),
      liveSignal: live,
      abortedSignal: aborted,
    });
    expect(violations).toEqual([]);
  });
});
