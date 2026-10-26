import { resolveTextWithFallback, type AdminOrderTexts, type AdminOrderView } from "@fluxkit/core";
import {
  boundedOrderMailText,
  ORDER_MAIL_MAX_LINES,
  type OrderClosedVariables,
  type OrderPaidVariables,
  type OrderPlacedVariables,
  type ShipmentCreatedVariables,
} from "../templates/index.js";

/*
 * Builds the frozen variables of the order and shipment mails from the order view (`OrderReadPort`). Pure: the view and
 * the locales in, small structured data out (ids, the order number, minor units, bounded texts). Texts are resolved for
 * the order's locale when the mail is enqueued (the snapshot holds every locale; the mail stores one text), so the stored
 * mail renders the same later whatever the catalog does. Nothing here puts a phone, a street, a token or a link into
 * the variables.
 */

/** The text of a translated snapshot field for the order's locale, cut to the mail's bound; `fallback` when it has none. */
function textOf(
  texts: AdminOrderTexts | null,
  locale: string,
  defaultLocale: string,
  fallback: string,
): string {
  return boundedOrderMailText(resolveTextWithFallback(texts, locale, defaultLocale) ?? fallback);
}

export function orderPlacedVariables(
  view: AdminOrderView,
  defaultLocale: string,
): OrderPlacedVariables {
  const shown = view.items.slice(0, ORDER_MAIL_MAX_LINES);
  const pickup = view.shipping?.destination ?? null;
  const city = pickup === null ? (view.shippingAddress?.city ?? null) : null;
  return {
    orderNumber: view.number,
    currency: view.currency,
    lines: shown.map((item) => ({
      title: textOf(item.productTitle, view.locale, defaultLocale, item.sku),
      variantTitle:
        item.variantTitle === null
          ? null
          : textOf(item.variantTitle, view.locale, defaultLocale, item.sku),
      quantity: item.quantity,
      lineTotal: item.lineTotal.amount,
    })),
    moreLines: view.items.length - shown.length,
    subtotal: view.subtotal.amount,
    shipping: view.shippingTotal.amount,
    // Discounts are stored as negative adjustments; the mail prints the amount taken off.
    discount: Math.abs(view.discountTotal.amount),
    total: view.total.amount,
    delivery: {
      methodTitle:
        view.shipping === null
          ? null
          : textOf(view.shipping.title, view.locale, defaultLocale, view.shipping.methodCode),
      pickupPoint:
        pickup === null
          ? null
          : {
              number: boundedOrderMailText(pickup.number),
              city: boundedOrderMailText(pickup.cityName),
              description: boundedOrderMailText(pickup.description),
            },
      city: city === null || city.trim() === "" ? null : boundedOrderMailText(city),
    },
    // The deadline only while it still applies: a late-delivered event for an order paid or closed since says nothing of it.
    payBefore: view.status === "awaiting_payment" ? new Date(view.expiresAt).toISOString() : null,
  };
}

export function orderPaidVariables(view: AdminOrderView): OrderPaidVariables {
  return { orderNumber: view.number, currency: view.currency, total: view.total.amount };
}

export function orderClosedVariables(view: AdminOrderView): OrderClosedVariables {
  return { orderNumber: view.number };
}

/** `undefined` when the shipment is not on the order or has no tracking number yet (nothing useful to send). */
export function shipmentCreatedVariables(
  view: AdminOrderView,
  shipmentId: string,
  defaultLocale: string,
): ShipmentCreatedVariables | undefined {
  const shipment = view.shipments.find((entry) => entry.id === shipmentId);
  if (shipment === undefined || shipment.trackingNumber === null) {
    return undefined;
  }
  return {
    orderNumber: view.number,
    carrierTitle:
      view.shipping === null
        ? null
        : textOf(view.shipping.title, view.locale, defaultLocale, view.shipping.methodCode),
    trackingNumber: shipment.trackingNumber,
  };
}
