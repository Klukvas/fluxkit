import { describe, expect, it } from "vitest";
import { bindFact, type BindableAttempt } from "./binding.js";
import { fact, INVOICE_ID, OTHER_PAYMENT_ID, PAYMENT_ID, uah } from "./test-support.js";

const attempt: BindableAttempt = {
  id: PAYMENT_ID,
  providerPaymentId: INVOICE_ID,
  amount: uah(125_000),
};

const refund = (amount: number, status: "processing" | "succeeded" | "failed") => ({
  refundId: null,
  status,
  amount: uah(amount),
  modifiedAt: new Date("2026-10-26T11:00:00.000Z"),
});

describe("bindFact", () => {
  it("binds a fact whose provider id, reference, amount and currency equal the attempt's", () => {
    expect(bindFact(fact(), attempt)).toEqual({ ok: true, bindsProviderPaymentId: false });
    for (const status of ["created", "processing", "failed", "expired", null] as const) {
      expect(bindFact(fact({ status, finalAmount: null }), attempt).ok, String(status)).toBe(true);
    }
  });

  it("binds an attempt without a provider id by our reference (a create_unknown attempt)", () => {
    expect(bindFact(fact(), { ...attempt, providerPaymentId: null })).toEqual({
      ok: true,
      bindsProviderPaymentId: true,
    });
  });

  it("refuses another reference, even with the right provider id", () => {
    expect(bindFact(fact({ reference: OTHER_PAYMENT_ID }), attempt)).toEqual({
      ok: false,
      reason: "reference_mismatch",
      attentionCode: "fact_not_bound",
    });
    expect(bindFact(fact({ reference: PAYMENT_ID.toUpperCase() }), attempt).ok).toBe(false);
  });

  it("refuses another provider id", () => {
    expect(bindFact(fact({ providerPaymentId: "p2_other" }), attempt)).toEqual({
      ok: false,
      reason: "provider_payment_id_mismatch",
      attentionCode: "fact_not_bound",
    });
  });

  it("refuses an amount that differs by one minor unit either way", () => {
    for (const amount of [124_999, 125_001]) {
      expect(
        bindFact(fact({ amount: uah(amount), finalAmount: uah(amount) }), attempt),
        String(amount),
      ).toEqual({ ok: false, reason: "amount_mismatch", attentionCode: "amount_mismatch" });
    }
  });

  it("refuses another currency with the same number", () => {
    expect(
      bindFact(
        fact({
          amount: { amount: 125_000, currency: "USD" },
          finalAmount: { amount: 125_000, currency: "USD" },
        }),
        attempt,
      ),
    ).toEqual({ ok: false, reason: "currency_mismatch", attentionCode: "amount_mismatch" });
  });

  it("refuses a succeeded fact whose final amount is neither the amount nor the amount less its refunds", () => {
    expect(bindFact(fact({ finalAmount: uah(124_999) }), attempt)).toEqual({
      ok: false,
      reason: "final_amount_mismatch",
      attentionCode: "amount_mismatch",
    });
    expect(bindFact(fact({ finalAmount: uah(125_001) }), attempt).ok).toBe(false);
    expect(bindFact(fact({ finalAmount: null }), attempt).ok).toBe(true);
    // A failed or expired fact may carry any final amount (nothing was taken).
    expect(bindFact(fact({ status: "failed", finalAmount: uah(0) }), attempt).ok).toBe(true);
  });

  it("accepts a succeeded fact whose final amount is lowered by its succeeded refunds (ADR 0032 open question 6)", () => {
    const refunded = fact({
      finalAmount: uah(115_000),
      refunds: [refund(10_000, "succeeded"), refund(5_000, "failed")],
    });
    expect(bindFact(refunded, attempt).ok).toBe(true);
    expect(
      bindFact({ ...refunded, finalAmount: uah(110_000) }, attempt),
      "the failed refund does not lower it",
    ).toEqual({ ok: false, reason: "final_amount_mismatch", attentionCode: "amount_mismatch" });
    // The provider may also keep the original amount as the final amount.
    expect(bindFact({ ...refunded, finalAmount: uah(125_000) }, attempt).ok).toBe(true);
  });

  it("refuses refunds that add up to more than the amount", () => {
    expect(
      bindFact(
        fact({ refunds: [refund(100_000, "succeeded"), refund(25_000, "processing")] }),
        attempt,
      ).ok,
    ).toBe(true);
    expect(
      bindFact(
        fact({ refunds: [refund(100_000, "succeeded"), refund(25_001, "processing")] }),
        attempt,
      ),
    ).toEqual({ ok: false, reason: "refunds_exceed_amount", attentionCode: "amount_mismatch" });
    expect(
      bindFact(fact({ refunds: [refund(125_000, "succeeded"), refund(125_000, "failed")] }), {
        ...attempt,
      }).ok,
    ).toBe(true);
  });

  it("checks the reference first, then the provider id, then currency and amount", () => {
    expect(
      bindFact(
        fact({ reference: OTHER_PAYMENT_ID, providerPaymentId: "p2_other", amount: uah(1) }),
        attempt,
      ),
    ).toMatchObject({ reason: "reference_mismatch" });
    expect(
      bindFact(fact({ providerPaymentId: "p2_other", amount: uah(1) }), attempt),
    ).toMatchObject({ reason: "provider_payment_id_mismatch" });
  });

  it("throws on a malformed fact or attempt (the API validates the fact first)", () => {
    expect(() => bindFact({ ...fact(), amount: uah(-1) }, attempt)).toThrow(RangeError);
    expect(() => bindFact(fact(), { ...attempt, id: "not-a-uuid" })).toThrow(RangeError);
    expect(() => bindFact(fact(), { ...attempt, amount: uah(0) })).toThrow(RangeError);
  });
});
