import type {
  Money,
  OrderShipping,
  PickupPointKind,
  ShipmentStatus,
  ShippingOption,
} from "@fluxkit/api-client";
import type { Translator } from "@fluxkit/ui";
import { PICKUP_KINDS, SHIPMENT_STATUSES, UNAVAILABLE_REASONS } from "./shipping-model";

/**
 * The words of the delivery step, as message KEYS and small pure functions over a translator. Amounts are only formatted by
 * the `money` callback the caller passes (`formatMoney`/`orderMoney`); nothing here adds or compares money beyond "is the
 * price zero", which picks the word "Free".
 */

type MoneyText = (amount: Money) => string;

/** What a delivery costs the shopper, in words: the price, "Free", or "paid to the carrier on delivery" with the estimate. */
export function shippingPriceText(
  t: Translator,
  option: Pick<ShippingOption, "price" | "payer" | "estimate">,
  money: MoneyText,
): string {
  if (option.payer === "recipient_on_delivery") {
    return option.estimate === null
      ? t("checkout.shipping.price.onDelivery")
      : t("checkout.shipping.price.onDeliveryEstimate", { estimate: money(option.estimate) });
  }
  if (option.price === null) return "";
  return option.price.amount === 0 ? t("checkout.shipping.price.free") : money(option.price);
}

/** The same for the delivery snapshot of an order (its amount is what the shop charged). */
export function orderShippingPriceText(
  t: Translator,
  shipping: Pick<OrderShipping, "amount" | "payer" | "estimatedCarrierAmount">,
  money: MoneyText,
): string {
  if (shipping.payer === "recipient_on_delivery") {
    return shipping.estimatedCarrierAmount === null
      ? t("order.shipping.onDelivery")
      : t("order.shipping.onDeliveryEstimate", {
          estimate: money(shipping.estimatedCarrierAmount),
        });
  }
  return shipping.amount.amount === 0 ? t("order.shipping.free") : money(shipping.amount);
}

/** Why a method cannot be chosen, one message per reason of the API (an unknown future reason gets the neutral text). */
export function unavailableText(t: Translator, option: Pick<ShippingOption, "reason">): string {
  const reason = option.reason;
  return reason !== undefined && UNAVAILABLE_REASONS.includes(reason)
    ? t(`checkout.shipping.unavailable.${reason}`)
    : t("checkout.shipping.unavailable.default");
}

/** `order.shipment.status.<status>`; a status the storefront does not know yet gets a neutral text, never a broken key. */
export function shipmentStatusKey(status: ShipmentStatus): string {
  return SHIPMENT_STATUSES.includes(status)
    ? `order.shipment.status.${status}`
    : "order.shipment.status.fallback";
}

export function pickupKindKey(kind: PickupPointKind): string {
  return PICKUP_KINDS.includes(kind)
    ? `checkout.shipping.point.kind.${kind}`
    : "checkout.shipping.point.kind.branch";
}
