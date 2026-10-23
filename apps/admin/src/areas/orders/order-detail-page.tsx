import type {
  AdminConfig,
  AdminOrder,
  AdminResult,
  MarkAdminOrderPaidBody,
} from "@fluxkit/api-client";
import { Alert, type Translator } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { failureFromError } from "../../lib/failure";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useAdminEmails } from "../../lib/use-admin-emails";
import { useCrash } from "../../lib/use-crash";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { useSession } from "../../session/session-context";
import { PageHeading, ResourceFallback } from "../../views/status-views";
import {
  EMPTY_CANCEL,
  cancelConsequence,
  isCancelDirty,
  planCancel,
  type CancelValues,
} from "./cancel-form";
import {
  EMPTY_MARK_PAID,
  isMarkPaidDirty,
  markPaidCheckAfterUnknown,
  planMarkPaid,
  valuesForRetry,
  type MarkPaidCheck,
  type MarkPaidValues,
} from "./mark-paid-form";
import { canCloseOrderDialog, offeredActions, type OrderAction } from "./order-actions";
import { OrderDetailView, type HistoryRow } from "./order-detail-view";
import { CancelDialog, FulfilDialog, MarkPaidDialog } from "./order-dialogs";
import {
  StatusLine,
  describeOrderFieldIssue,
  describeOrderProblem,
  fieldIssueFromProblem,
  useOrderConfig,
} from "./order-parts";
import { historyActor, moneyText, wantsAdminEmails } from "./order-view";

/** What the status line says after an action; the order on screen is always the server's (reloaded). */
export type OrderNotice =
  | { kind: "done"; action: OrderAction }
  | { kind: "unknown"; action: "markFulfilled" | "cancel" }
  | { kind: "unknownPaid"; check: MarkPaidCheck | "unreadable"; reference: string };

export function OrderNoticeView({ t, notice }: { t: Translator; notice: OrderNotice | null }) {
  if (notice === null) return null;
  switch (notice.kind) {
    case "done":
      return <Alert variant="success">{t(`order.notice.done.${notice.action}`)}</Alert>;
    case "unknown":
      return (
        <Alert variant="warning" title={t("order.notice.unknownTitle")}>
          <p>{t(`order.notice.unknown.${notice.action}`)}</p>
        </Alert>
      );
    case "unknownPaid":
      return (
        <Alert variant="warning" title={t("order.notice.unknownTitle")}>
          <p>{t(`order.notice.unknownPaid.${notice.check}`, { reference: notice.reference })}</p>
        </Alert>
      );
  }
}

type DialogState =
  | { kind: "none" }
  | { kind: "markPaid"; values: MarkPaidValues; showIssues: boolean }
  | { kind: "markFulfilled" }
  | { kind: "cancel"; values: CancelValues; showIssues: boolean };

interface ActionError {
  descriptor: MessageDescriptor;
  /** A `400` on one field of the body: shown on that field instead of on top. */
  field: string | null;
}

function OrderDetail({ orderId, config }: { orderId: string; config: AdminConfig }) {
  const { t, locale } = useI18n();
  const session = useSession();
  const crash = useCrash();
  const me = session.state.me;
  const permissions = me?.permissions ?? null;
  const resource = useRefreshingResource(
    (signal) => adminClient.getOrder(orderId, { signal }),
    [orderId],
  );
  const emails = useAdminEmails(wantsAdminEmails(permissions));
  const [flight] = useState(createSingleFlight);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<{ value: OrderNotice; n: number } | null>(null);
  // After a lost mark-paid answer: the body that was sent, so the admin may retry with the SAME reference.
  const [lastPaidAttempt, setLastPaidAttempt] = useState<MarkAdminOrderPaidBody | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const dirty =
    (dialog.kind === "markPaid" && isMarkPaidDirty(dialog.values)) ||
    (dialog.kind === "cancel" && isCancelDirty(dialog.values));
  const blocker = useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (notice !== null) statusRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (actionError !== null) errorRef.current?.focus();
  }, [actionError]);

  if (resource.fallback !== null || resource.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>{t("page.orderDetail.title")}</PageHeading>
        {resource.fallback === null ? null : (
          <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
        )}
      </div>
    );
  }
  const order: AdminOrder = resource.data;
  const money = { locale, config };
  const meId = me?.user.id ?? "";

  function announce(value: OrderNotice) {
    setNotice((current) => ({ value, n: (current?.n ?? 0) + 1 }));
  }

  function closeDialog() {
    if (!canCloseOrderDialog({ busy, writing: flight.pending() })) return;
    setDialog({ kind: "none" });
    setActionError(null);
  }

  function open(action: OrderAction) {
    setActionError(null);
    if (action === "markPaid") {
      setDialog({
        kind: "markPaid",
        values: lastPaidAttempt === null ? EMPTY_MARK_PAID : valuesForRetry(lastPaidAttempt),
        showIssues: false,
      });
    } else if (action === "cancel") {
      setDialog({ kind: "cancel", values: EMPTY_CANCEL, showIssues: false });
    } else {
      setDialog({ kind: "markFulfilled" });
    }
  }

  /**
   * Sends one write through the single flight (a second submit while one runs sends nothing) and `runWrite` (once, never
   * retried), then reloads the order whatever the answer, so the screen shows the server's state and history.
   */
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

  function refused(outcome: Extract<WriteOutcome<unknown>, { kind: "problem" }>, fields: string[]) {
    const field = fields.find((name) => fieldIssueFromProblem(outcome.problem, name) !== null);
    if (outcome.status === 400 && field !== undefined) {
      const code = fieldIssueFromProblem(outcome.problem, field) as string;
      setActionError({ descriptor: describeOrderFieldIssue(code), field });
    } else {
      setActionError({
        descriptor: describeOrderProblem(outcome.status, outcome.problem),
        field: null,
      });
    }
    // The order may have changed meanwhile (another admin, the expiry job): show what the server has now.
    resource.reload();
  }

  async function submitMarkPaid() {
    if (dialog.kind !== "markPaid") return;
    const plan = planMarkPaid(dialog.values, order);
    if (!plan.ok) {
      setDialog({ ...dialog, showIssues: true });
      return;
    }
    const body = plan.body;
    const outcome = await send(() => adminClient.markOrderPaid(order.id, body));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      setLastPaidAttempt(null);
      setDialog({ kind: "none" });
      setActionError(null);
      announce({ kind: "done", action: "markPaid" });
      resource.reload();
    } else if (outcome.kind === "problem") {
      refused(outcome, ["reference"]);
    } else {
      // No answer: the payment may or may not be recorded. Read the order once to say which, keep the reference for a
      // retry by the admin (idempotent by reference), and reload the screen. Nothing is sent again by the screen.
      setLastPaidAttempt(body);
      setDialog({ kind: "none" });
      setActionError(null);
      let check: MarkPaidCheck | "unreadable" = "unreadable";
      try {
        const read = await adminClient.getOrder(order.id);
        if (read.ok) check = markPaidCheckAfterUnknown(read.data, body.reference);
      } catch (error) {
        try {
          failureFromError(error);
        } catch (bug) {
          crash(bug);
          return;
        }
      }
      if (
        check === "recorded" ||
        check === "paid_with_other_reference" ||
        check === "not_payable"
      ) {
        setLastPaidAttempt(null);
      }
      announce({ kind: "unknownPaid", check, reference: body.reference });
      resource.reload();
    }
  }

  async function submitFulfil() {
    const outcome = await send(() => adminClient.markOrderFulfilled(order.id));
    if (outcome === null || outcome.kind === "aborted") return;
    afterSimpleWrite(outcome, "markFulfilled", []);
  }

  async function submitCancel() {
    if (dialog.kind !== "cancel") return;
    const plan = planCancel(dialog.values);
    if (!plan.ok) {
      setDialog({ ...dialog, showIssues: true });
      return;
    }
    const body = plan.body;
    const outcome = await send(() => adminClient.cancelOrder(order.id, body));
    if (outcome === null || outcome.kind === "aborted") return;
    afterSimpleWrite(outcome, "cancel", ["reason"]);
  }

  function afterSimpleWrite(
    outcome: Exclude<WriteOutcome<AdminOrder>, { kind: "aborted" }>,
    action: "markFulfilled" | "cancel",
    fields: string[],
  ) {
    if (outcome.kind === "problem") {
      refused(outcome, fields);
      return;
    }
    setDialog({ kind: "none" });
    setActionError(null);
    announce(outcome.kind === "ok" ? { kind: "done", action } : { kind: "unknown", action });
    resource.reload();
  }

  const history: HistoryRow[] = order.history.map((entry, index) => ({
    key: String(index),
    at: entry.at,
    from: entry.fromStatus,
    to: entry.toStatus,
    actor: historyActor(entry, meId, emails),
    reason: entry.reason,
  }));

  const markPaidIssues =
    dialog.kind === "markPaid" && dialog.showIssues ? planMarkPaid(dialog.values, order) : null;
  const cancelIssue =
    dialog.kind === "cancel" && dialog.showIssues ? planCancel(dialog.values) : null;
  const topError =
    actionError === null || actionError.field !== null ? null : actionError.descriptor;
  const fieldError = (field: string): MessageDescriptor | null =>
    actionError?.field === field ? actionError.descriptor : null;
  const amountText = moneyText(order.total, money);

  return (
    <>
      <OrderDetailView
        t={t}
        uiLocale={locale}
        order={order}
        money={money}
        history={history}
        actions={offeredActions(order.status, permissions)}
        onAction={open}
        busy={busy || resource.refreshing}
        statusLine={
          <StatusLine innerRef={statusRef}>
            {notice === null ? null : <OrderNoticeView t={t} notice={notice.value} />}
            {resource.refreshing ? (
              <p className="text-muted-foreground">{t("order.detail.reloading")}</p>
            ) : null}
          </StatusLine>
        }
      />
      <MarkPaidDialog
        t={t}
        open={dialog.kind === "markPaid"}
        orderNumber={order.number}
        amountText={amountText}
        currency={order.total.currency}
        values={dialog.kind === "markPaid" ? dialog.values : EMPTY_MARK_PAID}
        onChange={(values) =>
          dialog.kind === "markPaid" ? setDialog({ ...dialog, values }) : undefined
        }
        referenceError={
          fieldError("reference") ??
          (markPaidIssues !== null &&
          !markPaidIssues.ok &&
          markPaidIssues.issues.reference !== undefined
            ? describeOrderFieldIssue(markPaidIssues.issues.reference)
            : null)
        }
        receivedError={
          markPaidIssues !== null &&
          !markPaidIssues.ok &&
          markPaidIssues.issues.received !== undefined
            ? describeOrderFieldIssue(markPaidIssues.issues.received)
            : null
        }
        error={dialog.kind === "markPaid" ? topError : null}
        errorRef={errorRef}
        retrying={lastPaidAttempt !== null}
        busy={busy}
        onSubmit={() => void submitMarkPaid()}
        onClose={closeDialog}
      />
      <FulfilDialog
        t={t}
        open={dialog.kind === "markFulfilled"}
        orderNumber={order.number}
        error={dialog.kind === "markFulfilled" ? topError : null}
        errorRef={errorRef}
        busy={busy}
        onConfirm={() => void submitFulfil()}
        onClose={closeDialog}
      />
      <CancelDialog
        t={t}
        open={dialog.kind === "cancel"}
        orderNumber={order.number}
        consequence={cancelConsequence(order.status)}
        values={dialog.kind === "cancel" ? dialog.values : EMPTY_CANCEL}
        onChange={(values) =>
          dialog.kind === "cancel" ? setDialog({ ...dialog, values }) : undefined
        }
        reasonError={
          fieldError("reason") ??
          (cancelIssue !== null && !cancelIssue.ok
            ? describeOrderFieldIssue(cancelIssue.issue)
            : null)
        }
        error={dialog.kind === "cancel" ? topError : null}
        errorRef={errorRef}
        busy={busy}
        onSubmit={() => void submitCancel()}
        onClose={closeDialog}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

/** `/orders/:id`: the order detail with its actions. */
export function OrderDetailPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const config = useOrderConfig();
  if (id === undefined || id === "") throw new Error("The order route has no id.");
  if (config.status !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>{t("page.orderDetail.title")}</PageHeading>
        <ResourceFallback t={t} state={config} onRetry={config.reload} />
      </div>
    );
  }
  return <OrderDetail key={id} orderId={id} config={config.data} />;
}
