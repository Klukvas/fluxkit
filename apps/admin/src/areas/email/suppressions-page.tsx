import type { AdminEmailSuppression } from "@fluxkit/api-client";
import { ConfirmDialog } from "@fluxkit/ui";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { readPaging, writeQuery } from "../../router/query";
import { describeEmailProblem } from "./email-errors";
import { DialogError, EmailFrame, StatusLine } from "./email-frame";
import { useCanManageEmail } from "./email-permissions";
import { SuppressionsView } from "./suppressions-view";

const SUPPRESSION_LIST_LIMIT = 50;

/** Shared local blocks; removal never resends a message and is never retried automatically. */
export function EmailSuppressionsPage() {
  const { t, locale } = useI18n();
  const canManage = useCanManageEmail();
  const [params] = useSearchParams();
  const { limit, offset } = readPaging(params, { defaultLimit: SUPPRESSION_LIST_LIMIT });
  const resource = useResource(
    (signal) => adminClient.listEmailSuppressions({ limit, offset, signal }),
    [limit, offset],
  );
  const [asking, setAsking] = useState<AdminEmailSuppression | null>(null);
  const [dialogError, setDialogError] = useState<MessageDescriptor | null>(null);
  const [notice, setNotice] = useState<"removed" | "unknown" | null>(null);
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

  function ask(entry: AdminEmailSuppression) {
    if (!canManage || busy) return;
    setNotice(null);
    setDialogError(null);
    setAsking(entry);
  }

  function close() {
    if (busy || flight.pending()) return;
    setAsking(null);
    setDialogError(null);
  }

  async function confirm() {
    if (asking === null || !canManage) return;
    const running = flight.run(() => runWrite(() => adminClient.removeEmailSuppression(asking.id)));
    if (running === null) return;
    setBusy(true);
    try {
      const outcome = await running;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "problem") {
        setDialogError(describeEmailProblem(outcome.status, outcome.problem, outcome.retryAfter));
      } else {
        setAsking(null);
        setDialogError(null);
        setNotice(outcome.kind === "unknown" ? "unknown" : "removed");
      }
      resource.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <EmailFrame
      t={t}
      current="emailSuppressions"
      title={t("page.emailSuppressions.title")}
      description={t("mail.suppressions.intro")}
    >
      <StatusLine innerRef={statusRef}>
        {notice === null ? null : t(`mail.suppressions.notice.${notice}`)}
      </StatusLine>
      <SuppressionsView
        t={t}
        uiLocale={locale}
        state={resource}
        limit={limit}
        offset={offset}
        canManage={canManage}
        busy={busy}
        onRetry={resource.reload}
        onRemove={ask}
        hrefForOffset={(next) =>
          `${PATHS.emailSuppressions}${writeQuery({ limit, offset: next }, { limit: SUPPRESSION_LIST_LIMIT, offset: 0 })}`
        }
      />
      <ConfirmDialog
        open={asking !== null}
        tone="danger"
        busy={busy}
        title={t("mail.suppressions.confirmTitle")}
        description={t("mail.suppressions.confirmBody")}
        confirmLabel={busy ? t("mail.dialog.sending") : t("mail.suppressions.remove")}
        cancelLabel={t("mail.dialog.keep")}
        onClose={close}
        onConfirm={() => void confirm()}
      >
        <p className="break-all">{asking?.toAddress}</p>
        <DialogError t={t} descriptor={dialogError} innerRef={dialogErrorRef} />
      </ConfirmDialog>
    </EmailFrame>
  );
}
