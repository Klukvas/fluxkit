import {
  Alert,
  Button,
  DataTable,
  StatusBadge,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { PATHS, buildPath } from "../../router/paths";
import { DescriptorText, linkClass } from "../orders/order-parts";
import { moneyText, type MoneyContext } from "../orders/order-view";
import type { AttentionList, AttentionRow } from "./attention-list";
import { PAYMENT_STATUS_TONES, attentionCodeKey, paymentStatusLabelKey } from "./payment-view";

/** The attention list's table and its "load more" part: props in, markup out, every word from the translator. */

export function AttentionTable({
  t,
  uiLocale,
  money,
  list,
}: {
  t: Translator;
  uiLocale: string;
  money: MoneyContext;
  list: AttentionList;
}) {
  const columns: DataTableColumn<AttentionRow>[] = [
    {
      id: "order",
      header: t("payment.list.order"),
      cell: (row) => (
        <Link
          to={buildPath(PATHS.orderDetail, { id: row.orderId })}
          className={`${linkClass} break-all`}
        >
          {t("payment.list.openOrder", { number: row.orderNumber })}
        </Link>
      ),
    },
    {
      id: "attention",
      header: t("payment.list.attention"),
      cell: (row) => {
        const code = attentionCodeKey(row.payment.attentionCode);
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t(`payment.attention.code.${code}`)}</span>
            <span className="text-sm text-muted-foreground">
              {t(`payment.attention.help.${code}`)}
            </span>
          </div>
        );
      },
    },
    {
      id: "status",
      header: t("payment.list.status"),
      cell: (row) => (
        <StatusBadge
          tone={PAYMENT_STATUS_TONES[row.payment.status]}
          label={t(paymentStatusLabelKey(row.payment.status))}
        />
      ),
    },
    {
      id: "amount",
      header: t("payment.list.amount"),
      cell: (row) => moneyText(row.payment.amount, money),
      align: "end",
    },
    {
      id: "provider",
      header: t("payment.list.provider"),
      cell: (row) => <span className="break-all">{row.payment.providerCode}</span>,
    },
    {
      id: "created",
      header: t("payment.list.created"),
      cell: (row) => formatDateTime(row.payment.createdAt, uiLocale),
    },
  ];
  return (
    <DataTable
      caption={t("payment.list.caption")}
      captionHidden
      columns={columns}
      rows={list.rows}
      rowKey={(row) => row.payment.id}
      rowHeaderColumnId="order"
      emptyMessage={t("payment.list.empty")}
    />
  );
}

/** The footer of the list: how many are shown, the failure of the last "load more", and the button while more exist. */
export function AttentionMore({
  t,
  count,
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  t: Translator;
  count: number;
  hasMore: boolean;
  loading: boolean;
  error: MessageDescriptor | null;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">
        {t(hasMore ? "payment.list.shownMore" : "payment.list.shown", { count })}
      </p>
      {error === null ? null : (
        <Alert variant="danger">
          <p>
            <DescriptorText t={t} descriptor={error} />
          </p>
        </Alert>
      )}
      {hasMore ? (
        <div>
          <Button
            variant="secondary"
            disabled={loading}
            aria-busy={loading || undefined}
            onClick={onLoadMore}
          >
            {loading ? t("payment.list.loading") : t("payment.list.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
