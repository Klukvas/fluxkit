import type { AdminConfig, AdminOrder, AdminPayment, AdminResult } from "@fluxkit/api-client";
import { LiveRegion } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { exponentOf } from "../../lib/currency-exponent";
import { formatMoney } from "../../lib/format";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { DialogError, focusClass } from "../orders/order-parts";
import type { MoneyContext } from "../orders/order-view";
import { ClearAttentionDialog, RefundDialog, type RefundStep } from "./payment-dialogs";
import {
  describePaymentProblem,
  refundFieldErrors,
  refundNotice,
  type PaymentNotice,
} from "./payment-outcome";
import { PaymentNoticeView, PaymentPanel } from "./payment-panel";
import { offeredPaymentActions, type PaymentAction } from "./payment-view";
import {
  isRefundDirty,
  openRefundDialog,
  planRefund,
  refundDefaults,
  resolveRefundKey,
  type LostRefundAttempt,
  type RefundDraft,
  type RefundIssues,
  type RefundValues,
} from "./refund-form";

/**
 * The payment section of the order detail: owns the refund dialog, the one write in flight, the notices and the clear
 * confirmation. Every write goes through one single flight and `runWrite`, once; a refused or lost write is shown and never
 * repeated by the screen (the admin never retries a write, ADR 0027): after a lost refund the admin reopens the dialog,
 * which holds the SAME request and Idempotency-Key, so sending it again cannot refund twice. The order is read again after
 * each write so the panel shows the server's payments, refunds and journals. `onChanged` reloads the order.
 */

/** A fresh UUID per refund the admin confirms (`Idempotency-Key`, `docs/api/payments.md`). */
function newKey(): string {
  return crypto.randomUUID();
}

interface RefundDialogState {
  paymentId: string;
  step: RefundStep;
  values: RefundValues;
  draft: RefundDraft;
  retrying: boolean;
  /** Show the local issues of the form (after a first review). */
  showIssues: boolean;
  /** A `400` of the API on a field; cleared when the admin types. */
  serverFields: { amount: MessageDescriptor | null; note: MessageDescriptor | null };
  error: MessageDescriptor | null;
}

export function PaymentSection({
  order,
  config,
  permissions,
  meId,
  emails,
  onChanged,
}: {
  order: AdminOrder;
  config: AdminConfig;
  permissions: readonly string[] | null;
  meId: string;
  emails: ReadonlyMap<string, string> | null;
  /** Called after a write ended (any answer): the page reads the order again. */
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const money: MoneyContext = { locale, config };
  const [notice, setNotice] = useState<{ value: PaymentNotice; n: number } | null>(null);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const [refund, setRefund] = useState<RefundDialogState | null>(null);
  const [lost, setLost] = useState<LostRefundAttempt | null>(null);
  const [clearing, setClearing] = useState<AdminPayment | null>(null);
  const [clearError, setClearError] = useState<MessageDescriptor | null>(null);
  const focusAfterCommit = useFocusAfterCommit();
  const statusRef = useRef<HTMLDivElement>(null);
  const dialogErrorRef = useRef<HTMLDivElement>(null);

  const refundPayment =
    refund === null ? null : (order.payments.find((p) => p.id === refund.paymentId) ?? null);
  const exponent = exponentOf(config, refundPayment?.amount.currency ?? order.currency);
  const dirty =
    refund !== null &&
    refundPayment !== null &&
    !busy &&
    isRefundDirty(refund.values, refundDefaults(refundPayment, exponent));
  const blocker = useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (notice !== null || error !== null) statusRef.current?.focus();
  }, [notice, error]);
  useEffect(() => {
    if (refund?.error != null || clearError !== null) dialogErrorRef.current?.focus();
  }, [refund?.error, clearError]);

  function announce(value: PaymentNotice) {
    setError(null);
    setNotice((current) => ({ value, n: (current?.n ?? 0) + 1 }));
  }

  /** One write through the single flight (a second request while one runs sends nothing), never retried. */
  async function send<T>(write: () => Promise<AdminResult<T>>): Promise<WriteOutcome<T> | null> {
    const running = flight.run(() => runWrite(write));
    if (running === null) return null;
    setBusy(true);
    try {
      return await running;
    } finally {
      setBusy(false);
    }
  }

  function refused(
    status: number,
    problem: Parameters<typeof describePaymentProblem>[1],
    retryAfter: string | null,
  ) {
    setNotice(null);
    setError(describePaymentProblem(status, problem, retryAfter));
  }

  // ------------------------------------------------------------------------------------------------- refund

  function openRefund(payment: AdminPayment) {
    setError(null);
    const opened = openRefundDialog(
      lost,
      payment,
      exponentOf(config, payment.amount.currency),
      newKey,
    );
    setRefund({
      paymentId: payment.id,
      step: "form",
      values: opened.values,
      draft: opened.draft,
      retrying: opened.retrying,
      showIssues: false,
      serverFields: { amount: null, note: null },
      error: null,
    });
  }

  function closeRefund() {
    if (busy || flight.pending()) return;
    setRefund(null);
  }

  function focusFirstIssue(issues: RefundIssues) {
    const id = issues.amount !== undefined ? "payment-refund-amount" : "payment-refund-note";
    // In the commit that shows the issue (the field exists then, also when the dialog came back from the confirmation
    // step), never later: see `useFocusAfterCommit`.
    focusAfterCommit(id);
  }

  function review() {
    if (refund === null || refundPayment === null) return;
    const plan = planRefund(refund.values, refundPayment, exponent);
    if (!plan.ok) {
      setRefund({ ...refund, showIssues: true });
      focusFirstIssue(plan.issues);
      return;
    }
    setRefund({ ...refund, step: "confirm", showIssues: false, error: null });
  }

  async function confirmRefund() {
    if (refund === null || refundPayment === null) return;
    const plan = planRefund(refund.values, refundPayment, exponent);
    if (!plan.ok) {
      // The remaining amount changed under the dialog (another admin refunded): back to the form with the reason.
      setRefund({ ...refund, step: "form", showIssues: true });
      focusFirstIssue(plan.issues);
      return;
    }
    const body = plan.body;
    const draft = resolveRefundKey(refund.draft, body, newKey);
    const paymentId = refundPayment.id;
    setRefund({ ...refund, draft });
    const outcome = await send(() =>
      adminClient.refundPayment(order.id, paymentId, body, { idempotencyKey: draft.key }),
    );
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      setLost(null);
      setRefund(null);
      announce(refundNotice(outcome.data, outcome.status));
    } else if (outcome.kind === "problem") {
      setLost(null);
      const fields = outcome.status === 400 ? refundFieldErrors(outcome.problem) : null;
      setRefund({
        ...refund,
        draft,
        step: "form",
        showIssues: true,
        serverFields: {
          amount: fields?.amount ?? null,
          note: fields?.note ?? null,
        },
        error:
          fields === null
            ? describePaymentProblem(outcome.status, outcome.problem, outcome.retryAfter)
            : (fields.other[0] ?? null),
      });
    } else {
      // No answer: the refund may or may not have been requested. Keep the request (values and key) for the admin to
      // send again by hand, read the order and say so. Nothing is sent again by the screen.
      setLost({ paymentId, values: refund.values, draft });
      setRefund(null);
      announce({ kind: "refundLost" });
    }
    onChanged();
  }

  // ----------------------------------------------------------------------------------- resync and clear

  async function resync(payment: AdminPayment) {
    const outcome = await send(() => adminClient.resyncPayment(order.id, payment.id));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      announce({ kind: "resynced", at: new Date().toISOString() });
    } else if (outcome.kind === "problem") {
      refused(outcome.status, outcome.problem, outcome.retryAfter);
    } else {
      announce({ kind: "resyncLost" });
    }
    onChanged();
  }

  async function confirmClear() {
    if (clearing === null) return;
    const payment = clearing;
    const outcome = await send(() => adminClient.clearPaymentAttention(payment.id));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "problem") {
      setClearError(describePaymentProblem(outcome.status, outcome.problem, outcome.retryAfter));
      onChanged();
      return;
    }
    setClearing(null);
    setClearError(null);
    announce(outcome.kind === "ok" ? { kind: "cleared" } : { kind: "clearLost" });
    onChanged();
  }

  function closeClear() {
    if (busy || flight.pending()) return;
    setClearing(null);
    setClearError(null);
  }

  function onAction(payment: AdminPayment, action: PaymentAction) {
    setError(null);
    if (action === "refund") openRefund(payment);
    else if (action === "resync") void resync(payment);
    else {
      setClearError(null);
      setClearing(payment);
    }
  }

  const statusLine = (
    <div ref={statusRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>
        {notice === null ? null : (
          <PaymentNoticeView t={t} uiLocale={locale} money={money} notice={notice.value} />
        )}
        {error === null ? null : <DialogError t={t} descriptor={error} />}
      </LiveRegion>
    </div>
  );

  const plan =
    refund !== null && refundPayment !== null
      ? planRefund(refund.values, refundPayment, exponent)
      : null;
  const issues: RefundIssues =
    refund?.showIssues === true && plan !== null && !plan.ok ? plan.issues : {};

  return (
    <>
      <PaymentPanel
        t={t}
        uiLocale={locale}
        money={money}
        payments={order.payments}
        actionsFor={(payment) => offeredPaymentActions(payment, permissions)}
        onAction={onAction}
        busy={busy}
        meId={meId}
        emails={emails}
        statusLine={statusLine}
      />
      <RefundDialog
        t={t}
        open={refund !== null && refundPayment !== null}
        step={refund?.step ?? "form"}
        orderNumber={order.number}
        payment={refundPayment}
        money={money}
        currency={refundPayment?.amount.currency ?? order.currency}
        exponent={exponent}
        values={refund?.values ?? { amount: "", note: "" }}
        onChange={(values) =>
          refund === null
            ? undefined
            : setRefund({ ...refund, values, serverFields: { amount: null, note: null } })
        }
        amountIssue={issues.amount ?? null}
        noteIssue={issues.note ?? null}
        amountError={refund?.serverFields.amount ?? null}
        noteError={refund?.serverFields.note ?? null}
        error={refund?.error ?? null}
        errorRef={dialogErrorRef}
        retrying={refund?.retrying ?? false}
        confirmAmountText={
          plan !== null && plan.ok ? formatMoney(plan.body.amount, exponent, locale) : ""
        }
        busy={busy}
        onReview={review}
        onBack={() => (refund === null ? undefined : setRefund({ ...refund, step: "form" }))}
        onConfirm={() => void confirmRefund()}
        onClose={closeRefund}
      />
      <ClearAttentionDialog
        t={t}
        payment={clearing}
        error={clearError}
        errorRef={dialogErrorRef}
        busy={busy}
        onConfirm={() => void confirmClear()}
        onClose={closeClear}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}
