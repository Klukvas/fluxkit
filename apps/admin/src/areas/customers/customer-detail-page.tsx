import type { AdminCustomer, AdminResult } from "@fluxkit/api-client";
import { Alert, type Translator } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";
import { PageHeading, ResourceFallback } from "../../views/status-views";
import {
  offeredCustomerActions,
  stateAfterUnknown,
  updateBody,
  type CustomerAction,
} from "./customer-actions";
import { DeactivateDialog } from "./customer-dialogs";
import { CustomerDetailView } from "./customer-detail-view";
import { DescriptorText, StatusLine, describeCustomerProblem } from "./customer-parts";

/** What the status line says after an action; the customer on screen is always the server's (reloaded). */
export type CustomerNotice =
  | { kind: "done"; action: CustomerAction }
  | { kind: "refused"; action: CustomerAction; descriptor: MessageDescriptor }
  /** `before` is the customer as read before the write: the reading text shows until a newer read replaces it. */
  | { kind: "unknown"; action: CustomerAction; before: AdminCustomer };

export function CustomerNoticeView({
  t,
  notice,
  customer,
  refreshing,
}: {
  t: Translator;
  notice: CustomerNotice | null;
  /** The customer as last read (after the reload that follows every answer). */
  customer: AdminCustomer | null;
  /** The reload is still running, so `customer` may be older than the answer. */
  refreshing: boolean;
}) {
  if (notice === null) return null;
  switch (notice.kind) {
    case "done":
      return <Alert variant="success">{t(`customer.notice.done.${notice.action}`)}</Alert>;
    case "refused":
      return (
        <Alert variant="danger" title={t(`customer.notice.refused.${notice.action}`)}>
          <p>
            <DescriptorText t={t} descriptor={notice.descriptor} />
          </p>
        </Alert>
      );
    case "unknown":
      return (
        <Alert variant="warning" title={t("customer.notice.unknownTitle")}>
          <p>
            {refreshing || customer === notice.before
              ? t("customer.notice.unknownReading")
              : t(`customer.notice.unknown.${stateAfterUnknown(notice.action, customer)}`)}
          </p>
        </Alert>
      );
  }
}

function CustomerDetail({ customerId }: { customerId: string }) {
  const { t, locale } = useI18n();
  const session = useSession();
  const permissions = session.state.me?.permissions ?? null;
  const resource = useRefreshingResource(
    (signal) => adminClient.getCustomer(customerId, { signal }),
    [customerId],
  );
  const [flight] = useState(createSingleFlight);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ value: CustomerNotice; n: number } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notice !== null) statusRef.current?.focus();
  }, [notice]);

  if (resource.fallback !== null || resource.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>{t("customer.detail.title")}</PageHeading>
        {resource.fallback === null ? null : (
          <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
        )}
      </div>
    );
  }
  const customer: AdminCustomer = resource.data;
  const actions = offeredCustomerActions(customer, permissions);

  function announce(value: CustomerNotice) {
    setNotice((current) => ({ value, n: (current?.n ?? 0) + 1 }));
  }

  /**
   * Sends one write through the single flight (a second submit while one runs sends nothing) and `runWrite` (once, never
   * retried). Whatever the answer, the customer is read again, so the screen shows the server's state; nothing is
   * optimistic.
   */
  async function send<T>(
    action: CustomerAction,
    write: () => Promise<AdminResult<T>>,
  ): Promise<void> {
    const running = flight.run(() => runWrite(write));
    if (running === null) return;
    setBusy(true);
    let outcome: WriteOutcome<T>;
    try {
      outcome = await running;
    } finally {
      setBusy(false);
    }
    if (outcome.kind === "aborted") return;
    setConfirming(false);
    if (outcome.kind === "ok") {
      announce({ kind: "done", action });
    } else if (outcome.kind === "problem") {
      announce({
        kind: "refused",
        action,
        descriptor: describeCustomerProblem(outcome.status, outcome.problem),
      });
    } else {
      announce({ kind: "unknown", action, before: customer });
    }
    resource.reload();
  }

  function perform(action: CustomerAction) {
    // The buttons are only rendered for what the session may do; this keeps a stale click from sending anything else.
    if (!actions.includes(action)) return;
    if (action === "unlock") {
      void send(action, () => adminClient.unlockCustomer(customer.id));
    } else {
      void send(action, () => adminClient.updateCustomer(customer.id, updateBody(action)));
    }
  }

  function onAction(action: CustomerAction) {
    if (action === "deactivate") setConfirming(true);
    else perform(action);
  }

  return (
    <>
      <CustomerDetailView
        t={t}
        uiLocale={locale}
        customer={customer}
        actions={actions}
        canReadOrders={canRun(permissions, "listOrders")}
        onAction={onAction}
        busy={busy || resource.refreshing}
        statusLine={
          <StatusLine innerRef={statusRef}>
            {notice === null ? null : (
              <CustomerNoticeView
                t={t}
                notice={notice.value}
                customer={customer}
                refreshing={resource.refreshing}
              />
            )}
            {resource.refreshing ? (
              <p className="text-muted-foreground">{t("customer.detail.reloading")}</p>
            ) : null}
          </StatusLine>
        }
      />
      <DeactivateDialog
        t={t}
        open={confirming}
        busy={busy}
        onConfirm={() => perform("deactivate")}
        onClose={() => {
          if (!busy) setConfirming(false);
        }}
      />
    </>
  );
}

/** `/customers/:id`: the customer detail with its actions. */
export function CustomerDetailPage() {
  const { id } = useParams();
  if (id === undefined || id === "") throw new Error("The customer route has no id.");
  return <CustomerDetail key={id} customerId={id} />;
}
