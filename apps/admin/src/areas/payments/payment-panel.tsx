import type {
  AdminPayment,
  AdminPaymentHistoryEntry,
  AdminPaymentRefund,
} from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  DescriptionList,
  StatusBadge,
  type DataTableColumn,
  type DescriptionListItem,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode } from "react";
import { formatDateTime } from "../../lib/format";
import { actorText } from "../orders/order-detail-view";
import { moneyText, type MoneyContext } from "../orders/order-view";
import type { PaymentNotice } from "./payment-outcome";
import {
  PAYMENT_STATUS_TONES,
  REFUND_STATUS_TONES,
  attentionCodeKey,
  paymentEntryActor,
  paymentStatusLabelKey,
  refundActor,
  refundStatusLabelKey,
  type PaymentAction,
} from "./payment-view";

/**
 * The payment part of the order detail (payments plan step 10): the order's payment attempts with their refunds, attention
 * flags and journal, and the actions the session may take. Presentational: props in, markup out, every word from the
 * translator. Provider text is never shown; the card is the system and the last four digits only (the API sends nothing
 * more); free texts (a refund note) are rendered as text.
 */

const ACTION_BUTTONS: Record<
  PaymentAction,
  { key: string; variant: "primary" | "secondary" | "danger" }
> = {
  refund: { key: "payment.action.refund", variant: "danger" },
  resync: { key: "payment.action.resync", variant: "secondary" },
  clearAttention: { key: "payment.action.clearAttention", variant: "secondary" },
};

export function PaymentNoticeView({
  t,
  uiLocale,
  money,
  notice,
}: {
  t: Translator;
  uiLocale: string;
  money: MoneyContext;
  notice: PaymentNotice | null;
}) {
  if (notice === null) return null;
  switch (notice.kind) {
    case "refund": {
      const amount = moneyText(notice.amount, money);
      const variant =
        notice.status === "succeeded"
          ? "success"
          : notice.status === "failed"
            ? "danger"
            : "warning";
      return (
        <Alert variant={variant} title={t(`payment.notice.refund.${notice.status}.title`)}>
          <p>{t(`payment.notice.refund.${notice.status}`, { amount })}</p>
          {notice.failureCode === null ? null : (
            <p className="text-sm">
              {t("payment.notice.codes")}{" "}
              <span className="break-all font-mono">{notice.failureCode}</span>
            </p>
          )}
          {notice.replay ? <p>{t("payment.notice.refund.replay")}</p> : null}
        </Alert>
      );
    }
    case "refundLost":
      return (
        <Alert variant="warning" title={t("payment.notice.lostTitle")}>
          <p>{t("payment.notice.refundLost")}</p>
        </Alert>
      );
    case "resynced":
      return (
        <Alert variant="success">
          {t("payment.notice.resynced", { at: formatDateTime(notice.at, uiLocale) })}
        </Alert>
      );
    case "resyncLost":
      return (
        <Alert variant="warning" title={t("payment.notice.lostTitle")}>
          <p>{t("payment.notice.resyncLost")}</p>
        </Alert>
      );
    case "cleared":
      return <Alert variant="success">{t("payment.notice.cleared")}</Alert>;
    case "clearLost":
      return (
        <Alert variant="warning" title={t("payment.notice.lostTitle")}>
          <p>{t("payment.notice.clearLost")}</p>
        </Alert>
      );
  }
}

/** The attention banner of one payment: the translated code and what to do. Nothing for a payment without an open item. */
export function AttentionBanner({
  t,
  payment,
}: {
  t: Translator;
  payment: Pick<AdminPayment, "needsAttention" | "attentionCode">;
}) {
  if (!payment.needsAttention) return null;
  const code = attentionCodeKey(payment.attentionCode);
  return (
    <Alert variant="warning" title={t("payment.attention.title")}>
      <p className="font-medium">{t(`payment.attention.code.${code}`)}</p>
      <p>{t(`payment.attention.help.${code}`)}</p>
    </Alert>
  );
}

function CardText({ t, card }: { t: Translator; card: AdminPayment["card"] }) {
  if (card === null)
    return <span className="text-muted-foreground">{t("payment.field.noCard")}</span>;
  return <span className="break-all">{t("payment.field.cardValue", { ...card })}</span>;
}

function journalChange(t: Translator, entry: AdminPaymentHistoryEntry): ReactNode {
  if (entry.action === "attention_cleared") return t("payment.journal.attentionCleared");
  const parts: string[] = [];
  if (entry.toStatus !== null) {
    parts.push(
      entry.fromStatus === null
        ? t("payment.journal.first", { to: t(paymentStatusLabelKey(entry.toStatus)) })
        : t("payment.journal.changed", {
            from: t(paymentStatusLabelKey(entry.fromStatus)),
            to: t(paymentStatusLabelKey(entry.toStatus)),
          }),
    );
  }
  if (entry.providerStatus !== null) {
    parts.push(t("payment.journal.providerStatus", { status: entry.providerStatus }));
  }
  if (!entry.applied && entry.action === null) parts.push(t("payment.journal.notApplied"));
  if (entry.failureCode !== null) {
    parts.push(t("payment.journal.failure", { code: entry.failureCode }));
  }
  return parts.length === 0 ? (
    <span className="text-muted-foreground">{t("payment.journal.noChange")}</span>
  ) : (
    <span className="break-words">{parts.join(". ")}</span>
  );
}

export interface PaymentCardProps {
  t: Translator;
  uiLocale: string;
  money: MoneyContext;
  payment: AdminPayment;
  actions: readonly PaymentAction[];
  onAction: (payment: AdminPayment, action: PaymentAction) => void;
  busy: boolean;
  meId: string;
  emails: ReadonlyMap<string, string> | null;
}

export function PaymentCard({
  t,
  uiLocale,
  money,
  payment,
  actions,
  onAction,
  busy,
  meId,
  emails,
}: PaymentCardProps) {
  const headingId = `payment-${payment.id}`;
  const date = (value: string) => formatDateTime(value, uiLocale);
  const items: DescriptionListItem[] = [
    {
      id: "status",
      term: t("payment.field.status"),
      description: (
        <StatusBadge
          tone={PAYMENT_STATUS_TONES[payment.status]}
          label={t(paymentStatusLabelKey(payment.status))}
        />
      ),
    },
    {
      id: "amount",
      term: t("payment.field.amount"),
      description: moneyText(payment.amount, money),
    },
  ];
  if (payment.finalAmount !== null) {
    items.push({
      id: "finalAmount",
      term: t("payment.field.finalAmount"),
      description: moneyText(payment.finalAmount, money),
    });
  }
  if (payment.status === "succeeded") {
    items.push(
      {
        id: "refunded",
        term: t("payment.field.refunded"),
        description: moneyText(payment.refundedAmount, money),
      },
      {
        id: "refundable",
        term: t("payment.field.refundable"),
        description: moneyText(payment.refundableAmount, money),
      },
    );
  }
  items.push(
    {
      id: "provider",
      term: t("payment.field.provider"),
      description: <span className="break-all">{payment.providerCode}</span>,
    },
    {
      id: "card",
      term: t("payment.field.card"),
      description: <CardText t={t} card={payment.card} />,
    },
    {
      id: "createdBy",
      term: t("payment.field.createdBy"),
      description: t(`payment.createdBy.${payment.createdBy}`),
    },
  );
  if (payment.orderOutcome !== null) {
    items.push({
      id: "outcome",
      term: t("payment.field.outcome"),
      description: t(`payment.outcome.${payment.orderOutcome}`),
    });
  }
  if (payment.failureCode !== null) {
    items.push({
      id: "failure",
      term: t("payment.field.failureCode"),
      description: <span className="break-all font-mono">{payment.failureCode}</span>,
    });
  }
  items.push(
    { id: "created", term: t("payment.field.created"), description: date(payment.createdAt) },
    { id: "updated", term: t("payment.field.updated"), description: date(payment.updatedAt) },
  );
  if (payment.nextCheckAt !== null) {
    items.push({
      id: "nextCheck",
      term: t("payment.field.nextCheck"),
      description: date(payment.nextCheckAt),
    });
  }

  const refundColumns: DataTableColumn<AdminPaymentRefund>[] = [
    { id: "at", header: t("payment.refunds.at"), cell: (row) => date(row.createdAt) },
    {
      id: "amount",
      header: t("payment.refunds.amount"),
      cell: (row) => moneyText(row.amount, money),
      align: "end",
    },
    {
      id: "status",
      header: t("payment.refunds.status"),
      cell: (row) => (
        <StatusBadge
          tone={REFUND_STATUS_TONES[row.status]}
          label={t(refundStatusLabelKey(row.status))}
        />
      ),
    },
    {
      id: "reason",
      header: t("payment.refunds.reason"),
      cell: (row) => t(`payment.refundReason.${row.reason}`),
    },
    {
      id: "note",
      header: t("payment.refunds.note"),
      cell: (row) =>
        row.note === null ? (
          <span className="text-muted-foreground">{t("payment.refunds.noNote")}</span>
        ) : (
          <span className="break-words">{row.note}</span>
        ),
    },
    {
      id: "actor",
      header: t("payment.refunds.actor"),
      cell: (row) => (
        <span className="break-all">
          {actorText(t, refundActor(row.actorAdminId, meId, emails))}
        </span>
      ),
    },
    {
      id: "code",
      header: t("payment.refunds.code"),
      cell: (row) =>
        row.failureCode === null ? (
          <span className="text-muted-foreground">{t("payment.refunds.noCode")}</span>
        ) : (
          <span className="break-all font-mono">{row.failureCode}</span>
        ),
    },
  ];
  const waiting = payment.refunds.some(
    (refund) => refund.status === "requested" || refund.status === "unknown",
  );

  const journal = payment.history;
  const journalColumns: DataTableColumn<AdminPaymentHistoryEntry>[] = [
    { id: "at", header: t("payment.journal.at"), cell: (row) => date(row.at) },
    {
      id: "source",
      header: t("payment.journal.source"),
      cell: (row) => t(`payment.source.${row.source}`),
    },
    { id: "change", header: t("payment.journal.change"), cell: (row) => journalChange(t, row) },
    {
      id: "actor",
      header: t("payment.journal.actor"),
      cell: (row) => (
        <span className="break-all">
          {row.source === "admin"
            ? actorText(t, paymentEntryActor(row, meId, emails))
            : t("payment.journal.noActor")}
        </span>
      ),
    },
  ];

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-md border border-border p-4"
    >
      <h3 id={headingId} className="text-base font-semibold text-foreground">
        {t("payment.card.title", {
          amount: moneyText(payment.amount, money),
          at: date(payment.createdAt),
        })}
      </h3>
      <AttentionBanner t={t} payment={payment} />
      {!payment.needsAttention && payment.attentionCode !== null ? (
        <p className="text-muted-foreground">
          {t("payment.attention.closed", {
            code: t(`payment.attention.code.${attentionCodeKey(payment.attentionCode)}`),
          })}
        </p>
      ) : null}
      {payment.status === "create_unknown" ? (
        <Alert variant="warning" title={t("payment.card.unknownTitle")}>
          <p>{t("payment.card.unknownBody")}</p>
        </Alert>
      ) : null}
      <DescriptionList items={items} />
      {actions.length === 0 ? null : (
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
            <Button
              key={action}
              variant={ACTION_BUTTONS[action].variant}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => onAction(payment, action)}
            >
              {t(ACTION_BUTTONS[action].key)}
            </Button>
          ))}
        </div>
      )}
      {waiting ? (
        <Alert variant="warning">
          <p>{t("payment.refunds.waiting")}</p>
        </Alert>
      ) : null}
      <DataTable
        caption={t("payment.refunds.caption")}
        columns={refundColumns}
        rows={payment.refunds}
        rowKey={(row) => row.id}
        emptyMessage={t("payment.refunds.empty")}
      />
      <details className="flex flex-col gap-2">
        <summary className="cursor-pointer font-medium text-foreground">
          {t("payment.journal.summary", { count: journal.length })}
        </summary>
        <DataTable
          caption={t("payment.journal.caption")}
          captionHidden
          columns={journalColumns}
          rows={journal}
          rowKey={(row) => String(journal.indexOf(row))}
          emptyMessage={t("payment.journal.empty")}
        />
      </details>
    </article>
  );
}

export interface PaymentPanelProps {
  t: Translator;
  uiLocale: string;
  money: MoneyContext;
  payments: readonly AdminPayment[];
  /** The actions offered for each payment (`offeredPaymentActions`). */
  actionsFor: (payment: AdminPayment) => readonly PaymentAction[];
  onAction: (payment: AdminPayment, action: PaymentAction) => void;
  busy: boolean;
  meId: string;
  emails: ReadonlyMap<string, string> | null;
  /** The status line (always rendered, a focus target after an action). */
  statusLine: ReactNode;
}

export function PaymentPanel({
  t,
  uiLocale,
  money,
  payments,
  actionsFor,
  onAction,
  busy,
  meId,
  emails,
  statusLine,
}: PaymentPanelProps) {
  return (
    <section aria-labelledby="order-payments" className="flex flex-col gap-4">
      <h2 id="order-payments" className="text-lg font-semibold text-foreground">
        {t("payment.title")}
      </h2>
      {statusLine}
      {payments.length === 0 ? (
        <p className="text-muted-foreground">{t("payment.none")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {payments.map((payment) => (
            <PaymentCard
              key={payment.id}
              t={t}
              uiLocale={uiLocale}
              money={money}
              payment={payment}
              actions={actionsFor(payment)}
              onAction={onAction}
              busy={busy}
              meId={meId}
              emails={emails}
            />
          ))}
        </div>
      )}
    </section>
  );
}
