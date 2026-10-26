import { describe, expect, it } from "vitest";
import { MAX_AMOUNT } from "../pricing/limits.js";
import { paymentProviderFailure, paymentProviderOk } from "./provider-port.js";
import {
  decideRefund,
  decideRefundFromFact,
  refundStatusAfterCall,
  remainingRefundable,
  type RefundCapabilities,
  type RefundRecord,
} from "./refund.js";
import type { PaymentStatus, RefundStatus } from "./status.js";
import { fact, REFUND_ID, uah } from "./test-support.js";

const PAID = uah(125_000);
const both: RefundCapabilities = { partialRefunds: true, multipleRefunds: true };

const record = (amount: number, status: RefundStatus): RefundRecord => ({
  amount: uah(amount),
  status,
});

function refund(
  amount: number,
  refunds: RefundRecord[] = [],
  capabilities: RefundCapabilities = both,
  status: PaymentStatus = "succeeded",
) {
  return decideRefund({
    payment: { status, amount: PAID },
    refunds,
    amount: uah(amount),
    capabilities,
  });
}

describe("remainingRefundable", () => {
  it("is the amount less every requested, processing, succeeded and unknown refund; failed ones are free again", () => {
    expect(remainingRefundable(PAID, [])).toEqual(uah(125_000));
    expect(
      remainingRefundable(PAID, [
        record(10_000, "requested"),
        record(20_000, "processing"),
        record(30_000, "succeeded"),
        record(40_000, "unknown"),
        record(25_000, "failed"),
      ]),
    ).toEqual(uah(25_000));
    expect(remainingRefundable(PAID, [record(125_000, "succeeded")])).toEqual(uah(0));
  });

  it("throws when stored refunds already exceed the amount or use another currency (corrupt data)", () => {
    expect(() => remainingRefundable(PAID, [record(125_001, "succeeded")])).toThrow(RangeError);
    expect(() =>
      remainingRefundable(PAID, [{ amount: { amount: 1, currency: "USD" }, status: "succeeded" }]),
    ).toThrow(RangeError);
    expect(() => remainingRefundable(PAID, [record(1, "gone" as RefundStatus)])).toThrow(
      RangeError,
    );
  });
});

describe("decideRefund (ADR 0032 decision 11)", () => {
  it("allows a full refund of a succeeded payment", () => {
    expect(refund(125_000)).toEqual({ ok: true, full: true, remainingAfter: uah(0) });
  });

  it("allows a partial refund and then exactly the remaining amount, never 1 minor unit more", () => {
    expect(refund(25_000)).toEqual({ ok: true, full: false, remainingAfter: uah(100_000) });
    const after = [record(25_000, "succeeded")];
    expect(refund(100_000, after)).toEqual({ ok: true, full: false, remainingAfter: uah(0) });
    expect(refund(100_001, after)).toEqual({ ok: false, reason: "refund_exceeds_remaining" });
    expect(refund(125_001)).toEqual({ ok: false, reason: "refund_exceeds_remaining" });
  });

  it("counts refunds in flight and unknown ones against the remaining amount", () => {
    expect(refund(1, [record(125_000, "unknown")])).toEqual({
      ok: false,
      reason: "refund_exceeds_remaining",
    });
    expect(refund(1, [record(124_999, "processing")])).toMatchObject({ ok: true });
    expect(refund(125_000, [record(125_000, "failed")])).toMatchObject({ ok: true, full: true });
  });

  it("refuses any refund after a full refund", () => {
    expect(refund(1, [record(125_000, "succeeded")])).toEqual({
      ok: false,
      reason: "refund_exceeds_remaining",
    });
  });

  it("refuses zero, negative, fractional and overflowing amounts", () => {
    for (const amount of [0, -1, -125_000, 1.5, Number.NaN, MAX_AMOUNT + 1]) {
      expect(refund(amount), String(amount)).toEqual({ ok: false, reason: "invalid_amount" });
    }
  });

  it("refuses another currency", () => {
    expect(
      decideRefund({
        payment: { status: "succeeded", amount: PAID },
        refunds: [],
        amount: { amount: 125_000, currency: "USD" },
        capabilities: both,
      }),
    ).toEqual({ ok: false, reason: "currency_mismatch" });
  });

  it("refuses unless the payment succeeded", () => {
    for (const status of [
      "creating",
      "awaiting_customer",
      "processing",
      "failed",
      "expired",
      "invalidated",
      "create_unknown",
    ] as const) {
      expect(refund(125_000, [], both, status), status).toEqual({
        ok: false,
        reason: "refund_not_allowed",
      });
    }
  });

  it("refuses a partial amount when the provider has no partial refunds", () => {
    const fullOnly = { partialRefunds: false, multipleRefunds: false };
    expect(refund(124_999, [], fullOnly)).toEqual({
      ok: false,
      reason: "partial_refund_not_supported",
    });
    expect(refund(125_000, [], fullOnly)).toMatchObject({ ok: true, full: true });
  });

  it("refuses a second refund when the provider allows only one, unless the earlier one failed", () => {
    const single = { partialRefunds: true, multipleRefunds: false };
    expect(refund(1_000, [record(1_000, "succeeded")], single)).toEqual({
      ok: false,
      reason: "refund_not_allowed",
    });
    expect(refund(1_000, [record(1_000, "failed")], single)).toMatchObject({ ok: true });
  });

  it("throws on corrupt payment data", () => {
    expect(() =>
      decideRefund({
        payment: { status: "succeeded", amount: uah(0) },
        refunds: [],
        amount: uah(1),
        capabilities: both,
      }),
    ).toThrow(RangeError);
  });
});

describe("refundStatusAfterCall (lost answers are never resent)", () => {
  it("takes the provider's answer", () => {
    for (const status of ["processing", "succeeded", "failed"] as const) {
      expect(refundStatusAfterCall(paymentProviderOk({ status }))).toEqual({
        status,
        failureCode: null,
        attentionCode: status === "failed" ? "refund_failed" : null,
        retryAfterSeconds: null,
      });
    }
  });

  it("an answer that may have reached the provider is unknown (settled from the provider's refund list later)", () => {
    for (const reason of ["unavailable", "invalid_signature"] as const) {
      expect(refundStatusAfterCall(paymentProviderFailure(reason)), reason).toEqual({
        status: "unknown",
        failureCode: null,
        attentionCode: null,
        retryAfterSeconds: null,
      });
    }
  });

  it("a refusal that proves nothing happened is failed, with attention and the first code", () => {
    for (const reason of [
      "not_sent",
      "rejected",
      "misconfigured",
      "not_found",
      "not_cancellable",
    ] as const) {
      expect(
        refundStatusAfterCall(paymentProviderFailure(reason, { providerCodes: ["CODE_1", "x"] })),
        reason,
      ).toEqual({
        status: "failed",
        failureCode: "CODE_1",
        attentionCode: "refund_failed",
        retryAfterSeconds: null,
      });
    }
    expect(refundStatusAfterCall(paymentProviderFailure("rejected")).failureCode).toBe("rejected");
  });

  it("throttling stays requested (nothing happened; job 11 sends it later)", () => {
    expect(
      refundStatusAfterCall(paymentProviderFailure("rate_limited", { retryAfterSeconds: 30 })),
    ).toEqual({
      status: "requested",
      failureCode: null,
      attentionCode: null,
      retryAfterSeconds: 30,
    });
  });

  it("throws on a malformed answer status (the API validates answers first)", () => {
    expect(() =>
      refundStatusAfterCall(paymentProviderOk({ status: "done" as "succeeded" })),
    ).toThrow(RangeError);
  });
});

describe("decideRefundFromFact (settles a refund by our refund id in the provider's list)", () => {
  const entry = (
    status: "processing" | "succeeded" | "failed",
    amount = 10_000,
    refundId: string | null = REFUND_ID,
  ) => ({
    refundId,
    status,
    amount: uah(amount),
    modifiedAt: new Date("2026-10-26T11:00:00.000Z"),
  });
  const ours = (status: RefundStatus) => ({ id: REFUND_ID, status, amount: uah(10_000) });

  it("settles an unknown refund the provider lists", () => {
    for (const status of ["processing", "succeeded", "failed"] as const) {
      expect(
        decideRefundFromFact(ours("unknown"), fact({ refunds: [entry(status)] })),
        status,
      ).toEqual({
        kind: "apply",
        toStatus: status,
        attentionCode: status === "failed" ? "refund_failed" : null,
      });
    }
    expect(
      decideRefundFromFact(ours("processing"), fact({ refunds: [entry("succeeded")] })),
    ).toEqual({ kind: "apply", toStatus: "succeeded", attentionCode: null });
    expect(
      decideRefundFromFact(ours("requested"), fact({ refunds: [entry("processing")] })),
    ).toEqual({ kind: "apply", toStatus: "processing", attentionCode: null });
  });

  it("an unknown refund the provider does not list stays unknown (never failed automatically)", () => {
    expect(decideRefundFromFact(ours("unknown"), fact({ refunds: [] }))).toEqual({ kind: "none" });
    expect(
      decideRefundFromFact(ours("unknown"), fact({ refunds: [entry("succeeded", 10_000, null)] })),
    ).toEqual({ kind: "none" });
  });

  it("the same status, a terminal refund or a backward move changes nothing", () => {
    expect(
      decideRefundFromFact(ours("processing"), fact({ refunds: [entry("processing")] })),
    ).toEqual({ kind: "none" });
    expect(decideRefundFromFact(ours("succeeded"), fact({ refunds: [entry("failed")] }))).toEqual({
      kind: "none",
    });
    expect(
      decideRefundFromFact(ours("succeeded"), fact({ refunds: [entry("processing")] })),
    ).toEqual({ kind: "none" });
  });

  it("another amount or two entries with our id raise attention and change nothing", () => {
    expect(
      decideRefundFromFact(ours("unknown"), fact({ refunds: [entry("succeeded", 10_001)] })),
    ).toEqual({ kind: "attention", attentionCode: "refund_mismatch" });
    expect(
      decideRefundFromFact(
        ours("unknown"),
        fact({ refunds: [entry("succeeded"), entry("failed")] }),
      ),
    ).toEqual({ kind: "attention", attentionCode: "refund_mismatch" });
  });
});
