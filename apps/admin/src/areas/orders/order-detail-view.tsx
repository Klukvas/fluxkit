import type { AdminOrder, Address } from "@fluxkit/api-client";
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
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { PATHS } from "../../router/paths";
import { PageHeading } from "../../views/status-views";
import type { OrderAction } from "./order-actions";
import { linkClass } from "./order-parts";
import {
  ORDER_STATUS_TONES,
  customerDetailHref,
  customerOrdersHref,
  moneyText,
  orderLineRows,
  orderStatusLabelKey,
  orderTotalRows,
  snapshotText,
  type HistoryActor,
  type LineRow,
  type MoneyContext,
} from "./order-view";

/**
 * The order detail (plan step 8): summary, actions, contact, addresses, lines with their reservations, totals and the
 * status history. Presentational: props in, markup out. Every text of the order (names, addresses, reasons, titles) is
 * rendered as text; nothing is HTML.
 */

export const RESERVATION_STATUSES = ["active", "committed", "released", "expired"] as const;

export function actorText(t: Translator, actor: HistoryActor): string {
  switch (actor.kind) {
    case "you":
      return t("order.actor.you");
    case "email":
      return actor.email;
    case "other":
      return t("order.actor.another", { id: actor.shortId });
    case "system":
      return t("order.actor.system");
    case "customer":
      return t("order.actor.customer");
    case "guest":
      return t("order.actor.guest");
    case "removedAdmin":
      return t("order.actor.removedAdmin");
  }
}

function reservationText(t: Translator, status: string): string {
  return (RESERVATION_STATUSES as readonly string[]).includes(status)
    ? t(`order.reservation.${status}`)
    : status;
}

function dateOrNull(value: string | null, locale: string): string | null {
  return value === null ? null : formatDateTime(value, locale);
}

function AddressView({ t, address }: { t: Translator; address: Address | null }) {
  if (address === null)
    return <p className="text-muted-foreground">{t("order.detail.noAddress")}</p>;
  const recipient = [address.recipientFirstName, address.recipientLastName]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  const cityLine = [address.postalCode, address.city]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  const lines = [
    recipient,
    address.recipientPhone ?? "",
    address.line1,
    address.line2 ?? "",
    cityLine,
    address.region ?? "",
    address.countryCode,
  ].filter((line) => line !== "");
  return (
    <address className="flex flex-col not-italic">
      {lines.map((line, index) => (
        <span key={index} className="break-words">
          {line}
        </span>
      ))}
    </address>
  );
}

export interface HistoryRow {
  key: string;
  at: string;
  from: AdminOrder["history"][number]["fromStatus"];
  to: AdminOrder["history"][number]["toStatus"];
  actor: HistoryActor;
  reason: string | null;
}

export interface OrderDetailViewProps {
  t: Translator;
  uiLocale: string;
  order: AdminOrder;
  money: MoneyContext;
  history: readonly HistoryRow[];
  /** The actions to offer (hints, `offeredActions`); empty for a session without the orders write permission. */
  actions: readonly OrderAction[];
  onAction: (action: OrderAction) => void;
  /** Buttons are off while a write runs or the order reloads. */
  busy: boolean;
  /** The status line (always rendered, a focus target after an action). */
  statusLine: ReactNode;
  /** The delivery and shipments section (a slot: it has its own state and writes); omitted in the read-only previews. */
  delivery?: ReactNode;
  /** The payment section (a slot, like `delivery`): attempts, refunds, attention; omitted in the read-only previews. */
  payments?: ReactNode;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

const ACTION_BUTTON: Record<
  OrderAction,
  { key: string; variant: "primary" | "secondary" | "danger" }
> = {
  markPaid: { key: "order.action.markPaid", variant: "primary" },
  markFulfilled: { key: "order.action.markFulfilled", variant: "primary" },
  cancel: { key: "order.action.cancel", variant: "danger" },
};

export function OrderDetailView({
  t,
  uiLocale,
  order,
  money,
  history,
  actions,
  onAction,
  busy,
  statusLine,
  delivery,
  payments,
}: OrderDetailViewProps) {
  const lines: LineRow[] = orderLineRows(order, { ...money, orderLocale: order.locale });
  // An erased contact (privacy plan, ADR 0033) has no names, email or phone: say so instead of showing empty cells.
  const erased = order.contactErasedAt !== null;
  const erasedValue = (
    <span className="text-muted-foreground">{t("order.detail.erasedValue")}</span>
  );
  const customerHref = order.customerId === null ? null : customerDetailHref(order.customerId);

  const summary: DescriptionListItem[] = [
    {
      id: "status",
      term: t("order.detail.status"),
      description: (
        <StatusBadge
          tone={ORDER_STATUS_TONES[order.status]}
          label={t(orderStatusLabelKey(order.status))}
        />
      ),
    },
    {
      id: "placed",
      term: t("order.detail.placedAt"),
      description: formatDateTime(order.placedAt, uiLocale),
    },
  ];
  if (order.status === "awaiting_payment") {
    summary.push({
      id: "expires",
      term: t("order.detail.expiresAt"),
      description: formatDateTime(order.expiresAt, uiLocale),
    });
  }
  const dated: [string, string, string | null][] = [
    ["paid", "order.detail.paidAt", dateOrNull(order.paidAt, uiLocale)],
    ["fulfilled", "order.detail.fulfilledAt", dateOrNull(order.fulfilledAt, uiLocale)],
    ["cancelled", "order.detail.cancelledAt", dateOrNull(order.cancelledAt, uiLocale)],
    ["expired", "order.detail.expiredAt", dateOrNull(order.expiredAt, uiLocale)],
  ];
  for (const [id, key, text] of dated) {
    if (text !== null) summary.push({ id, term: t(key), description: text });
  }
  if (order.paymentReference !== null) {
    summary.push({
      id: "reference",
      term: t("order.detail.paymentReference"),
      description: <span className="break-all">{order.paymentReference}</span>,
    });
  }
  if (order.cancellationReason !== null) {
    summary.push({
      id: "reason",
      term: t("order.detail.cancellationReason"),
      description: (
        <span className="whitespace-pre-line break-words">{order.cancellationReason}</span>
      ),
    });
  }
  summary.push(
    { id: "language", term: t("order.detail.language"), description: order.locale },
    {
      id: "customer",
      term: t("order.detail.customer"),
      description: (
        <span className="flex flex-col gap-1">
          {erased || order.contact.email === null ? (
            erasedValue
          ) : customerHref === null ? (
            <span className="break-all">{order.contact.email}</span>
          ) : (
            <Link to={customerHref} className={linkClass}>
              {order.contact.email}
            </Link>
          )}
          <small className="text-muted-foreground">
            {order.isGuest
              ? t("order.detail.guestOrder")
              : order.customerId === null
                ? t("order.detail.accountDeleted")
                : t("order.detail.accountOrder")}
          </small>
          {order.customerId === null ? null : (
            <Link to={customerOrdersHref(order.customerId)} className={linkClass}>
              {t("order.detail.customerOrders")}
            </Link>
          )}
        </span>
      ),
    },
  );

  const contact: DescriptionListItem[] = [
    {
      id: "name",
      term: t("order.detail.name"),
      description: erased ? (
        erasedValue
      ) : (
        <span className="break-words">
          {t("order.detail.fullName", {
            first: order.contact.firstName ?? "",
            last: order.contact.lastName ?? "",
          })}
        </span>
      ),
    },
    {
      id: "email",
      term: t("order.detail.email"),
      description: erased ? erasedValue : <span className="break-all">{order.contact.email}</span>,
    },
    {
      id: "phone",
      term: t("order.detail.phone"),
      description: erased ? erasedValue : order.contact.phone,
    },
  ];

  const lineColumns: DataTableColumn<LineRow>[] = [
    {
      id: "product",
      header: t("order.lines.product"),
      cell: (row) => (
        <span className="flex items-start gap-3">
          {row.imageUrl === null ? null : (
            <img
              src={row.imageUrl}
              alt=""
              width={48}
              height={48}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="size-12 shrink-0 rounded-sm border border-border object-cover"
            />
          )}
          <span className="flex flex-col">
            <span className="break-words">{row.title}</span>
            {row.variantTitle === null ? null : (
              <small className="text-muted-foreground">{row.variantTitle}</small>
            )}
            {row.options.map((entry, index) => (
              <small key={index} className="text-muted-foreground">
                {t("order.lines.optionValue", { option: entry.option, value: entry.value })}
              </small>
            ))}
            {row.requiresShipping ? null : (
              <small className="text-muted-foreground">{t("order.lines.noShipping")}</small>
            )}
          </span>
        </span>
      ),
    },
    {
      id: "sku",
      header: t("order.lines.sku"),
      cell: (row) => <span className="break-all">{row.sku}</span>,
    },
    {
      id: "unitPrice",
      header: t("order.lines.unitPrice"),
      align: "end",
      cell: (row) => (
        <span className="flex flex-col">
          <span>{row.unitPrice}</span>
          {row.compareAt === null ? null : (
            <small className="text-muted-foreground">
              {t("order.lines.compareAt", { amount: row.compareAt })}
            </small>
          )}
        </span>
      ),
    },
    {
      id: "quantity",
      header: t("order.lines.quantity"),
      align: "end",
      cell: (row) => new Intl.NumberFormat(uiLocale).format(row.quantity),
    },
    {
      id: "lineTotal",
      header: t("order.lines.lineTotal"),
      align: "end",
      cell: (row) => row.lineTotal,
    },
    {
      id: "reservations",
      header: t("order.lines.reservations"),
      cell: (row) =>
        row.reservations.length === 0 ? (
          <span className="text-muted-foreground">{t("order.lines.noReservations")}</span>
        ) : (
          <ul className="flex flex-col">
            {row.reservations.map((reservation, index) => (
              <li key={index}>
                {t("order.lines.reservation", {
                  status: reservationText(t, reservation.status),
                  quantity: new Intl.NumberFormat(uiLocale).format(reservation.quantity),
                })}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  const totals: DescriptionListItem[] = orderTotalRows(order, money).map((row) => ({
    id: row.id,
    term: t(`order.totals.${row.id}`),
    description: row.id === "total" ? <strong>{row.text}</strong> : row.text,
  }));

  const historyColumns: DataTableColumn<HistoryRow>[] = [
    { id: "at", header: t("order.history.at"), cell: (row) => formatDateTime(row.at, uiLocale) },
    {
      id: "change",
      header: t("order.history.change"),
      cell: (row) =>
        row.from === null
          ? t("order.history.placed", { to: t(orderStatusLabelKey(row.to)) })
          : t("order.history.changed", {
              from: t(orderStatusLabelKey(row.from)),
              to: t(orderStatusLabelKey(row.to)),
            }),
    },
    {
      id: "actor",
      header: t("order.history.actor"),
      cell: (row) => <span className="break-all">{actorText(t, row.actor)}</span>,
    },
    {
      id: "reason",
      header: t("order.history.reason"),
      cell: (row) =>
        row.reason === null ? (
          <span className="text-muted-foreground">{t("order.history.noReason")}</span>
        ) : (
          <span className="whitespace-pre-line break-words">{row.reason}</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p>
          <Link to={PATHS.orders} className={linkClass}>
            {t("order.detail.backToList")}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <PageHeading>{t("order.detail.title", { number: order.number })}</PageHeading>
          <StatusBadge
            tone={ORDER_STATUS_TONES[order.status]}
            label={t(orderStatusLabelKey(order.status))}
          />
        </div>
      </div>
      {statusLine}
      {actions.length === 0 ? null : (
        <Section id="order-actions" title={t("order.detail.actions")}>
          <p className="text-muted-foreground">{t("order.detail.actionsHint")}</p>
          <div className="flex flex-wrap gap-3">
            {actions.map((action) => (
              <Button
                key={action}
                variant={ACTION_BUTTON[action].variant}
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => onAction(action)}
              >
                {t(ACTION_BUTTON[action].key)}
              </Button>
            ))}
          </div>
        </Section>
      )}
      <Section id="order-summary" title={t("order.detail.summary")}>
        <DescriptionList items={summary} />
      </Section>
      <Section id="order-contact" title={t("order.detail.contact")}>
        {order.contactErasedAt === null ? null : (
          <Alert variant="info">
            {t("order.detail.contactErased", {
              date: formatDateTime(order.contactErasedAt, uiLocale),
            })}
          </Alert>
        )}
        <DescriptionList items={contact} />
      </Section>
      <div className="grid gap-8 md:grid-cols-2">
        <Section id="order-shipping" title={t("order.detail.shippingAddress")}>
          <AddressView t={t} address={order.shippingAddress} />
        </Section>
        <Section id="order-billing" title={t("order.detail.billingAddress")}>
          <AddressView t={t} address={order.billingAddress} />
        </Section>
      </div>
      {payments}
      {delivery}
      <Section id="order-lines" title={t("order.detail.lines")}>
        <DataTable
          caption={t("order.lines.caption", { number: order.number })}
          captionHidden
          columns={lineColumns}
          rows={lines}
          rowKey={(row) => row.key}
          emptyMessage={t("order.lines.empty")}
        />
      </Section>
      <Section id="order-totals" title={t("order.detail.totals")}>
        <DescriptionList items={totals} />
        {order.adjustments.length === 0 ? null : (
          <ul className="flex flex-col gap-1">
            {order.adjustments.map((adjustment, index) => (
              <li key={index}>
                {t(
                  adjustment.includedInPrice
                    ? "order.totals.adjustmentIncluded"
                    : "order.totals.adjustment",
                  {
                    label:
                      snapshotText(adjustment.label, uiLocale, order.locale) || adjustment.code,
                    amount: moneyText(adjustment.amount, money),
                  },
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="order-history" title={t("order.detail.history")}>
        <DataTable
          caption={t("order.history.caption", { number: order.number })}
          captionHidden
          columns={historyColumns}
          rows={history}
          rowKey={(row) => row.key}
          emptyMessage={t("order.history.empty")}
        />
      </Section>
    </div>
  );
}
