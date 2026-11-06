import type { Order, ShopperPaymentStatus } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, orderPaymentSection } from "./order-model";
import { paymentSection } from "./payment-model";

// UX round 2 (batch 3A item 4): the page of a CANCELLED order still said "The payment link has expired. Start a new payment".
// The order pages show the payment block only where the order's status makes it true.

const latest = (status: ShopperPaymentStatus) => ({
  paymentId: "0b5d3c1e-6f0a-4a43-9a43-0a5d0b5f4a11",
  status,
  failureCategory: status === "failed" ? ("declined" as const) : null,
  expiresAt: "2026-11-06T12:00:00.000Z",
  redirectUrl: status === "waiting" ? "https://pay.example.com/i/1" : null,
});

function order(
  status: Order["status"],
  attempt: ShopperPaymentStatus | null,
  canPay = false,
): Pick<Order, "status" | "payment"> {
  return {
    status,
    payment: { canPay, providers: ["fake"], latest: attempt === null ? null : latest(attempt) },
  };
}

const ATTEMPTS: (ShopperPaymentStatus | null)[] = [
  null,
  "waiting",
  "processing",
  "paid",
  "failed",
  "expired",
];

describe("orderPaymentSection: the payment block per order status", () => {
  it("shows nothing at all on a cancelled or an expired order, whatever its last attempt (and even if the answer says canPay)", () => {
    for (const status of ["cancelled", "expired"] as const) {
      for (const attempt of ATTEMPTS) {
        expect(
          orderPaymentSection(order(status, attempt, true), true),
          `${status} ${String(attempt)}`,
        ).toBeNull();
      }
    }
  });

  it("shows a paid or fulfilled order's paid attempt as a confirmation, never an older failed or expired one", () => {
    for (const status of ["paid", "fulfilled"] as const) {
      expect(orderPaymentSection(order(status, "paid"), true)).toMatchObject({
        action: "none",
        status: "paid",
      });
      for (const attempt of [null, "waiting", "processing", "failed", "expired"] as const) {
        expect(
          orderPaymentSection(order(status, attempt), true),
          `${status} ${String(attempt)}`,
        ).toBeNull();
      }
    }
  });

  it("leaves an order awaiting payment exactly as the payment model decides (pay, continue, check, failed or expired attempt)", () => {
    for (const attempt of ATTEMPTS) {
      for (const canPay of [true, false]) {
        const subject = order("awaiting_payment", attempt, canPay);
        expect(orderPaymentSection(subject, true), String(attempt)).toEqual(
          paymentSection(subject, true),
        );
      }
    }
  });

  it("shows nothing without online payment, in every status", () => {
    for (const status of ORDER_STATUSES) {
      expect(orderPaymentSection(order(status, "paid", true), false)).toBeNull();
    }
  });
});
