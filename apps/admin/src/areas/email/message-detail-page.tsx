import type { AdminEmailMessageDetail, AdminResult } from "@fluxkit/api-client";
import { ConfirmDialog } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { PATHS } from "../../router/paths";
import { ResourceFallback } from "../../views/status-views";
import { DialogError, EmailFrame, StatusLine, linkClass } from "./email-frame";
import { describeEmailProblem } from "./email-errors";
import { useCanManageEmail } from "./email-permissions";
import type { MessageAction, MessageNotice } from "./message-actions";
import {
  MessageActions,
  MessageFacts,
  MessageNoticeView,
  VariablesTable,
} from "./message-detail-view";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MessageDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const canManage = useCanManageEmail();
  // The mail is read again after each write; the page (and its status line) stays while it runs.
  const resource = useRefreshingResource(
    (signal) => adminClient.getEmailMessage(id, { signal }),
    [id],
  );
  const [notice, setNotice] = useState<MessageNotice | null>(null);
  const [asking, setAsking] = useState<MessageAction | null>(null);
  const [dialogError, setDialogError] = useState<MessageDescriptor | null>(null);
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const dialogErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notice !== null) statusRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (dialogError !== null) dialogErrorRef.current?.focus();
  }, [dialogError]);

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

  function ask(action: MessageAction) {
    setNotice(null);
    setDialogError(null);
    setAsking(action);
  }

  function close() {
    if (busy || flight.pending()) return;
    setAsking(null);
    setDialogError(null);
  }

  /** Shows how one write ended: a refusal stays in the open dialog, anything else closes it. */
  function settle<T>(
    action: MessageAction,
    outcome: WriteOutcome<T> | null,
    noticeFor: (data: T) => MessageNotice,
  ) {
    if (outcome === null || outcome.kind === "aborted") return;
    if (outcome.kind === "problem") {
      // The dialog stays open with the reason; the mail is read again (another admin may have changed it).
      setDialogError(describeEmailProblem(outcome.status, outcome.problem, outcome.retryAfter));
      resource.reload();
      return;
    }
    setAsking(null);
    setDialogError(null);
    setNotice(outcome.kind === "unknown" ? { kind: "lost", action } : noticeFor(outcome.data));
    resource.reload();
  }

  async function confirm() {
    if (asking === "resend") {
      const outcome = await send(() => adminClient.resendEmailMessage(id));
      settle("resend", outcome, (data) => ({ kind: "resent", messageId: data.messageId }));
    } else if (asking === "cancel") {
      const outcome = await send(() => adminClient.cancelEmailMessage(id));
      settle("cancel", outcome, () => ({ kind: "cancelled" }));
    }
  }

  const message: AdminEmailMessageDetail | null = resource.data;
  const resendDescription =
    message?.templateKey === "admin.test" ? t("mail.resend.bodyTest") : t("mail.resend.body");

  return (
    <EmailFrame t={t} current="emailMessages" title={t("page.emailMessageDetail.title")}>
      <p>
        <Link to={PATHS.emailMessages} className={linkClass}>
          {t("mail.detail.back")}
        </Link>
      </p>
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : message === null ? null : (
        <>
          <StatusLine innerRef={statusRef}>
            <MessageNoticeView t={t} notice={notice} />
          </StatusLine>
          <MessageActions
            t={t}
            message={message}
            canManage={canManage}
            busy={busy}
            onAction={ask}
          />
          <section aria-labelledby="email-facts" className="flex max-w-3xl flex-col gap-3">
            <h2 id="email-facts" className="text-lg font-semibold text-foreground">
              {t("mail.detail.factsTitle")}
            </h2>
            <MessageFacts t={t} uiLocale={locale} message={message} />
          </section>
          <section aria-labelledby="email-variables" className="flex max-w-3xl flex-col gap-3">
            <h2 id="email-variables" className="text-lg font-semibold text-foreground">
              {t("mail.detail.variablesTitle")}
            </h2>
            <p className="text-muted-foreground">{t("mail.detail.variablesNote")}</p>
            <VariablesTable t={t} variables={message.variables} />
          </section>
        </>
      )}
      <ConfirmDialog
        open={asking === "resend"}
        busy={busy}
        title={t("mail.resend.title")}
        description={resendDescription}
        confirmLabel={busy ? t("mail.dialog.sending") : t("mail.resend.confirm")}
        cancelLabel={t("mail.dialog.keep")}
        onClose={close}
        onConfirm={() => void confirm()}
      >
        <DialogError t={t} descriptor={dialogError} innerRef={dialogErrorRef} />
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "cancel"}
        tone="danger"
        busy={busy}
        title={t("mail.cancel.title")}
        description={t("mail.cancel.body")}
        confirmLabel={busy ? t("mail.dialog.sending") : t("mail.cancel.confirm")}
        cancelLabel={t("mail.dialog.keep")}
        onClose={close}
        onConfirm={() => void confirm()}
      >
        <DialogError t={t} descriptor={dialogError} innerRef={dialogErrorRef} />
      </ConfirmDialog>
    </EmailFrame>
  );
}

/** `/email/messages/:id`: one mail with its journal and, for an admin who may manage email, resend and cancel. */
export function EmailMessageDetailPage() {
  const { t } = useI18n();
  const { id } = useParams();
  if (id === undefined) throw new Error("The message route has no id parameter.");
  if (!UUID_PATTERN.test(id)) {
    return (
      <EmailFrame t={t} current="emailMessages" title={t("page.emailMessageDetail.title")}>
        <ResourceFallback t={t} state={{ status: "notFound" }} onRetry={() => undefined} />
      </EmailFrame>
    );
  }
  return <MessageDetail key={id} id={id} />;
}
