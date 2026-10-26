import { describe, expect, it } from "vitest";
import type { OrderStatus } from "../orders/status.js";
import {
  decideNewPaymentAttempt,
  decideOrderPaymentGuard,
  paymentStatusAfterCreate,
  type AttemptSummary,
} from "./attempt.js";
import { paymentProviderFailure, paymentProviderOk } from "./provider-port.js";
import type { PaymentStatus } from "./status.js";
import { MINUTE, OTHER_PAYMENT_ID, PAYMENT_ID, plusMs } from "./test-support.js";

const now = new Date("2026-10-26T10:00:00.000Z");
const orderExpiresAt = plusMs(now, 30 * MINUTE);
const a = (status: PaymentStatus, id = PAYMENT_ID): AttemptSummary => ({ id, status });

function create(
  attempts: AttemptSummary[],
  orderStatus: OrderStatus = "awaiting_payment",
  providerAvailable = true,
  expiresAt = orderExpiresAt,
) {
  return decideNewPaymentAttempt({
    orderStatus,
    attempts,
    providerAvailable,
    now,
    orderExpiresAt: expiresAt,
  });
}

describe("decideNewPaymentAttempt (ADR 0032 decision 6)", () => {
  it("allows a first attempt with the invoice validity", () => {
    expect(create([])).toEqual({
      ok: true,
      invalidate: [],
      expiresAt: plusMs(now, 27 * MINUTE),
      validitySeconds: 27 * 60,
    });
  });

  it("closes an open (awaiting_customer) attempt: at most one live attempt per order", () => {
    expect(create([a("awaiting_customer"), a("failed", OTHER_PAYMENT_ID)])).toMatchObject({
      ok: true,
      invalidate: [PAYMENT_ID],
    });
  });

  it("refuses while an attempt is processing, being created or create_unknown (never retried)", () => {
    for (const status of ["processing", "creating", "create_unknown"] as const) {
      expect(create([a(status)]), status).toEqual({ ok: false, rule: "payment_in_progress" });
    }
  });

  it("allows a new attempt after failed, expired or invalidated ones", () => {
    expect(create([a("failed"), a("expired"), a("invalidated")])).toMatchObject({ ok: true });
  });

  it("refuses an order that is not awaiting payment, also one already paid by an attempt", () => {
    for (const status of ["paid", "fulfilled", "cancelled", "expired"] as const) {
      expect(create([], status), status).toEqual({ ok: false, rule: "order_not_payable" });
    }
    expect(create([a("succeeded")], "awaiting_payment")).toEqual({
      ok: false,
      rule: "order_not_payable",
    });
  });

  it("refuses a window shorter than 5 minutes and when no provider takes the currency", () => {
    expect(create([], "awaiting_payment", true, plusMs(now, 8 * MINUTE - 1))).toEqual({
      ok: false,
      rule: "payment_window_too_short",
    });
    expect(create([], "awaiting_payment", false)).toEqual({
      ok: false,
      rule: "payment_not_available",
    });
  });

  it("checks in the ADR's order: not payable, in progress, window, not available", () => {
    expect(create([a("processing")], "cancelled", false, now)).toMatchObject({
      rule: "order_not_payable",
    });
    expect(create([a("processing")], "awaiting_payment", false, now)).toMatchObject({
      rule: "payment_in_progress",
    });
    expect(create([], "awaiting_payment", false, now)).toMatchObject({
      rule: "payment_window_too_short",
    });
  });
});

describe("decideOrderPaymentGuard (cancel and manual mark paid, ADR 0032 decision 10)", () => {
  it("refuses while an attempt is processing, being created or create_unknown", () => {
    for (const status of ["processing", "creating", "create_unknown"] as const) {
      expect(
        decideOrderPaymentGuard([a("awaiting_customer", OTHER_PAYMENT_ID), a(status)]),
        status,
      ).toEqual({
        ok: false,
        rule: "payment_in_progress",
      });
    }
  });

  it("invalidates an open attempt and allows the cancel or mark paid", () => {
    expect(
      decideOrderPaymentGuard([a("awaiting_customer"), a("failed", OTHER_PAYMENT_ID)]),
    ).toEqual({
      ok: true,
      invalidate: [PAYMENT_ID],
    });
    expect(decideOrderPaymentGuard([])).toEqual({ ok: true, invalidate: [] });
    expect(decideOrderPaymentGuard([a("succeeded"), a("expired")])).toEqual({
      ok: true,
      invalidate: [],
    });
  });

  it("throws on an unknown status", () => {
    expect(() => decideOrderPaymentGuard([a("paid" as PaymentStatus)])).toThrow(RangeError);
  });
});

describe("paymentStatusAfterCreate (decision 6 step 4; create_unknown is never retried)", () => {
  it("ok -> awaiting_customer", () => {
    expect(
      paymentStatusAfterCreate(
        paymentProviderOk({ providerPaymentId: "p2_x", redirectUrl: "https://pay.example/x" }),
      ),
    ).toEqual({ status: "awaiting_customer", failureCode: null });
  });

  it("a refusal that proves nothing was created -> failed with the first code (the shopper may retry)", () => {
    for (const reason of ["rejected", "misconfigured", "not_sent", "rate_limited"] as const) {
      expect(
        paymentStatusAfterCreate(paymentProviderFailure(reason, { providerCodes: ["1077"] })),
        reason,
      ).toEqual({ status: "failed", failureCode: "1077" });
    }
    expect(paymentStatusAfterCreate(paymentProviderFailure("rejected"))).toEqual({
      status: "failed",
      failureCode: "rejected",
    });
  });

  it("an answer that may have created an invoice -> create_unknown", () => {
    for (const reason of [
      "unavailable",
      "not_found",
      "not_cancellable",
      "invalid_signature",
    ] as const) {
      expect(paymentStatusAfterCreate(paymentProviderFailure(reason)), reason).toEqual({
        status: "create_unknown",
        failureCode: null,
      });
    }
  });
});
