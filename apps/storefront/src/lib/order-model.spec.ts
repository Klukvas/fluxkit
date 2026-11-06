import type {
  Order,
  ShopperPaymentFailureCategory,
  ShopperPaymentStatus,
} from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, orderPaymentSection } from "./order-model";
import { paymentSection } from "./payment-model";

// UX round 2 (batch 3A item 4): the page of a CANCELLED order still said "The payment link has expired. Start a new payment".
// The order pages show the payment block only where the order's status makes it true. One exception on a closed order
// (review M1 of PR 234): a captured payment the order could not accept (`failed` + `not_accepted`, core `payments/shopper.ts`)
// keeps its explanation, the only notice the shopper gets that money arrived and is refunded or settled by the shop.

const latest = (
  status: ShopperPaymentStatus,
  failureCategory: ShopperPaymentFailureCategory | null,
) => ({
  paymentId: "0b5d3c1e-6f0a-4a43-9a43-0a5d0b5f4a11",
  status,
  failureCategory,
  expiresAt: "2026-11-06T12:00:00.000Z",
  redirectUrl: status === "waiting" ? "https://pay.example.com/i/1" : null,
});

/** A failed attempt takes the given category (`declined` unless said otherwise); every other status has none. */
function order(
  status: Order["status"],
  attempt: ShopperPaymentStatus | null,
  canPay = false,
  failureCategory: ShopperPaymentFailureCategory = "declined",
): Pick<Order, "status" | "payment"> {
  return {
    status,
    payment: {
      canPay,
      providers: ["fake"],
      latest:
        attempt === null ? null : latest(attempt, attempt === "failed" ? failureCategory : null),
    },
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

const CATEGORIES: ShopperPaymentFailureCategory[] = [
  "declined",
  "expired",
  "technical",
  "not_accepted",
];

const CLOSED = ["cancelled", "expired", "paid", "fulfilled"] as const;

describe("orderPaymentSection: the payment block per order status", () => {
  it("shows nothing on a cancelled or an expired order for any other attempt (and even if the answer says canPay)", () => {
    for (const status of ["cancelled", "expired"] as const) {
      for (const attempt of ATTEMPTS) {
        for (const category of CATEGORIES.filter((entry) => entry !== "not_accepted")) {
          expect(
            orderPaymentSection(order(status, attempt, true, category), true),
            `${status} ${String(attempt)} ${category}`,
          ).toBeNull();
        }
      }
    }
  });

  it("shows a paid or fulfilled order's paid attempt as a confirmation, never an older declined, expired or waiting one", () => {
    for (const status of ["paid", "fulfilled"] as const) {
      expect(orderPaymentSection(order(status, "paid"), true)).toMatchObject({
        action: "none",
        status: "paid",
      });
      for (const attempt of [null, "waiting", "processing", "failed", "expired"] as const) {
        for (const category of CATEGORIES.filter((entry) => entry !== "not_accepted")) {
          expect(
            orderPaymentSection(order(status, attempt, false, category), true),
            `${status} ${String(attempt)} ${category}`,
          ).toBeNull();
        }
      }
    }
  });

  it("keeps the 'payment arrived but the order could not accept it' notice on every closed order, with no action (review M1)", () => {
    for (const status of CLOSED) {
      expect(
        orderPaymentSection(order(status, "failed", true, "not_accepted"), true),
        status,
      ).toEqual({
        action: "none",
        status: "failed",
        failureCategory: "not_accepted",
        expiresAt: "2026-11-06T12:00:00.000Z",
        continueUrl: null,
        paymentId: "0b5d3c1e-6f0a-4a43-9a43-0a5d0b5f4a11",
      });
    }
  });

  it("leaves an order awaiting payment exactly as the payment model decides (pay, continue, check, failed or expired attempt)", () => {
    for (const attempt of ATTEMPTS) {
      for (const canPay of [true, false]) {
        for (const category of CATEGORIES) {
          const subject = order("awaiting_payment", attempt, canPay, category);
          expect(orderPaymentSection(subject, true), `${String(attempt)} ${category}`).toEqual(
            paymentSection(subject, true),
          );
        }
      }
    }
  });

  it("shows nothing without online payment, in every status", () => {
    for (const status of ORDER_STATUSES) {
      expect(orderPaymentSection(order(status, "paid", true), false)).toBeNull();
      expect(orderPaymentSection(order(status, "failed", true, "not_accepted"), false)).toBeNull();
    }
  });
});
