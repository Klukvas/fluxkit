import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPaymentProviderContract } from "@fluxkit/core";
import { aborted, createdInvoice, createInput, live, providerOn } from "./test-support/fixtures.js";
import { startStubMonobank, type StubMonobank } from "./test-support/stub-monobank.js";

/** The core payment provider contract suite (ADR 0032 decisions 3 and 15), run against the local stub. */
describe("checkPaymentProviderContract", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("finds no violation", async () => {
    const { provider } = providerOn(stub);
    const otherPaymentId = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
    const paidId = await createdInvoice(provider, { paymentId: otherPaymentId });
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
