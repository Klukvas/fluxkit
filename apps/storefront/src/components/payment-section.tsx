import { Alert, Badge, Button, type BadgeVariant, type Locale, type Translator } from "@fluxkit/ui";
import { formatDateTime } from "../lib/date";
import { failureText } from "../lib/failure";
import {
  paymentFailureKey,
  paymentStatusKey,
  secondsLeft,
  type PaymentSectionModel,
  type PayOutcome,
} from "../lib/payment-model";
import type { PayState } from "../lib/payment-store";

/**
 * The payment section of an order page (ADR 0032, plan step 9): the status of the latest attempt in words (never colour
 * alone), the button that starts or continues a payment, and the messages of a refused start. Pure: state and handlers in,
 * markup out, so the states are tested without a browser. Ids are fixed because the focus follows the steps
 * (`PAYMENT_FOCUS_IDS`): a refused start moves the focus to the message, which is also announced.
 *
 * Words only through message keys; only tokens for colour (the `Badge` and `Alert` of the UI library).
 */

export const PAYMENT_FOCUS_IDS = {
  message: "order-payment-message",
  action: "order-payment-action",
} as const;

const STATUS_BADGE: Record<string, BadgeVariant> = {
  waiting: "warning",
  processing: "warning",
  paid: "success",
  failed: "danger",
  expired: "neutral",
};

export interface PaymentSectionViewProps {
  t: Translator;
  locale: Locale;
  model: PaymentSectionModel;
  /** The order's own deadline (`order.expiresAt`). */
  orderExpiresAt: string;
  pay: PayState;
  /** The clock for the countdown, epoch milliseconds. */
  now: number;
  onPay: () => void;
  onContinue: (url: string, paymentId: string) => void;
  onCheckStatus: (paymentId: string) => void;
}

/** The text of a refused or lost start, from its outcome. */
export function payOutcomeText(t: Translator, outcome: PayOutcome): string {
  switch (outcome.kind) {
    case "noPage":
      return t("payment.error.noPage");
    case "processing":
      return t("payment.error.processing");
    case "paymentInProgress":
      return t("payment.error.paymentInProgress");
    case "notPayable":
      return t("payment.error.notPayable");
    case "unavailable":
      return t("payment.error.unavailable");
    case "providerUnavailable":
      return outcome.canRetry ? t("payment.error.providerRetry") : t("payment.error.providerWait");
    case "keyReused":
      return t("payment.error.keyReused");
    case "signedOut":
      return t("errors.unauthorized");
    case "notFound":
      return t("order.notFound.description");
    case "rateLimited":
    case "retry":
    case "failed":
      return failureText(t, outcome.failure);
    case "redirect":
      return t("payment.redirecting");
  }
}

/** What the primary control does now: a lost provider answer or a processing attempt can only be checked, never paid again. */
function effectiveAction(
  model: PaymentSectionModel,
  pay: PayState,
): { action: PaymentSectionModel["action"]; paymentId: string | null } {
  const outcome = pay.outcome;
  if (outcome?.kind === "providerUnavailable" && !outcome.canRetry) {
    return { action: "checkStatus", paymentId: outcome.paymentId };
  }
  if (outcome?.kind === "processing") {
    return { action: "checkStatus", paymentId: outcome.paymentId };
  }
  return { action: model.action, paymentId: model.paymentId };
}

export function PaymentSectionView(props: PaymentSectionViewProps) {
  const { t, locale, model, pay, now } = props;
  const busy = pay.phase === "pending" || pay.phase === "redirecting";
  const wait = pay.waitUntil === null ? 0 : secondsLeft(pay.waitUntil, now);
  const waiting = wait > 0;
  const { action, paymentId } = effectiveAction(model, pay);
  const outcome = pay.outcome;
  const failedText =
    model.status === "failed" || model.status === "expired"
      ? t(paymentFailureKey(model.failureCategory ?? (model.status === "expired" ? "expired" : null)))
      : null;
  // A refused start has its own message; the old failure explanation of the previous attempt would repeat it.
  const showOutcome = outcome !== null && outcome.kind !== "redirect" && pay.phase !== "pending";
  const payLabel =
    model.status === "failed" || model.status === "expired" || outcome !== null
      ? t("payment.payAgain")
      : t("payment.pay");

  return (
    <section
      aria-labelledby="order-payment-heading"
      aria-busy={busy}
      className="flex flex-col gap-3"
    >
      <h2 id="order-payment-heading" className="text-xl font-semibold text-foreground">
        {t("payment.title")}
      </h2>

      {model.status === null ? null : (
        <dl className="flex max-w-md flex-col gap-2 text-foreground">
          <div className="flex flex-wrap items-center gap-x-6">
            <dt className="w-40 text-muted-foreground">{t("payment.status.label")}</dt>
            <dd>
              <Badge variant={STATUS_BADGE[model.status] ?? "neutral"}>
                {t(paymentStatusKey(model.status))}
              </Badge>
            </dd>
          </div>
        </dl>
      )}
      {failedText === null || showOutcome ? null : <p className="text-foreground">{failedText}</p>}
      {action === "pay" || action === "continue" ? (
        <>
          <p className="text-foreground">{t("payment.intro")}</p>
          <p className="text-muted-foreground">
            {t("payment.awaiting", { time: formatDateTime(props.orderExpiresAt, locale) })}
          </p>
        </>
      ) : null}
      {model.expiresAt !== null && model.status === "waiting" ? (
        <p className="text-sm text-muted-foreground">
          {t("payment.lastAttempt", { time: formatDateTime(model.expiresAt, locale) })}
        </p>
      ) : null}
      {pay.insecure ? <Alert variant="danger">{t("payment.error.insecureContext")}</Alert> : null}
      {pay.returnSaved ? null : <Alert variant="warning">{t("payment.error.storage")}</Alert>}

      <div
        id={PAYMENT_FOCUS_IDS.message}
        tabIndex={-1}
        className="flex flex-col gap-2 rounded-md outline-offset-2 focus:outline-2 focus:outline-ring"
      >
        {showOutcome && outcome !== null ? (
          <Alert
            variant={
              outcome.kind === "processing" || outcome.kind === "paymentInProgress"
                ? "info"
                : "danger"
            }
            title={t("payment.error.title")}
          >
            <p>{payOutcomeText(t, outcome)}</p>
            {waiting ? (
              <p className="mt-1" id="order-payment-wait">
                {t.plural("payment.wait", wait)}
              </p>
            ) : null}
          </Alert>
        ) : null}
      </div>

      {/* Announced from the start of the page, changed later (a region that appears with its text is often not read). The
          per-second countdown above is NOT in a live region; only the end of the wait is announced. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="min-h-6 text-muted-foreground">
        {pay.phase === "pending" ? t("payment.opening") : ""}
        {pay.phase === "redirecting" ? t("payment.redirecting") : ""}
        {pay.waitUntil !== null && !waiting && pay.phase === "failed" ? t("payment.wait.done") : ""}
      </p>

      <div className="flex flex-wrap gap-3">
        {action === "pay" ? (
          <Button
            id={PAYMENT_FOCUS_IDS.action}
            onClick={props.onPay}
            disabled={busy || waiting || pay.insecure}
            aria-busy={pay.phase === "pending"}
            {...(waiting ? { "aria-describedby": "order-payment-wait" } : {})}
          >
            {pay.phase === "pending" ? t("payment.opening") : payLabel}
          </Button>
        ) : null}
        {action === "continue" && model.continueUrl !== null && model.paymentId !== null ? (
          <Button
            id={PAYMENT_FOCUS_IDS.action}
            onClick={() => props.onContinue(model.continueUrl as string, model.paymentId as string)}
            disabled={busy}
          >
            {t("payment.continue")}
          </Button>
        ) : null}
        {action === "checkStatus" && paymentId !== null ? (
          <Button
            id={PAYMENT_FOCUS_IDS.action}
            variant="secondary"
            onClick={() => props.onCheckStatus(paymentId)}
            disabled={busy || waiting}
            {...(waiting ? { "aria-describedby": "order-payment-wait" } : {})}
          >
            {t("payment.checkStatus")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
