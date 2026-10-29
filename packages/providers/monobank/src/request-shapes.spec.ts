import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PaymentProviderResult } from "@fluxkit/core";
import {
  createdInvoice,
  createInput,
  EXPIRES_AT,
  live,
  NOW,
  PAYMENT_ID,
  providerOn,
  REFUND_ID,
} from "./test-support/fixtures.js";
import { STUB_TOKEN, startStubMonobank, type StubMonobank } from "./test-support/stub-monobank.js";

/*
 * The exact requests (ADR 0032 decision 6 step 3 and decision 15; M3, M6, M13, M14): path, method, headers and body
 * members are pinned, the token travels only in `X-Token`, and a create in another currency than UAH or with a bad input
 * sends nothing.
 */

function codesOf(result: PaymentProviderResult<unknown>): unknown {
  return result.ok ? "ok" : { reason: result.reason, codes: result.providerCodes };
}

describe("request shapes", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("creates an invoice with exactly the documented members, in UAH, with our reference", async () => {
    const { provider } = providerOn(stub);
    await createdInvoice(provider);
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/api/merchant/invoice/create");
    expect(request?.headers["x-token"]).toBe(STUB_TOKEN);
    expect(request?.headers["content-type"]).toBe("application/json");
    // White-label: no CMS headers (M1), no other credential header.
    expect(request?.headers["x-cms"]).toBeUndefined();
    expect(request?.headers["x-cms-version"]).toBeUndefined();
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.body).toEqual({
      amount: 125_000,
      ccy: 980,
      merchantPaymInfo: {
        reference: PAYMENT_ID,
        destination: "Замовлення 7K3M-9QX2",
        basketOrder: [
          { name: "Вигаданий товар", qty: 2, sum: 50_000, total: 100_000, code: "SKU-DEMO-1" },
          { name: "Доставка", qty: 1, sum: 25_000, total: 25_000, code: "nova_post_branch" },
        ],
      },
      redirectUrl: `https://shop.example/uk/payment/return?payment=${PAYMENT_ID}`,
      webHookUrl: "https://shop.example/webhooks/payments/monobank",
      // 27 minutes from the provider's clock to the invoice end core computed.
      validity: (EXPIRES_AT.getTime() - NOW.getTime()) / 1_000,
      paymentType: "debit",
    });
    expect(request?.rawBody).not.toContain(STUB_TOKEN);
  });

  it("rounds the validity down to whole seconds", async () => {
    const { provider } = providerOn(stub);
    await createdInvoice(provider, { expiresAt: new Date(NOW.getTime() + 300_999) });
    expect((stub.requests[0]?.body as { validity: number }).validity).toBe(300);
  });

  it("omits the basket when the caller sends none, or when any line would make it wrong", async () => {
    const { provider } = providerOn(stub);
    const input = createInput();
    const [first, second] = input.lines;
    if (first === undefined || second === undefined) throw new Error("fixture");
    const variants = [
      [], // core answered sum_mismatch: the caller sends no lines
      [first], // sum differs from the amount
      [first, { ...second, code: null }], // a line without a code (M3: `code` is required)
      [first, { ...second, name: "  " }],
      [first, { ...second, total: { amount: 25_001, currency: "UAH" } }], // total != unit x qty
      [first, { ...second, unitAmount: { amount: 25_000, currency: "USD" } }],
      [{ ...first, quantity: 0 }, second],
    ] as const;
    for (const lines of variants) {
      await createdInvoice(provider, { lines });
      const body = stub.requests.at(-1)?.body as { merchantPaymInfo: Record<string, unknown> };
      expect(body.merchantPaymInfo, JSON.stringify(lines)).toEqual({
        reference: PAYMENT_ID,
        destination: "Замовлення 7K3M-9QX2",
      });
    }
  });

  it("refuses before any request what it must not send (not_sent)", async () => {
    const { provider } = providerOn(stub);
    const cases: [string, Parameters<typeof createInput>[0]][] = [
      ["currency_not_supported", { amount: { amount: 125_000, currency: "USD" } }],
      ["currency_not_supported", { amount: { amount: 125_000, currency: "EUR" } }],
      ["invalid_amount", { amount: { amount: 0, currency: "UAH" } }],
      ["invalid_amount", { amount: { amount: 1.5, currency: "UAH" } }],
      ["invalid_payment_id", { paymentId: "not-a-uuid" }],
      ["invalid_description", { description: "   " }],
      ["invalid_description", { description: "я".repeat(281) }],
      ["invalid_description", { description: "Order\r\nX-Injected: 1" }],
      ["invalid_return_url", { returnUrl: "javascript:alert(1)" }],
      ["invalid_return_url", { returnUrl: "https://user:pass@shop.example/x" }],
      ["invalid_webhook_url", { webhookUrl: "ftp://shop.example/hook" }],
      ["invoice_expired", { expiresAt: new Date(NOW.getTime() + 999) }],
      ["invoice_expired", { expiresAt: new Date(NOW.getTime() - 60_000) }],
      ["validity_too_long", { expiresAt: new Date(NOW.getTime() + 31 * 24 * 3_600_000) }],
    ];
    for (const [code, overrides] of cases) {
      expect(codesOf(await provider.createPayment(createInput(overrides), live())), code).toEqual({
        reason: "not_sent",
        codes: [code],
      });
    }
    // Exactly 280 code points of description pass.
    await createdInvoice(provider, { description: "я".repeat(280) });
    expect(stub.requests).toHaveLength(1);
  });

  it("reads a status with GET and the invoice id as the only query value", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    await provider.getPayment(invoiceId, live());
    const request = stub.requests[1];
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe(`/api/merchant/invoice/status?invoiceId=${invoiceId}`);
    expect(request?.headers["x-token"]).toBe(STUB_TOKEN);
    expect(request?.rawBody).toBe("");
  });

  it("invalidates with POST invoice/remove {invoiceId}", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    await provider.invalidatePayment(invoiceId, live());
    const request = stub.requests[1];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/api/merchant/invoice/remove");
    expect(request?.body).toEqual({ invoiceId });
    expect(request?.headers["x-token"]).toBe(STUB_TOKEN);
  });

  it("refunds with POST invoice/cancel {invoiceId, extRef = our refund id, amount}, also for a full refund", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    stub.pay(invoiceId);
    await provider.refund(
      {
        providerPaymentId: invoiceId,
        refundId: REFUND_ID,
        amount: { amount: 1_000, currency: "UAH" },
        full: false,
      },
      live(),
    );
    await provider.refund(
      {
        providerPaymentId: invoiceId,
        refundId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        amount: { amount: 124_000, currency: "UAH" },
        full: true,
      },
      live(),
    );
    expect(
      stub.requests.slice(1).map((request) => [request.method, request.url, request.body]),
    ).toEqual([
      ["POST", "/api/merchant/invoice/cancel", { invoiceId, extRef: REFUND_ID, amount: 1_000 }],
      [
        "POST",
        "/api/merchant/invoice/cancel",
        { invoiceId, extRef: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", amount: 124_000 },
      ],
    ]);
  });

  it("refuses a refund before any request when the input is wrong (not_sent)", async () => {
    const { provider } = providerOn(stub);
    const base = {
      providerPaymentId: "p2_stub000001",
      refundId: REFUND_ID,
      amount: { amount: 1_000, currency: "UAH" } as { amount: number; currency: "UAH" | "USD" },
      full: false,
    };
    const cases: [string, Partial<typeof base> & Record<string, unknown>][] = [
      ["invalid_provider_payment_id", { providerPaymentId: "p2/../../x" }],
      ["invalid_refund_id", { refundId: "refund 1" }],
      ["invalid_refund_id", { refundId: "" }],
      ["currency_not_supported", { amount: { amount: 1_000, currency: "USD" } }],
      ["invalid_amount", { amount: { amount: -5, currency: "UAH" } }],
    ];
    for (const [code, overrides] of cases) {
      const result = await provider.refund({ ...base, ...overrides } as typeof base, live());
      expect(codesOf(result), code).toEqual({ reason: "not_sent", codes: [code] });
    }
    for (const id of ["", "a b", "x".repeat(65), "p2?x=1"]) {
      expect(codesOf(await provider.getPayment(id, live()))).toEqual({
        reason: "not_sent",
        codes: ["invalid_provider_payment_id"],
      });
      expect(codesOf(await provider.invalidatePayment(id, live()))).toEqual({
        reason: "not_sent",
        codes: ["invalid_provider_payment_id"],
      });
    }
    expect(stub.requests).toHaveLength(0);
  });
});
