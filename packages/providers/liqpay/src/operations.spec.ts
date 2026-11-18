import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PaymentProviderResult } from "@fluxkit/core";
import { LIQPAY_API_ORIGIN, LIQPAY_PATHS } from "./config.js";
import { signData } from "./signature.js";
import {
  createdPayment,
  createInput,
  live,
  PAYMENT_ID,
  providerOn,
} from "./test-support/fixtures.js";
import { STUB_PRIVATE_KEY, startStubLiqPay, type StubLiqPay } from "./test-support/stub-liqpay.js";

function valueOf<T>(result: PaymentProviderResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.reason} ${result.providerCodes.join(",")}`);
  }
  return result.value;
}

describe("createPayment", () => {
  let stub: StubLiqPay;

  beforeEach(async () => {
    stub = await startStubLiqPay();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("is local: returns attempt id and handoff URL without network", async () => {
    const { provider } = providerOn(stub);
    const input = createInput();
    expect(valueOf(await provider.createPayment(input, live()))).toEqual({
      providerPaymentId: PAYMENT_ID,
      redirectUrl: input.handoffUrl,
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses without handoffUrl", async () => {
    const { provider } = providerOn(stub);
    const result = await provider.createPayment(createInput({ handoffUrl: undefined }), live());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_sent");
      expect(result.providerCodes).toContain("missing_handoff_url");
    }
  });
});

describe("buildCheckoutHandoff", () => {
  let stub: StubLiqPay;

  beforeEach(async () => {
    stub = await startStubLiqPay();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("builds checkout action URL and signed fields", async () => {
    const { provider } = providerOn(stub);
    const handoff = valueOf(await provider.buildCheckoutHandoff(createInput(), live()));
    expect(handoff.actionUrl).toBe(`${LIQPAY_API_ORIGIN}${LIQPAY_PATHS.checkout}`);
    const data = handoff.fields.data;
    const signature = handoff.fields.signature;
    expect(data).toBeDefined();
    expect(signature).toBeDefined();
    const decoded = JSON.parse(Buffer.from(data ?? "", "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(decoded.action).toBe("pay");
    expect(decoded.order_id).toBe(PAYMENT_ID);
    expect(decoded.amount).toBe(1250);
    expect(decoded.currency).toBe("UAH");
    expect(signData(data ?? "", STUB_PRIVATE_KEY)).toBe(signature);
  });
});

describe("getPayment and refund", () => {
  let stub: StubLiqPay;

  beforeEach(async () => {
    stub = await startStubLiqPay();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("reads status and maps success", async () => {
    const { provider } = providerOn(stub);
    const id = await createdPayment(provider, stub);
    stub.pay(id);
    const fact = valueOf(await provider.getPayment(id, live()));
    expect(fact.providerPaymentId).toBe(id);
    expect(fact.reference).toBe(id);
    expect(fact.status).toBe("succeeded");
    expect(fact.amount.amount).toBe(125_000);
    expect(fact.card).toEqual({ system: "visa", last4: "1902" });
  });

  it("maps live-style HTTP 200 payment_not_found to not_found (pre-submit poll)", async () => {
    const { provider } = providerOn(stub);
    const missing = await provider.getPayment("6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f", live());
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("not_found");
      expect(missing.providerCodes).toContain("payment_not_found");
      expect(missing.providerCodes).toContain("200");
    }
  });

  it("refunds map documented reversed answers to succeeded", async () => {
    const { provider } = providerOn(stub);
    const id = await createdPayment(provider, stub);
    stub.pay(id);
    const refunded = valueOf(
      await provider.refund(
        {
          providerPaymentId: id,
          refundId: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
          amount: { amount: 125_000, currency: "UAH" },
          full: true,
        },
        live(),
      ),
    );
    expect(refunded.status).toBe("succeeded");
  });

  it("invalidates unpaid without network", async () => {
    const { provider } = providerOn(stub);
    const id = await createdPayment(provider, stub);
    expect(valueOf(await provider.invalidatePayment(id, live()))).toEqual({ invalidated: false });
    expect(stub.requests.filter((r) => r.path === LIQPAY_PATHS.request)).toHaveLength(0);
  });
});
