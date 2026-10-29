import { describe, expect, it } from "vitest";
import { PAYMENT_ORDER_OUTCOMES } from "./outcome.js";
import {
  SHOPPER_PAYMENT_FAILURE_CATEGORIES,
  SHOPPER_PAYMENT_STATUSES,
  shopperPaymentStatus,
} from "./shopper.js";
import { PAYMENT_STATUSES } from "./status.js";

const base = { hasInvoice: true, failureCode: null, orderOutcome: null } as const;

describe("shopperPaymentStatus (the store's small view of an attempt, ADR 0032 decision 6)", () => {
  it("lists the shopper statuses and failure categories", () => {
    expect(SHOPPER_PAYMENT_STATUSES).toEqual([
      "waiting",
      "processing",
      "paid",
      "failed",
      "expired",
    ]);
    expect(SHOPPER_PAYMENT_FAILURE_CATEGORIES).toEqual([
      "declined",
      "expired",
      "technical",
      "not_accepted",
    ]);
    expect(Object.isFrozen(SHOPPER_PAYMENT_STATUSES)).toBe(true);
    expect(Object.isFrozen(SHOPPER_PAYMENT_FAILURE_CATEGORIES)).toBe(true);
  });

  it("waits for the shopper only while the provider page is open", () => {
    expect(shopperPaymentStatus({ ...base, status: "awaiting_customer" })).toEqual({
      status: "waiting",
      failureCategory: null,
    });
  });

  it("says processing while our create call or the provider is still working, also when the create answer was lost", () => {
    for (const status of ["creating", "processing", "create_unknown"] as const) {
      expect(shopperPaymentStatus({ ...base, status, hasInvoice: false }), status).toEqual({
        status: "processing",
        failureCategory: null,
      });
    }
  });

  it("says paid only when the order took the payment (applied or already paid by this attempt)", () => {
    for (const orderOutcome of ["applied", "already_paid"] as const) {
      expect(shopperPaymentStatus({ ...base, status: "succeeded", orderOutcome })).toEqual({
        status: "paid",
        failureCategory: null,
      });
    }
  });

  it("never says paid for a success the order could not take (late, duplicate, amount mismatch)", () => {
    for (const orderOutcome of [
      "order_not_payable",
      "reference_conflict",
      "amount_mismatch",
    ] as const) {
      expect(
        shopperPaymentStatus({ ...base, status: "succeeded", orderOutcome }),
        orderOutcome,
      ).toEqual({
        status: "failed",
        failureCategory: "not_accepted",
      });
    }
  });

  it("treats a succeeded attempt without an outcome as paid (the outcome is written in the same transaction)", () => {
    expect(shopperPaymentStatus({ ...base, status: "succeeded", orderOutcome: null })).toEqual({
      status: "paid",
      failureCategory: null,
    });
  });

  it("calls a failure declined when the provider reported it on an invoice, technical when no invoice was made", () => {
    expect(shopperPaymentStatus({ ...base, status: "failed", failureCode: "59" })).toEqual({
      status: "failed",
      failureCategory: "declined",
    });
    expect(
      shopperPaymentStatus({
        ...base,
        status: "failed",
        hasInvoice: false,
        failureCode: "rejected",
      }),
    ).toEqual({ status: "failed", failureCategory: "technical" });
    // A create_unknown attempt closed by job 11 (it may have an invoice id learnt late; nobody saw its page).
    expect(
      shopperPaymentStatus({ ...base, status: "failed", failureCode: "create_unknown" }),
    ).toEqual({ status: "failed", failureCategory: "technical" });
  });

  it("calls an expired or replaced invoice expired", () => {
    for (const status of ["expired", "invalidated"] as const) {
      expect(shopperPaymentStatus({ ...base, status }), status).toEqual({
        status: "expired",
        failureCategory: "expired",
      });
    }
  });

  it("answers a known shopper status for every attempt status and outcome", () => {
    for (const status of PAYMENT_STATUSES) {
      for (const orderOutcome of [null, ...PAYMENT_ORDER_OUTCOMES]) {
        for (const hasInvoice of [true, false]) {
          const view = shopperPaymentStatus({
            status,
            orderOutcome,
            hasInvoice,
            failureCode: null,
          });
          expect(SHOPPER_PAYMENT_STATUSES).toContain(view.status);
          expect(view.failureCategory === null).toBe(
            view.status !== "failed" && view.status !== "expired",
          );
        }
      }
    }
  });

  it("refuses an unknown status (corrupt data)", () => {
    expect(() =>
      shopperPaymentStatus({ ...base, status: "paid" as unknown as "succeeded" }),
    ).toThrow(RangeError);
  });
});
