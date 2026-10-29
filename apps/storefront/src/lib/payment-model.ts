import type {
  CreatedPayment,
  Order,
  OrderPayment,
  ShopperPaymentFailureCategory,
  ShopperPaymentStatus,
  StoreResult,
} from "@fluxkit/api-client";
import { failureFromResult, failureFromThrown, type Failure } from "./failure";
import { providerRedirectUrl } from "./payment-redirect";

/**
 * What the pages derive from the payment answers of the API (ADR 0032, plan step 9). Pure.
 *
 * Shopper words only: the statuses are the API's five (`waiting`, `processing`, `paid`, `failed`, `expired`) with the four
 * failure categories. A provider status, code, id or text never reaches this code (the API does not send them).
 */

/**
 * The wait shown when a `503 payment_provider_unavailable` carries no usable `Retry-After`. The API always sends one (at
 * least 30 seconds, `docs/api/payments.md`); this only keeps the page honest if a proxy strips the header.
 */
export const DEFAULT_WAIT_SECONDS = 30;

export function paymentStatusKey(status: ShopperPaymentStatus): string {
  return ["waiting", "processing", "paid", "failed", "expired"].includes(status)
    ? `payment.status.${status}`
    : "payment.status.unknown";
}

/** The explanation of a `failed` or `expired` attempt; a missing or unknown category is the technical-problem text. */
export function paymentFailureKey(category: ShopperPaymentFailureCategory | null): string {
  return category !== null && ["declined", "expired", "technical", "not_accepted"].includes(category)
    ? `payment.failure.${category}`
    : "payment.failure.technical";
}

// ------------------------------------------------------------------ the outcome of "Pay now"

/**
 * What the page does with the answer of a create route. `attempt` says what happens to the idempotency key: "clear" (the API
 * answered definitively, the next "Pay now" is a new payment) or "keep" (the answer may have been lost: the same request
 * must find the attempt the API may already have made, never create a second one).
 */
export type PayOutcome =
  /** Navigate to the provider's page (a safe https URL from the answer). */
  | { kind: "redirect"; attempt: "clear"; url: string; paymentId: string }
  /** The attempt exists but has no page the shopper can use (missing or unsafe URL, or already failed or expired). */
  | { kind: "noPage"; attempt: "clear" }
  /** The answer is an attempt that is already processing or paid: the status page shows what happens next. */
  | { kind: "processing"; attempt: "clear"; paymentId: string }
  /** `409 payment_in_progress`: a payment is processing, or an earlier create's answer was lost. */
  | { kind: "paymentInProgress"; attempt: "clear" }
  /** `409 order_not_payable`: the order was paid, cancelled or expired meanwhile; the page reads it again. */
  | { kind: "notPayable"; attempt: "clear" }
  /** `409 payment_not_available` / `payment_window_too_short`: online payment cannot be started for this order now. */
  | { kind: "unavailable"; attempt: "clear" }
  /**
   * `503 payment_provider_unavailable`. `canRetry` true: the provider refused or was throttled, a new attempt is accepted
   * (after `waitSeconds`). `canRetry` false: the provider's answer was lost; wait (the countdown) and read the status,
   * never start another attempt.
   */
  | {
      kind: "providerUnavailable";
      attempt: "clear" | "keep";
      canRetry: boolean;
      waitSeconds: number;
      paymentId: string;
    }
  | { kind: "rateLimited"; attempt: "keep"; failure: Failure }
  | { kind: "signedOut"; attempt: "clear" }
  /** One state for every "no": unknown or malformed number, wrong or expired token, another customer's order. */
  | { kind: "notFound"; attempt: "clear" }
  | { kind: "keyReused"; attempt: "clear" }
  /** A network failure, a timeout or a 5xx: the attempt may exist, the same request may be sent again. */
  | { kind: "retry"; attempt: "keep"; failure: Failure }
  | { kind: "failed"; attempt: "keep"; failure: Failure };

export type PayAnswer = StoreResult<CreatedPayment> | { thrown: unknown };

export function createPaymentOutcome(answer: PayAnswer): PayOutcome {
  if ("thrown" in answer) {
    return { kind: "retry", attempt: "keep", failure: failureFromThrown(answer.thrown) };
  }
  if (answer.ok) {
    const { data } = answer;
    if (data.status === "waiting") {
      // The URL is the API's, and still checked: the browser must never be sent anywhere but an https page.
      const url = providerRedirectUrl(data.redirectUrl);
      return url === null
        ? { kind: "noPage", attempt: "clear" }
        : { kind: "redirect", attempt: "clear", url, paymentId: data.paymentId };
    }
    if (data.status === "processing" || data.status === "paid") {
      return { kind: "processing", attempt: "clear", paymentId: data.paymentId };
    }
    return { kind: "noPage", attempt: "clear" };
  }
  const failure = failureFromResult(answer);
  const { problem, status } = answer;
  if (status === 429) return { kind: "rateLimited", attempt: "keep", failure };
  if (status === 401) return { kind: "signedOut", attempt: "clear" };
  if (status === 404 || status === 400) return { kind: "notFound", attempt: "clear" };
  if (status === 503 && problem.code === "payment_provider_unavailable") {
    if (problem.payment !== undefined) {
      const { canRetry, paymentId } = problem.payment;
      return {
        kind: "providerUnavailable",
        // A refused create left a failed attempt: its key must not be replayed. A lost answer keeps the key.
        attempt: canRetry ? "clear" : "keep",
        canRetry,
        waitSeconds: failure.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS,
        paymentId,
      };
    }
    return { kind: "retry", attempt: "keep", failure };
  }
  // A 5xx (a 503 deadlock retry, a 500) may or may not have committed: only the same key can find out, so keep it.
  if (status >= 500) return { kind: "retry", attempt: "keep", failure };
  if (status === 409) {
    if (problem.code === "idempotency_key_reused") return { kind: "keyReused", attempt: "clear" };
    if (problem.code === "rule_violation") {
      switch (problem.rule) {
        case "payment_in_progress":
          return { kind: "paymentInProgress", attempt: "clear" };
        case "order_not_payable":
          return { kind: "notPayable", attempt: "clear" };
        case "payment_not_available":
        case "payment_window_too_short":
          return { kind: "unavailable", attempt: "clear" };
        default:
          break;
      }
    }
  }
  return { kind: "failed", attempt: "keep", failure };
}

/** Whole seconds until `untilMs` (never negative). The wait of a 503 is shown as a countdown from this. */
export function secondsLeft(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

// ------------------------------------------------------------------ the payment section of an order page

export type PaymentAction =
  /** Start a new payment attempt ("Pay now" / "Try again"). */
  | "pay"
  /** Open the provider's page of the attempt that waits (no new attempt). */
  | "continue"
  /** The attempt is processing: link to the status page. */
  | "checkStatus"
  | "none";

export interface PaymentSectionModel {
  action: PaymentAction;
  status: ShopperPaymentStatus | null;
  failureCategory: ShopperPaymentFailureCategory | null;
  /** The end of the latest invoice. */
  expiresAt: string | null;
  /** A checked https URL, only for `continue`. */
  continueUrl: string | null;
  /** The latest attempt, for the status page link and the hand-off. */
  paymentId: string | null;
}

/**
 * What the order page shows about online payment, or `null` to keep the old wording ("the shop will contact you"): when the
 * shop has no online payment (`onlinePayment` false), or this order cannot be paid online and has no attempt to show.
 */
export function paymentSection(
  order: Pick<Order, "status" | "payment">,
  onlinePayment: boolean,
): PaymentSectionModel | null {
  const payment: OrderPayment = order.payment;
  const { latest } = payment;
  if (!onlinePayment) return null;
  if (payment.providers.length === 0 && latest === null && !payment.canPay) return null;
  const open = order.status === "awaiting_payment";
  const continueUrl =
    open && latest !== null && latest.status === "waiting"
      ? providerRedirectUrl(latest.redirectUrl)
      : null;
  let action: PaymentAction = "none";
  if (open) {
    if (continueUrl !== null) action = "continue";
    else if (payment.canPay) action = "pay";
    else if (latest !== null && latest.status === "processing") action = "checkStatus";
  }
  return {
    action,
    status: latest?.status ?? null,
    failureCategory: latest?.failureCategory ?? null,
    expiresAt: latest?.expiresAt ?? null,
    continueUrl,
    paymentId: latest?.paymentId ?? null,
  };
}
