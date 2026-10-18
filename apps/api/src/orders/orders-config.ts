import {
  DEFAULT_MAX_OPEN_ORDERS,
  DEFAULT_ORDER_GUEST_ACCESS_DAYS,
  DEFAULT_ORDER_PAYMENT_TTL_MINUTES,
} from "@fluxkit/config";

export const ORDERS_CONFIG = Symbol("ORDERS_CONFIG");

/** From `ORDER_PAYMENT_TTL_MINUTES`, `ORDER_GUEST_ACCESS_DAYS`, `MAX_OPEN_ORDERS` and `ORDER_TOKEN_SECRET` (docs/contracts/config.md). */
export interface OrdersConfig {
  /** Minutes an order waits for payment (5 to 1440); its reservations outlive it by the fixed grace of core. */
  paymentTtlMinutes: number;
  /** Days a guest may open an order with its access token (1 to 3650). */
  guestAccessDays: number;
  /** Unpaid orders one guest email or one customer may hold at once (1 to 50, `MAX_OPEN_ORDERS`, ADR 0024). */
  maxOpenOrders: number;
  /**
   * `ORDER_TOKEN_SECRET`: the key of the derived guest access tokens (ADR 0023). `undefined` only for callers that never
   * place an order (the OpenAPI export, `jobs:run-once`); a guest checkout then fails loudly instead of using a weak key.
   */
  tokenSecret?: string;
}

export const DEFAULT_ORDERS_CONFIG: Readonly<OrdersConfig> = Object.freeze({
  paymentTtlMinutes: DEFAULT_ORDER_PAYMENT_TTL_MINUTES,
  guestAccessDays: DEFAULT_ORDER_GUEST_ACCESS_DAYS,
  maxOpenOrders: DEFAULT_MAX_OPEN_ORDERS,
});
