import type { AdminConfig, AdminOrder, AdminResult, AdminShipment } from "@fluxkit/api-client";
import { ConfirmDialog, LiveRegion } from "@fluxkit/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { exponentOf } from "../../lib/currency-exponent";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { browserDownloadEnvironment, downloadBlob, labelFileName } from "./label-download";
import { DialogError, focusClass } from "./order-parts";
import type { MoneyContext } from "./order-view";
import {
  SHIPMENT_FIELDS,
  isShipmentDirty,
  planShipment,
  shipmentFormDefaults,
  type ShipmentFormValues,
  type ShipmentIssues,
} from "./shipment-form";
import {
  createFieldErrors,
  createNotice,
  describeShipmentProblem,
  reconcileNotice,
  type ShipmentNotice,
} from "./shipment-outcome";
import { CreateWaybillForm, ShipmentNoticeView, ShipmentPanel } from "./shipment-panel";
import { createGate, offeredShipmentActions, type ShipmentAction } from "./shipment-view";

/**
 * The delivery section of the order detail: owns the create form, the one write in flight, the notices and the cancel
 * confirmation. Every write goes through one single flight and `runWrite`, once; a refused or lost write is shown and never
 * repeated by the screen (carrier writes are never retried, ADR 0027 and 0029), and the order is read again after each one
 * so the panel shows the server's shipments and journals. `onChanged` reloads the order.
 */

interface SectionError {
  descriptor: MessageDescriptor;
}

export function ShipmentSection({
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
  const exponent = exponentOf(config, order.currency);
  const money: MoneyContext = { locale, config };
  const [defaults] = useState(() => shipmentFormDefaults(order, exponent));
  const [values, setValues] = useState<ShipmentFormValues>(defaults);
  const [issues, setIssues] = useState<ShipmentIssues>({});
  const [summary, setSummary] = useState<MessageDescriptor[]>([]);
  const [notice, setNotice] = useState<{ value: ShipmentNotice; n: number } | null>(null);
  const [error, setError] = useState<SectionError | null>(null);
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const [cancelling, setCancelling] = useState<AdminShipment | null>(null);
  const [dialogError, setDialogError] = useState<MessageDescriptor | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const dialogErrorRef = useRef<HTMLDivElement>(null);

  const gate = createGate(order, permissions);
  const blocker = useUnsavedChangesGuard(
    gate.kind === "ready" && isShipmentDirty(values, defaults) && !busy,
  );
  const now = new Date();

  useEffect(() => {
    if (notice !== null || error !== null) statusRef.current?.focus();
  }, [notice, error]);
  useEffect(() => {
    if (dialogError !== null) dialogErrorRef.current?.focus();
  }, [dialogError]);

  function announce(value: ShipmentNotice) {
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
    problem: Parameters<typeof describeShipmentProblem>[1],
    retryAfter: string | null,
  ) {
    setNotice(null);
    setError({ descriptor: describeShipmentProblem(status, problem, retryAfter) });
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gate.kind !== "ready") return;
    const plan = planShipment(values, order, exponent);
    if (!plan.ok) {
      setIssues(plan.issues);
      setSummary([{ key: "shipment.error.checkFields" }]);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setIssues({});
    setSummary([]);
    const body = plan.body;
    const outcome = await send(() => adminClient.createShipment(order.id, body));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      const next = createNotice(outcome.data);
      announce(next);
      // A failed waybill keeps the typed values (a new create is allowed); a created or unknown one starts a clean form.
      if (next.kind !== "failed") setValues(defaults);
    } else if (outcome.kind === "problem") {
      if (outcome.status === 400) {
        const mapped = createFieldErrors(outcome.problem, SHIPMENT_FIELDS);
        setIssues(mapped.fields as ShipmentIssues);
        setSummary([{ key: "shipment.error.checkFields" }, ...mapped.other]);
        requestAnimationFrame(() => summaryRef.current?.focus());
      } else {
        refused(outcome.status, outcome.problem, outcome.retryAfter);
      }
    } else {
      // No answer: a waybill may have been started. Read the order again and say so; nothing is sent again.
      announce({ kind: "lostCreate" });
    }
    onChanged();
  }

  async function runSimple(shipment: AdminShipment, action: "refresh" | "reconcile") {
    const outcome = await send(() =>
      action === "refresh"
        ? adminClient.refreshShipment(order.id, shipment.id)
        : adminClient.reconcileShipment(order.id, shipment.id),
    );
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      announce(action === "refresh" ? { kind: "refreshed" } : reconcileNotice(outcome.data));
    } else if (outcome.kind === "problem") {
      refused(outcome.status, outcome.problem, outcome.retryAfter);
    } else {
      announce({ kind: "lost", action });
    }
    onChanged();
  }

  async function downloadLabel(shipment: AdminShipment) {
    const outcome = await send(() => adminClient.getShipmentLabel(order.id, shipment.id));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      downloadBlob(outcome.data, labelFileName(order.number), browserDownloadEnvironment());
      announce({ kind: "labelReady" });
    } else if (outcome.kind === "problem") {
      refused(outcome.status, outcome.problem, outcome.retryAfter);
    } else {
      announce({ kind: "lost", action: "label" });
    }
  }

  function onAction(shipment: AdminShipment, action: ShipmentAction) {
    setError(null);
    if (action === "cancel") {
      setDialogError(null);
      setCancelling(shipment);
    } else if (action === "label") {
      void downloadLabel(shipment);
    } else {
      void runSimple(shipment, action);
    }
  }

  async function confirmCancel() {
    if (cancelling === null) return;
    const shipment = cancelling;
    const outcome = await send(() => adminClient.cancelShipment(order.id, shipment.id));
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "problem") {
      // The dialog stays open with the reason; the order is read again (another admin may have changed the waybill).
      setDialogError(describeShipmentProblem(outcome.status, outcome.problem, outcome.retryAfter));
      onChanged();
      return;
    }
    setCancelling(null);
    setDialogError(null);
    announce(outcome.kind === "ok" ? { kind: "cancelled" } : { kind: "lost", action: "cancel" });
    onChanged();
  }

  function closeDialog() {
    if (busy || flight.pending()) return;
    setCancelling(null);
    setDialogError(null);
  }

  const statusLine = (
    <div ref={statusRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>
        {notice === null ? null : <ShipmentNoticeView t={t} notice={notice.value} />}
        {error === null ? null : <DialogError t={t} descriptor={error.descriptor} />}
      </LiveRegion>
    </div>
  );

  return (
    <>
      <ShipmentPanel
        t={t}
        uiLocale={locale}
        order={order}
        money={money}
        shipments={order.shipments}
        actionsFor={(shipment) => offeredShipmentActions(shipment, permissions, now)}
        onAction={onAction}
        busy={busy}
        meId={meId}
        emails={emails}
        now={now}
        statusLine={statusLine}
        createForm={
          <CreateWaybillForm
            t={t}
            gate={gate}
            carrier={order.shipping?.providerCode ?? null}
            currency={order.currency}
            exponent={exponent}
            values={values}
            onChange={setValues}
            issues={issues}
            summary={summary}
            summaryRef={summaryRef}
            busy={busy}
            onSubmit={(event) => void submitCreate(event)}
          />
        }
      />
      <ConfirmDialog
        open={cancelling !== null}
        tone="danger"
        busy={busy}
        title={t("shipment.cancel.title", { tracking: cancelling?.trackingNumber ?? "" })}
        description={t("shipment.cancel.body")}
        confirmLabel={busy ? t("order.dialog.sending") : t("shipment.cancel.confirm")}
        cancelLabel={t("shipment.cancel.keep")}
        onClose={closeDialog}
        onConfirm={() => void confirmCancel()}
      >
        <DialogError t={t} descriptor={dialogError} innerRef={dialogErrorRef} />
      </ConfirmDialog>
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}
