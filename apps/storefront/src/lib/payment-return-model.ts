import type { PaymentWatchState } from "./payment-poll";
import { paymentFailureKey } from "./payment-model";

/**
 * What the return page says and offers in each state of its watch (ADR 0032 decision 6, plan step 9). Pure: the view renders
 * a description, the tests check every state. Everything comes from the API's answers (`PaymentWatchState`); the address bar
 * and the shopper's storage decide only WHICH attempt is asked about, never what is shown.
 */

export type ReturnAction =
  /** The order page of this attempt (for a guest, with the token from the hand-off). */
  | "backToOrder"
  /** The order page, worded as a new payment: the "Pay now" of that page starts it. */
  | "tryAgain"
  | "checkAgain"
  | "signIn"
  | "home"
  | "accountOrders";

export interface ReturnPresentation {
  titleKey: string;
  bodyKey: string | null;
  tone: "info" | "success" | "warning" | "danger";
  /** The watch is still reading: the view shows a spinner and `aria-busy`. */
  busy: boolean;
  actions: ReturnAction[];
}

export type ReturnState = PaymentWatchState | "noEntry";

export function returnPresentation(state: ReturnState): ReturnPresentation {
  if (state === "noEntry") {
    return {
      titleKey: "payment.return.noEntry.title",
      bodyKey: "payment.return.noEntry.body",
      tone: "info",
      busy: false,
      actions: ["accountOrders", "home"],
    };
  }
  switch (state.phase) {
    case "loading":
      return {
        titleKey: "payment.return.checking",
        bodyKey: null,
        tone: "info",
        busy: true,
        actions: ["backToOrder"],
      };
    case "watching":
      return state.payment.status === "processing"
        ? {
            titleKey: "payment.return.processing.title",
            bodyKey: "payment.return.processing.body",
            tone: "info",
            busy: true,
            actions: ["backToOrder"],
          }
        : {
            titleKey: "payment.return.waiting.title",
            bodyKey: "payment.return.waiting.body",
            tone: "info",
            busy: true,
            actions: ["backToOrder"],
          };
    case "final": {
      const { payment } = state;
      if (payment.status === "paid") {
        return {
          titleKey: "payment.return.paid.title",
          bodyKey: "payment.return.paid.body",
          tone: "success",
          busy: false,
          actions: ["backToOrder"],
        };
      }
      // `not_accepted`: the money arrived but the order could not take it; a new payment is not the answer.
      const retry = payment.canRetry && payment.failureCategory !== "not_accepted";
      return {
        titleKey:
          payment.status === "expired"
            ? "payment.return.expired.title"
            : "payment.return.failed.title",
        bodyKey: paymentFailureKey(
          payment.failureCategory ?? (payment.status === "expired" ? "expired" : null),
        ),
        tone: payment.status === "expired" ? "warning" : "danger",
        busy: false,
        actions: [retry ? "tryAgain" : "backToOrder"],
      };
    }
    case "timedOut":
      return {
        titleKey: "payment.return.timedOut.title",
        bodyKey: "payment.return.timedOut.body",
        tone: "warning",
        busy: false,
        actions: ["checkAgain", "backToOrder"],
      };
    case "error":
      return {
        titleKey: "payment.return.error.title",
        bodyKey: null,
        tone: "danger",
        busy: false,
        actions: ["checkAgain", "backToOrder"],
      };
    case "notFound":
      return {
        titleKey: "payment.return.notFound.title",
        bodyKey: "payment.return.notFound.body",
        tone: "info",
        busy: false,
        actions: ["home"],
      };
    case "signedOut":
      return {
        titleKey: "payment.return.signedOut.title",
        bodyKey: "payment.return.signedOut",
        tone: "info",
        busy: false,
        actions: ["signIn"],
      };
  }
}
