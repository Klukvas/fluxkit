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
import { CANCEL_FOCUS_IDS } from "../lib/cancel-focus";
import { formatDateTime } from "../lib/date";
import { failureText } from "../lib/failure";
import { canCancel, orderMoney, orderStatusKey, type ShopMoney } from "../lib/order-model";
import type { CancelState } from "../lib/order-store";
import { orderShippingPriceText, pickupKindKey, shipmentStatusKey } from "../lib/shipping-text";

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

/** The status of a carrier waybill is always text; the badge colour is only a hint. */
const SHIPMENT_BADGE: Record<string, BadgeVariant> = {
  delivered: "success",
  arrived: "success",
  returning: "warning",
  returned: "warning",
  cancelled: "neutral",
  failed: "danger",
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
  // The delivery row shows the snapshot's own wording (Free, or paid to the carrier on delivery); without a snapshot (an order
  // placed before shipping existed) a zero is left out as before. Not money math, a display rule.
  const totals: [string, string][] = [
    ["order.totals.subtotal", money(order.subtotal)],
    ...(order.shipping !== null
      ? [
          ["order.totals.shipping", orderShippingPriceText(t, order.shipping, money)] as [
            string,
            string,
          ],
        ]
      : order.shippingTotal.amount === 0
        ? []
        : [["order.totals.shipping", money(order.shippingTotal)] as [string, string]]),
    ...(order.discountTotal.amount === 0
      ? []
      : [["order.totals.discount", money(order.discountTotal)] as [string, string]]),
    ...(order.taxTotal.amount === 0
      ? []
      : [["order.totals.tax", money(order.taxTotal)] as [string, string]]),
  ];
  const point = order.shipping?.destination ?? null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold text-foreground">
        {t("order.heading", { number: order.number })}
      </h1>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        id={CANCEL_FOCUS_IDS.status}
        tabIndex={-1}
        className="min-h-6 rounded-md text-muted-foreground outline-offset-2 focus:outline-2 focus:outline-ring"
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
                <Button
                  id={CANCEL_FOCUS_IDS.keep}
                  variant="secondary"
                  onClick={onKeepOrder}
                  disabled={cancel.pending}
                  aria-describedby="order-cancel-question"
                >
                  {t("order.cancel.no")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              id={CANCEL_FOCUS_IDS.ask}
              variant="secondary"
              className="self-start"
              onClick={onAskCancel}
            >
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
              <dd className="text-end">{value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-6 font-semibold">
            <dt>{t("order.totals.total")}</dt>
            <dd>{money(order.total)}</dd>
          </div>
        </dl>
      </section>

      {order.shipping === null ? null : (
        <section aria-labelledby="order-shipping-heading" className="flex flex-col gap-3">
          <h2 id="order-shipping-heading" className="text-xl font-semibold text-foreground">
            {t("order.shipping.title")}
          </h2>
          <dl className="flex max-w-xl flex-col gap-2 text-foreground">
            <div className="flex flex-wrap gap-x-6">
              <dt className="w-40 text-muted-foreground">{t("order.shipping.method")}</dt>
              <dd>{order.shipping.title}</dd>
            </div>
            <div className="flex flex-wrap gap-x-6">
              <dt className="w-40 text-muted-foreground">{t("order.shipping.price")}</dt>
              <dd>{orderShippingPriceText(t, order.shipping, money)}</dd>
            </div>
            {point === null ? null : (
              <div className="flex flex-wrap gap-x-6">
                <dt className="w-40 text-muted-foreground">{t("order.shipping.point")}</dt>
                <dd className="min-w-0 break-words">
                  {t("order.shipping.pointValue", {
                    kind: t(pickupKindKey(point.kind)),
                    number: point.number,
                    city: point.cityName,
                    description: point.description,
                  })}
                </dd>
              </div>
            )}
          </dl>
          {order.shipments.length === 0 ? null : (
            <section aria-labelledby="order-shipments-heading" className="flex flex-col gap-2">
              <h3 id="order-shipments-heading" className="font-semibold text-foreground">
                {t("order.shipments.title")}
              </h3>
              <ul aria-label={t("order.shipments.label")} className="flex flex-col gap-2">
                {order.shipments.map((shipment, index) => (
                  <li key={`${shipment.trackingNumber}-${String(index)}`}>
                    <Card className="p-4">
                      <dl className="flex flex-col gap-2 text-foreground">
                        <div className="flex flex-wrap gap-x-6">
                          <dt className="w-40 text-muted-foreground">
                            {t("order.shipment.tracking")}
                          </dt>
                          {/* The number as the carrier gave it: a code, never translated. */}
                          <dd className="break-all">{shipment.trackingNumber}</dd>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-6">
                          <dt className="w-40 text-muted-foreground">
                            {t("order.shipment.status")}
                          </dt>
                          <dd>
                            <Badge variant={SHIPMENT_BADGE[shipment.status] ?? "neutral"}>
                              {t(shipmentStatusKey(shipment.status))}
                            </Badge>
                          </dd>
                        </div>
                      </dl>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}

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

      {order.shippingAddress === null || point !== null ? null : (
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
