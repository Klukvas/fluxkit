import type { AdminEmailMessageDetail } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  DescriptionList,
  EmptyState,
  StatusBadge,
  type DataTableColumn,
  type DescriptionListItem,
  type Translator,
} from "@fluxkit/ui";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { PATHS, buildPath } from "../../router/paths";
import { ErrorCodeText, linkClass } from "./email-frame";
import { MESSAGE_STATUS_TONES, messageHref, statusLabelKey, templateHref } from "./email-view";
import { offeredActions, type MessageAction, type MessageNotice } from "./message-actions";
import { variableRows, type VariableRow } from "./variables-view";

/** The status line after an action: the new message for a resend, or the honest "no answer". */
export function MessageNoticeView({ t, notice }: { t: Translator; notice: MessageNotice | null }) {
  if (notice === null) return null;
  switch (notice.kind) {
    case "resent":
      return (
        <Alert variant="success">
          <p>{t("mail.notice.resent")}</p>
          <p>
            <Link to={messageHref(notice.messageId)} className={linkClass}>
              {t("mail.notice.openNew")}
            </Link>
          </p>
        </Alert>
      );
    case "cancelled":
      return <Alert variant="success">{t("mail.notice.cancelled")}</Alert>;
    case "lost":
      return (
        <Alert variant="warning" title={t("mail.unknown.title")}>
          <p>{t(`mail.notice.lost.${notice.action}`)}</p>
          <p>
            <Link to={PATHS.emailMessages} className={linkClass}>
              {t("mail.unknown.openList")}
            </Link>
          </p>
        </Alert>
      );
  }
}

export function MessageActions({
  t,
  message,
  canManage,
  busy,
  onAction,
}: {
  t: Translator;
  message: AdminEmailMessageDetail;
  canManage: boolean;
  busy: boolean;
  onAction: (action: MessageAction) => void;
}) {
  const actions = offeredActions(message, canManage);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {actions.includes("resend") ? (
        <Button variant="secondary" disabled={busy} onClick={() => onAction("resend")}>
          {t("mail.action.resend")}
        </Button>
      ) : null}
      {actions.includes("cancel") ? (
        <Button variant="danger" disabled={busy} onClick={() => onAction("cancel")}>
          {t("mail.action.cancel")}
        </Button>
      ) : null}
    </div>
  );
}

/** Variables the API sent, one row per value; a hidden value says so and nothing else. */
export function VariablesTable({
  t,
  variables,
}: {
  t: Translator;
  variables: AdminEmailMessageDetail["variables"];
}) {
  const { rows, truncated } = variableRows(variables);
  const columns: DataTableColumn<VariableRow>[] = [
    {
      id: "name",
      header: t("mail.detail.variableName"),
      cell: (row) => <span className="break-all font-mono">{row.path}</span>,
    },
    {
      id: "value",
      header: t("mail.detail.variableValue"),
      cell: (row) =>
        row.value.kind === "redacted" ? (
          <span className="text-muted-foreground">{t("mail.detail.redacted")}</span>
        ) : row.value.kind === "empty" ? (
          <span className="text-muted-foreground">{t("mail.detail.emptyValue")}</span>
        ) : (
          <span className="break-words">{row.value.text}</span>
        ),
    },
  ];
  if (rows.length === 0) {
    return <EmptyState title={t("mail.detail.noVariables")} />;
  }
  return (
    <>
      <DataTable
        caption={t("mail.detail.variablesCaption")}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(row) => row.path}
        emptyMessage={null}
      />
      {truncated ? (
        <p className="text-sm text-muted-foreground">{t("mail.detail.variablesTruncated")}</p>
      ) : null}
    </>
  );
}

function when(value: string | null, uiLocale: string, none: string) {
  return value === null ? (
    <span className="text-muted-foreground">{none}</span>
  ) : (
    formatDateTime(value, uiLocale)
  );
}

/** The mail and its journal: what was sent to whom, and how every attempt went. */
export function MessageFacts({
  t,
  uiLocale,
  message,
}: {
  t: Translator;
  uiLocale: string;
  message: AdminEmailMessageDetail;
}) {
  const none = t("mail.detail.none");
  const items: DescriptionListItem[] = [
    {
      id: "status",
      term: t("mail.detail.status"),
      description: (
        <StatusBadge
          tone={MESSAGE_STATUS_TONES[message.status]}
          label={t(statusLabelKey(message.status))}
        />
      ),
    },
    {
      id: "template",
      term: t("mail.detail.template"),
      description: (
        <span className="break-all">
          <Link
            to={templateHref(message.templateKey, message.locale)}
            className={`${linkClass} font-mono`}
          >
            {message.templateKey}
          </Link>{" "}
          {t("mail.detail.version", { version: message.templateVersion })}
        </span>
      ),
    },
    { id: "locale", term: t("mail.detail.locale"), description: message.locale },
    {
      id: "recipient",
      term: t("mail.detail.recipient"),
      description: (
        <span className="break-all">
          {message.to} ({t(`mail.recipientKind.${message.recipientKind}`)})
        </span>
      ),
    },
  ];
  if (message.orderId !== null) {
    items.push({
      id: "order",
      term: t("mail.detail.order"),
      description: (
        <Link to={buildPath(PATHS.orderDetail, { id: message.orderId })} className={linkClass}>
          {t("mail.detail.openOrder")}
        </Link>
      ),
    });
  }
  if (message.customerId !== null) {
    items.push({
      id: "customer",
      term: t("mail.detail.customer"),
      description: (
        <Link
          to={buildPath(PATHS.customerDetail, { id: message.customerId })}
          className={linkClass}
        >
          {t("mail.detail.openCustomer")}
        </Link>
      ),
    });
  }
  if (message.resendOf !== null) {
    items.push({
      id: "resendOf",
      term: t("mail.detail.resendOf"),
      description: (
        <Link to={messageHref(message.resendOf)} className={linkClass}>
          {t("mail.detail.openOriginal")}
        </Link>
      ),
    });
  }
  items.push(
    {
      id: "attempts",
      term: t("mail.detail.attempts"),
      description: new Intl.NumberFormat(uiLocale).format(message.attempts),
    },
    {
      id: "created",
      term: t("mail.detail.created"),
      description: formatDateTime(message.createdAt, uiLocale),
    },
    { id: "sent", term: t("mail.detail.sent"), description: when(message.sentAt, uiLocale, none) },
    {
      id: "deadline",
      term: t("mail.detail.deadline"),
      description: formatDateTime(message.deadlineAt, uiLocale),
    },
  );
  if (message.status === "pending") {
    items.push({
      id: "next",
      term: t("mail.detail.nextAttempt"),
      description: formatDateTime(message.nextAttemptAt, uiLocale),
    });
  }
  if (message.status === "sending" && message.leaseUntil !== null) {
    items.push({
      id: "lease",
      term: t("mail.detail.leaseUntil"),
      description: formatDateTime(message.leaseUntil, uiLocale),
    });
  }
  items.push(
    {
      id: "provider",
      term: t("mail.detail.providerCode"),
      description:
        message.providerCode === null ? (
          <span className="text-muted-foreground">{none}</span>
        ) : (
          <span className="break-all font-mono">{message.providerCode}</span>
        ),
    },
    {
      id: "providerId",
      term: t("mail.detail.providerMessageId"),
      description:
        message.providerMessageId === null ? (
          <span className="text-muted-foreground">{none}</span>
        ) : (
          <span className="break-all font-mono">{message.providerMessageId}</span>
        ),
    },
    {
      id: "error",
      term: t("mail.detail.lastError"),
      description:
        message.lastErrorCode === null ? (
          <span className="text-muted-foreground">{none}</span>
        ) : (
          <ErrorCodeText t={t} code={message.lastErrorCode} />
        ),
    },
    {
      id: "updated",
      term: t("mail.detail.updated"),
      description: formatDateTime(message.updatedAt, uiLocale),
    },
  );
  return <DescriptionList items={items} />;
}
