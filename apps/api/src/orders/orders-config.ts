import {
  DEFAULT_ORDER_GUEST_ACCESS_DAYS,
  DEFAULT_ORDER_PAYMENT_TTL_MINUTES,
} from "@fluxkit/config";

export const ORDERS_CONFIG = Symbol("ORDERS_CONFIG");

/** From `ORDER_PAYMENT_TTL_MINUTES` and `ORDER_GUEST_ACCESS_DAYS` (docs/contracts/config.md). */
export interface OrdersConfig {
  /** Minutes an order waits for payment (5 to 1440); its reservations outlive it by the fixed grace of core. */
  paymentTtlMinutes: number;
  /** Days a guest may open an order with its access token (1 to 3650). */
  guestAccessDays: number;
}

export const DEFAULT_ORDERS_CONFIG: Readonly<OrdersConfig> = Object.freeze({
  paymentTtlMinutes: DEFAULT_ORDER_PAYMENT_TTL_MINUTES,
  guestAccessDays: DEFAULT_ORDER_GUEST_ACCESS_DAYS,
});
