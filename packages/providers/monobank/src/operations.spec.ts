import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PaymentProviderResult, ProviderPaymentFact } from "@fluxkit/core";
import { factOf } from "./invoice.js";
import {
  createdInvoice,
  createInput,
  live,
  PAYMENT_ID,
  providerOn,
  REFUND_ID,
} from "./test-support/fixtures.js";
import { startStubMonobank, type StubMonobank } from "./test-support/stub-monobank.js";

/*
 * What each operation answers for each documented Monobank answer (M4, M6, M7, M13, M14): the create's id and page, the
 * status mapping to core facts with refunds from `cancelList`, unknown statuses as `null`, invalidation and refunds.
 */

function valueOf<T>(result: PaymentProviderResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.reason} ${result.providerCodes.join(",")}`);
  }
  return result.value;
}

function failureOf(result: PaymentProviderResult<unknown>): {
  reason: string;
  codes: readonly string[];
} {
  if (result.ok) {
    throw new Error("expected a failure");
  }
  return { reason: result.reason, codes: result.providerCodes };
}

/** A documented-looking status answer with invented values; specs change members. */
function statusAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invoiceId: "p2_9ZgpZVsl3",
    status: "success",
    failureReason: "string",
    amount: 4200,
    ccy: 980,
    finalAmount: 4200,
    createdDate: "2026-10-29T10:00:01Z",
    modifiedDate: "2026-10-29T10:05:00Z",
    reference: PAYMENT_ID,
    destination: "Замовлення 7K3M-9QX2",
    cancelList: [],
    paymentInfo: {
      maskedPan: "444403******1902",
      approvalCode: "662476",
      rrn: "060189181768",
      tranId: "13194036",
      terminal: "MI001088",
      bank: "Вигаданий Банк",
      paymentSystem: "visa",
      paymentMethod: "pan",
      fee: 55,
      country: "804",
    },
    ...overrides,
  };
}

function fact(json: unknown, expected?: string): ProviderPaymentFact {
  const read = factOf(json, expected);
  if (!read.ok) {
    throw new Error(`expected a fact, got ${read.detail}`);
  }
  return read.fact;
}

describe("createPayment", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("answers the invoice id and the https page on the documented host", async () => {
    const { provider } = providerOn(stub);
    expect(valueOf(await provider.createPayment(createInput(), live()))).toEqual({
      providerPaymentId: "p2_stub000001",
      redirectUrl: "https://pay.mbnk.biz/p2_stub000001",
    });
  });

  it("is not idempotent at Monobank (M5): the plugin never repeats a create by itself", async () => {
    const { provider } = providerOn(stub);
    await provider.createPayment(createInput(), live());
    await provider.createPayment(createInput(), live());
    expect(stub.invoices.size).toBe(2);
    expect(stub.requests).toHaveLength(2);
  });

  it("never hands a page on another host, scheme or port to a browser (M23)", async () => {
    const { provider } = providerOn(stub);
    for (const pageUrl of [
      "http://pay.mbnk.biz/p2_x",
      "https://pay.mbnk.biz.evil.example/p2_x",
      "https://evil.example/p2_x",
      "https://pay.mbnk.biz:8443/p2_x",
      "https://user@pay.mbnk.biz/p2_x",
      "javascript:alert(1)",
    ]) {
      stub.override(() => ({ status: 200, json: { invoiceId: "p2_x", pageUrl } }));
      expect(failureOf(await provider.createPayment(createInput(), live())), pageUrl).toEqual({
        reason: "unavailable",
        codes: ["page_host_not_allowed", "200"],
      });
    }
    for (const invoiceId of ["", "p2 x", "p2:x", "x".repeat(65), 42]) {
      stub.override(() => ({
        status: 200,
        json: { invoiceId, pageUrl: "https://pay.mbnk.biz/x" },
      }));
      expect(failureOf(await provider.createPayment(createInput(), live()))).toEqual({
        reason: "unavailable",
        codes: ["malformed_answer", "200"],
      });
    }
  });

  it("answers a refused create as rejected and a 403 as misconfigured", async () => {
    const { provider } = providerOn(stub);
    stub.override(() => ({
      status: 400,
      json: { errCode: "INVALID_MERCHANT_PAYM_INFO", errText: "x" },
    }));
    expect(failureOf(await provider.createPayment(createInput(), live()))).toEqual({
      reason: "rejected",
      codes: ["INVALID_MERCHANT_PAYM_INFO", "400"],
    });
    stub.override(undefined);
    const wrong = providerOn(stub, { token: "uWrongToken_0123456789abcdef" }).provider;
    expect(failureOf(await wrong.createPayment(createInput(), live()))).toEqual({
      reason: "misconfigured",
      codes: ["FORBIDDEN", "403"],
    });
  });
});

describe("getPayment and the status mapping", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("reads a created invoice as a fact that names our reference", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    expect(valueOf(await provider.getPayment(invoiceId, live()))).toEqual({
      providerPaymentId: invoiceId,
      reference: PAYMENT_ID,
      status: "created",
      providerStatus: "created",
      amount: { amount: 125_000, currency: "UAH" },
      finalAmount: null,
      modifiedAt: new Date("2026-10-29T10:00:01.000Z"),
      failureCode: null,
      refunds: [],
      card: null,
    });
  });

  it("maps every documented status, and an unknown one to null with the raw word kept", () => {
    const table: [string, string | null][] = [
      ["created", "created"],
      ["processing", "processing"],
      ["hold", "authorized"],
      ["success", "succeeded"],
      ["failure", "failed"],
      ["reversed", "reversed"],
      ["expired", "expired"],
      ["refunded_partly", null],
      ["SUCCESS", null],
    ];
    for (const [raw, status] of table) {
      const read = fact(statusAnswer({ status: raw }));
      expect([read.status, read.providerStatus], raw).toEqual([status, raw]);
    }
    // A status word that is not even a short code is an unreadable answer.
    expect(factOf(statusAnswer({ status: "suc cess" }))).toEqual({
      ok: false,
      detail: "malformed_answer",
    });
    expect(factOf(statusAnswer({ status: "" }))).toEqual({ ok: false, detail: "malformed_answer" });
  });

  it("keeps the card system and last four digits only, and the payment error code, never bank text", () => {
    const paid = fact(statusAnswer());
    expect(paid.card).toEqual({ system: "visa", last4: "1902" });
    expect(JSON.stringify(paid)).not.toContain("444403");
    expect(JSON.stringify(paid)).not.toContain("662476");
    expect(JSON.stringify(paid)).not.toContain("060189181768");
    expect(JSON.stringify(paid)).not.toContain("Вигаданий");
    const failed = fact(
      statusAnswer({
        status: "failure",
        errCode: "59",
        failureReason: "Недостатньо коштів",
        paymentInfo: undefined,
      }),
    );
    expect([failed.status, failed.failureCode, failed.card]).toEqual(["failed", "59", null]);
    expect(JSON.stringify(failed)).not.toContain("коштів");
    expect(fact(statusAnswer({ errCode: 8002 })).failureCode).toBe("8002");
    expect(fact(statusAnswer({ errCode: "a long bank sentence" })).failureCode).toBeNull();
    for (const paymentInfo of [
      { maskedPan: "444403******1902" },
      { paymentSystem: "visa" },
      { maskedPan: "444403******19", paymentSystem: "visa" },
      { maskedPan: "444403******1902", paymentSystem: "visa card" },
      null,
    ]) {
      expect(fact(statusAnswer({ paymentInfo })).card, JSON.stringify(paymentInfo)).toBeNull();
    }
    expect(
      fact(
        statusAnswer({
          paymentInfo: { maskedPan: "537541******0011", paymentSystem: "Mastercard" },
        }),
      ).card,
    ).toEqual({
      system: "mastercard",
      last4: "0011",
    });
  });

  it("lists refunds from cancelList under our extRef, and a cabinet refund without one as null", () => {
    const read = fact(
      statusAnswer({
        finalAmount: 3200,
        cancelList: [
          {
            status: "success",
            amount: 1000,
            ccy: 980,
            createdDate: "2026-10-29T11:00:00Z",
            modifiedDate: "2026-10-29T11:00:05Z",
            approvalCode: "1",
            rrn: "2",
            extRef: REFUND_ID,
          },
          {
            status: "processing",
            amount: 200,
            createdDate: "2026-10-29T12:00:00Z",
            modifiedDate: "2026-10-29T12:00:00Z",
          },
          {
            status: "failure",
            amount: 300,
            ccy: 980,
            createdDate: "2026-10-29T13:00:00Z",
            modifiedDate: "2026-10-29T13:00:01Z",
            extRef: "has spaces in it",
          },
        ],
      }),
    );
    expect(read.finalAmount).toEqual({ amount: 3200, currency: "UAH" });
    expect(read.refunds).toEqual([
      {
        refundId: REFUND_ID,
        status: "succeeded",
        amount: { amount: 1000, currency: "UAH" },
        modifiedAt: new Date("2026-10-29T11:00:05Z"),
      },
      {
        refundId: null,
        status: "processing",
        amount: { amount: 200, currency: "UAH" },
        modifiedAt: new Date("2026-10-29T12:00:00Z"),
      },
      {
        refundId: null,
        status: "failed",
        amount: { amount: 300, currency: "UAH" },
        modifiedAt: new Date("2026-10-29T13:00:01Z"),
      },
    ]);
  });

  it("treats a refund it cannot account as an unreadable answer, never drops it", () => {
    const entry = {
      status: "success",
      amount: 1000,
      ccy: 980,
      createdDate: "2026-10-29T11:00:00Z",
      modifiedDate: "2026-10-29T11:00:05Z",
      extRef: REFUND_ID,
    };
    const broken = [
      { ...entry, amount: undefined }, // the spec does not mark `amount` required (UNKNOWN)
      { ...entry, amount: 0 },
      { ...entry, ccy: 840 },
      { ...entry, status: "reverted" },
      { ...entry, createdDate: undefined, modifiedDate: undefined },
      { ...entry, modifiedDate: "yesterday", createdDate: undefined },
    ];
    for (const item of broken) {
      expect(factOf(statusAnswer({ cancelList: [item] })), JSON.stringify(item)).toEqual({
        ok: false,
        detail: "malformed_answer",
      });
    }
    expect(factOf(statusAnswer({ cancelList: Array.from({ length: 101 }, () => entry) }))).toEqual({
      ok: false,
      detail: "malformed_answer",
    });
  });

  it("orders by modifiedDate, falling back to createdDate (never later than a real change)", () => {
    expect(fact(statusAnswer()).modifiedAt).toEqual(new Date("2026-10-29T10:05:00Z"));
    expect(fact(statusAnswer({ modifiedDate: undefined })).modifiedAt).toEqual(
      new Date("2026-10-29T10:00:01Z"),
    );
    expect(
      fact(statusAnswer({ modifiedDate: "2026-10-29T10:05:00.123456+03:00" })).modifiedAt,
    ).toEqual(new Date("2026-10-29T07:05:00.123Z"));
    for (const dates of [
      { modifiedDate: undefined, createdDate: undefined },
      { modifiedDate: "2026-10-29 10:05:00", createdDate: undefined },
      { modifiedDate: "2026-10-29T10:05:00", createdDate: undefined }, // no zone
      { modifiedDate: "2026-13-45T10:05:00Z", createdDate: undefined },
    ]) {
      expect(factOf(statusAnswer(dates)), JSON.stringify(dates)).toEqual({
        ok: false,
        detail: "malformed_answer",
      });
    }
  });

  it("refuses an answer about another invoice, in an unknown currency, or without our reference", () => {
    expect(factOf(statusAnswer(), "p2_other")).toEqual({ ok: false, detail: "answer_mismatch" });
    expect(factOf(statusAnswer({ ccy: 999 }))).toEqual({
      ok: false,
      detail: "unsupported_currency",
    });
    expect(factOf(statusAnswer({ reference: undefined }))).toEqual({
      ok: false,
      detail: "malformed_answer",
    });
    expect(factOf(statusAnswer({ amount: 0 }))).toEqual({ ok: false, detail: "malformed_answer" });
    expect(factOf(statusAnswer({ amount: 42.5 }))).toEqual({
      ok: false,
      detail: "malformed_answer",
    });
    expect(factOf(statusAnswer({ invoiceId: "p2 9" }))).toEqual({
      ok: false,
      detail: "malformed_answer",
    });
    expect(factOf(statusAnswer({ finalAmount: -1 }))).toEqual({
      ok: false,
      detail: "malformed_answer",
    });
    // Another known currency is read as such (core's binding then refuses it against a UAH attempt).
    expect(fact(statusAnswer({ ccy: 840 })).amount).toEqual({ amount: 4200, currency: "USD" });
  });

  it("answers not_found for an unknown invoice and unavailable for an answer about another one", async () => {
    const { provider } = providerOn(stub);
    expect(failureOf(await provider.getPayment("p2_unknown", live()))).toEqual({
      reason: "not_found",
      codes: ["NOT_FOUND", "404"],
    });
    const invoiceId = await createdInvoice(provider);
    stub.override(() => ({
      status: 200,
      json: { ...stub.statusJson(invoiceId), invoiceId: "p2_other" },
    }));
    expect(failureOf(await provider.getPayment(invoiceId, live()))).toEqual({
      reason: "unavailable",
      codes: ["answer_mismatch", "200"],
    });
  });
});

describe("invalidatePayment and refund", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("invalidates an unpaid invoice (M14); a paid one is refused by Monobank", async () => {
    const { provider } = providerOn(stub);
    const unpaid = await createdInvoice(provider);
    expect(valueOf(await provider.invalidatePayment(unpaid, live()))).toEqual({
      invalidated: true,
    });
    const paid = await createdInvoice(provider);
    stub.pay(paid);
    expect(failureOf(await provider.invalidatePayment(paid, live()))).toEqual({
      reason: "rejected",
      codes: ["BAD_REQUEST", "400"],
    });
    expect(failureOf(await provider.invalidatePayment("p2_unknown", live()))).toEqual({
      reason: "not_found",
      codes: ["NOT_FOUND", "404"],
    });
  });

  it("answers the cancel status and lists the refund under our refund id", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    stub.pay(invoiceId);
    const input = {
      providerPaymentId: invoiceId,
      refundId: REFUND_ID,
      amount: { amount: 25_000, currency: "UAH" as const },
      full: false,
    };
    expect(valueOf(await provider.refund(input, live()))).toEqual({ status: "succeeded" });
    const after = valueOf(await provider.getPayment(invoiceId, live()));
    expect(after.status).toBe("succeeded");
    expect(after.finalAmount).toEqual({ amount: 100_000, currency: "UAH" });
    expect(
      after.refunds.map((refund) => [refund.refundId, refund.status, refund.amount.amount]),
    ).toEqual([[REFUND_ID, "succeeded", 25_000]]);
    for (const status of ["processing", "failure"] as const) {
      stub.setRefundOutcome(status);
      expect(
        valueOf(
          await provider.refund(
            { ...input, refundId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" },
            live(),
          ),
        ),
      ).toEqual({ status: status === "failure" ? "failed" : "processing" });
    }
  });

  it("maps CANCEL_NOT_AVAILABLE to not_cancellable and WRONG_CANCEL_AMOUNT to rejected", async () => {
    const { provider } = providerOn(stub);
    const unpaid = await createdInvoice(provider);
    const input = {
      providerPaymentId: unpaid,
      refundId: REFUND_ID,
      amount: { amount: 1_000, currency: "UAH" as const },
      full: false,
    };
    expect(failureOf(await provider.refund(input, live()))).toEqual({
      reason: "not_cancellable",
      codes: ["CANCEL_NOT_AVAILABLE", "500"],
    });
    stub.pay(unpaid);
    expect(
      failureOf(
        await provider.refund({ ...input, amount: { amount: 125_001, currency: "UAH" } }, live()),
      ),
    ).toEqual({ reason: "rejected", codes: ["WRONG_CANCEL_AMOUNT", "400"] });
  });

  it("answers an unknown cancel status as unavailable (the refund may have been made)", async () => {
    const { provider } = providerOn(stub);
    stub.override(() => ({
      status: 200,
      json: { status: "done", createdDate: "x", modifiedDate: "y" },
    }));
    expect(
      failureOf(
        await provider.refund(
          {
            providerPaymentId: "p2_stub000001",
            refundId: REFUND_ID,
            amount: { amount: 1, currency: "UAH" },
            full: false,
          },
          live(),
        ),
      ),
    ).toEqual({ reason: "unavailable", codes: ["malformed_answer", "200"] });
  });
});
