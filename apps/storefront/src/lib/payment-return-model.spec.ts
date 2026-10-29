import type { PaymentState, ShopperPaymentFailureCategory, ShopperPaymentStatus } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { returnPresentation } from "./payment-return-model";
import type { PaymentWatchState } from "./payment-poll";

const ID = "6f1c1d8e-5f0a-4f6e-9a0b-0c2f4b7d1a11";

function payment(
  status: ShopperPaymentStatus,
  over: Partial<PaymentState> = {},
): PaymentState {
  return {
    paymentId: ID,
    status,
    failureCategory: null,
    expiresAt: "2026-10-29T12:00:00.000Z",
    orderStatus: "awaiting_payment",
    canRetry: false,
    ...over,
  };
}

const present = (state: PaymentWatchState) => returnPresentation(state);

describe("returnPresentation: one description per state of the return page", () => {
  it("loading: a busy checking message, no actions that could mislead", () => {
    expect(present({ phase: "loading" })).toMatchObject({
      titleKey: "payment.return.checking",
      busy: true,
      actions: ["backToOrder"],
    });
  });

  it("waiting and processing keep polling: a busy state with the order link", () => {
    expect(present({ phase: "watching", payment: payment("waiting") })).toMatchObject({
      titleKey: "payment.return.waiting.title",
      bodyKey: "payment.return.waiting.body",
      busy: true,
      tone: "info",
      actions: ["backToOrder"],
    });
    expect(present({ phase: "watching", payment: payment("processing") })).toMatchObject({
      titleKey: "payment.return.processing.title",
      bodyKey: "payment.return.processing.body",
      busy: true,
    });
  });

  it("paid is final and offers the way back to the order", () => {
    expect(
      present({ phase: "final", payment: payment("paid", { orderStatus: "paid" }) }),
    ).toMatchObject({
      titleKey: "payment.return.paid.title",
      bodyKey: "payment.return.paid.body",
      busy: false,
      tone: "success",
      actions: ["backToOrder"],
    });
  });

  it.each([
    ["declined", true, ["tryAgain"]],
    ["technical", true, ["tryAgain"]],
    ["declined", false, ["backToOrder"]],
    ["not_accepted", true, ["backToOrder"]],
  ] as [ShopperPaymentFailureCategory, boolean, string[]][])(
    "failed (%s, canRetry %s) says why and offers %j",
    (failureCategory, canRetry, actions) => {
      const view = present({ phase: "final", payment: payment("failed", { failureCategory, canRetry }) });
      expect(view).toMatchObject({
        titleKey: "payment.return.failed.title",
        bodyKey: `payment.failure.${failureCategory}`,
        tone: "danger",
        busy: false,
        actions,
      });
    },
  );

  it("expired explains the link and offers a new payment when the API allows one", () => {
    expect(
      present({ phase: "final", payment: payment("expired", { failureCategory: "expired", canRetry: true }) }),
    ).toMatchObject({
      titleKey: "payment.return.expired.title",
      bodyKey: "payment.failure.expired",
      actions: ["tryAgain"],
    });
    expect(present({ phase: "final", payment: payment("expired") })).toMatchObject({
      bodyKey: "payment.failure.expired",
      actions: ["backToOrder"],
    });
  });

  it("timedOut says the order updates by itself and offers another check", () => {
    expect(present({ phase: "timedOut", payment: payment("processing") })).toMatchObject({
      titleKey: "payment.return.timedOut.title",
      bodyKey: "payment.return.timedOut.body",
      busy: false,
      tone: "warning",
      actions: ["checkAgain", "backToOrder"],
    });
  });

  it("error, notFound, signedOut and noEntry each have their own state", () => {
    expect(
      present({
        phase: "error",
        failure: { messageKey: "errors.network", status: null, code: null, retryAfterSeconds: null, fieldErrors: [] },
        last: null,
      }),
    ).toMatchObject({ titleKey: "payment.return.error.title", tone: "danger", actions: ["checkAgain", "backToOrder"] });
    expect(present({ phase: "notFound" })).toMatchObject({
      titleKey: "payment.return.notFound.title",
      bodyKey: "payment.return.notFound.body",
      actions: ["home"],
    });
    expect(present({ phase: "signedOut" })).toMatchObject({
      bodyKey: "payment.return.signedOut",
      actions: ["signIn"],
    });
    expect(returnPresentation("noEntry")).toMatchObject({
      titleKey: "payment.return.noEntry.title",
      bodyKey: "payment.return.noEntry.body",
      actions: ["accountOrders", "home"],
    });
  });

  it("never offers a way back to an order the page does not know (noEntry, notFound)", () => {
    for (const state of ["noEntry", { phase: "notFound" }] as const) {
      expect(returnPresentation(state).actions).not.toContain("backToOrder");
    }
  });
});
