import type { Address, Order } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  type BadgeVariant,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import { formatDateTime } from "../lib/date";
import { failureText } from "../lib/failure";
import { canCancel, orderMoney, orderStatusKey, type ShopMoney } from "../lib/order-model";
import type { CancelState } from "../lib/order-store";

/**
 * One order as the guest order page and the customer's order page show it: status (text and badge, never colour alone),
 * the payment wording while it awaits payment (owner answer 9: neutral message keys a shop replaces, the expiry time, no
 * claim that paying online is possible), items, totals, contact, address, history, and the cancel with a confirmation
 * step. Pure: props in, markup out. Every amount is the API's, only formatted.
 */

const STATUS_BADGE: Record<string, BadgeVariant> = {
  awaiting_payment: "warning",
  paid: "success",
  fulfilled: "success",
  cancelled: "neutral",
  expired: "neutral",
};

function countryName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
}

/** The address lines in a neutral order; a shop that needs another postal format changes this function only. */
export function addressLines(address: Address, locale: string): string[] {
  const recipient = [address.recipientFirstName, address.recipientLastName]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  const place = [address.postalCode, address.city].filter((part) => part !== undefined).join(" ");
  return [
    recipient,
    address.line1,
    address.line2 ?? "",
    place,
    address.region ?? "",
    countryName(address.countryCode, locale),
    address.recipientPhone ?? "",
  ].filter((line) => line !== "");
}

export interface OrderDetailsViewProps {
  order: Order;
  t: Translator;
  locale: Locale;
  shop: ShopMoney;
  cancel: CancelState;
  onAskCancel: () => void;
  onKeepOrder: () => void;
  onConfirmCancel: () => void;
}

export function OrderDetailsView({
  order,
  t,
  locale,
  shop,
  cancel,
  onAskCancel,
  onKeepOrder,
  onConfirmCancel,
}: OrderDetailsViewProps) {
  const money = (value: Order["total"]) => orderMoney(value, shop, locale);
  const status = t(orderStatusKey(order.status));
  const totals: [string, Order["total"]][] = [
    ["order.totals.subtotal", order.subtotal],
    // Zero lines are left out: no shipping, discount or tax exists yet (docs/api/orders.md). Not money math, a display rule.
    ...(order.shippingTotal.amount === 0
      ? []
      : [["order.totals.shipping", order.shippingTotal] as [string, Order["total"]]]),
    ...(order.discountTotal.amount === 0
      ? []
      : [["order.totals.discount", order.discountTotal] as [string, Order["total"]]]),
    ...(order.taxTotal.amount === 0
      ? []
      : [["order.totals.tax", order.taxTotal] as [string, Order["total"]]]),
  ];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold text-foreground">
        {t("order.heading", { number: order.number })}
      </h1>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-6 text-muted-foreground"
      >
        {cancel.done ? t("order.cancel.done") : ""}
      </div>
      <dl className="flex max-w-md flex-col gap-2 text-foreground">
        <div className="flex flex-wrap items-center gap-x-6">
          <dt className="w-40 text-muted-foreground">{t("order.status.label")}</dt>
          <dd>
            <Badge variant={STATUS_BADGE[order.status] ?? "neutral"}>{status}</Badge>
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <dt className="w-40 text-muted-foreground">{t("order.placedAt")}</dt>
          <dd>{formatDateTime(order.placedAt, locale)}</dd>
        </div>
      </dl>

      {order.status === "awaiting_payment" ? (
        <Alert variant="info" title={t("order.payment.title")}>
          <p>{t("order.payment.awaiting", { time: formatDateTime(order.expiresAt, locale) })}</p>
        </Alert>
      ) : null}

      {canCancel(order) ? (
        <div className="flex flex-col gap-3">
          {cancel.failure === null ? null : (
            <Alert variant="danger">{failureText(t, cancel.failure)}</Alert>
          )}
          {cancel.confirming ? (
            <div className="flex flex-col gap-3" aria-busy={cancel.pending}>
              <p id="order-cancel-question" className="text-foreground">
                {t("order.cancel.question")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={onConfirmCancel}
                  disabled={cancel.pending}
                  aria-describedby="order-cancel-question"
                >
                  {cancel.pending ? t("order.cancel.pending") : t("order.cancel.yes")}
                </Button>
                <Button variant="secondary" onClick={onKeepOrder} disabled={cancel.pending}>
                  {t("order.cancel.no")}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" className="self-start" onClick={onAskCancel}>
              {t("order.cancel")}
            </Button>
          )}
        </div>
      ) : cancel.failure === null ? null : (
        <Alert variant="danger">{failureText(t, cancel.failure)}</Alert>
      )}

      <section aria-labelledby="order-items-heading" className="flex flex-col gap-3">
        <h2 id="order-items-heading" className="text-xl font-semibold text-foreground">
          {t("order.items.title")}
        </h2>
        <ul aria-label={t("order.items.label")} className="flex flex-col gap-3">
          {order.items.map((item, index) => (
            <li key={`${item.sku}-${String(index)}`}>
              <Card className="flex flex-wrap justify-between gap-4 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="font-semibold text-foreground">{item.productTitle}</h3>
                  {item.variantTitle === null ? null : (
                    <p className="text-sm text-muted-foreground">{item.variantTitle}</p>
                  )}
                  {item.optionValues.length === 0 ? null : (
                    <ul className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                      {item.optionValues.map((choice) => (
                        <li key={choice.option}>
                          {t("cart.line.option", { option: choice.option, value: choice.value })}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {t("product.sku", { sku: item.sku })}
                  </p>
                  <p className="text-sm text-foreground">
                    {t("order.item.quantity", { count: item.quantity })}
                  </p>
                </div>
                <dl className="flex flex-col items-end gap-1 text-foreground">
                  <div className="flex gap-2">
                    <dt className="text-sm text-muted-foreground">{t("order.item.unitPrice")}</dt>
                    <dd>{money(item.unitPrice)}</dd>
                  </div>
                  <div className="flex gap-2 font-semibold">
                    <dt className="text-sm text-muted-foreground">{t("order.item.total")}</dt>
                    <dd>{money(item.lineTotal)}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="order-totals-heading" className="flex flex-col gap-3">
        <h2 id="order-totals-heading" className="text-xl font-semibold text-foreground">
          {t("order.totals.title")}
        </h2>
        <dl className="flex max-w-sm flex-col gap-1 text-foreground">
          {totals.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-6">
              <dt className="text-muted-foreground">{t(key)}</dt>
              <dd>{money(value)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-6 font-semibold">
            <dt>{t("order.totals.total")}</dt>
            <dd>{money(order.total)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="order-contact-heading" className="flex flex-col gap-2">
        <h2 id="order-contact-heading" className="text-xl font-semibold text-foreground">
          {t("order.contact.title")}
        </h2>
        <p className="text-foreground">
          {order.contact.firstName} {order.contact.lastName}
        </p>
        <p className="break-all text-foreground">{order.contact.email}</p>
        <p className="text-foreground">{order.contact.phone}</p>
      </section>

      {order.shippingAddress === null ? null : (
        <section aria-labelledby="order-address-heading" className="flex flex-col gap-2">
          <h2 id="order-address-heading" className="text-xl font-semibold text-foreground">
            {t("order.address.title")}
          </h2>
          <address className="flex flex-col not-italic text-foreground">
            {addressLines(order.shippingAddress, locale).map((line, index) => (
              <span key={`${String(index)}-${line}`}>{line}</span>
            ))}
          </address>
        </section>
      )}

      {order.history.length === 0 ? null : (
        <section aria-labelledby="order-history-heading" className="flex flex-col gap-2">
          <h2 id="order-history-heading" className="text-xl font-semibold text-foreground">
            {t("order.history.title")}
          </h2>
          <ol className="flex flex-col gap-1 text-foreground">
            {order.history.map((entry, index) => (
              <li key={`${entry.at}-${String(index)}`}>
                {t("order.history.entry", {
                  status: t(orderStatusKey(entry.status)),
                  time: formatDateTime(entry.at, locale),
                })}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
