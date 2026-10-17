import type { Money } from "../pricing/money.js";
import { ORDER_NUMBER_PATTERN } from "./number.js";
import { ORDER_STATUSES } from "./status.js";
import type { OrderStatus } from "./status.js";

/*
 * Domain events and the payment port (ADR 0018). Types and constants only, so a payment, shipping or email plugin can
 * reach them from a package without importing `apps/api` (dependency-cruiser forbids it). The API writes the events into
 * the `domain_event` outbox in the transaction of the change; the scheduler dispatches them (plan step 5c). Payloads
 * carry ids and the order number only, never personal data: a handler reads what it needs through a port.
 */

/** The events an order emits: one per status it can enter (the first one, `order.placed`, is the creation). */
export const ORDER_EVENT_TYPES = Object.freeze([
  "order.placed",
  "order.paid",
  "order.cancelled",
  "order.expired",
  "order.fulfilled",
] as const);

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const CUSTOMER_EVENT_TYPES = Object.freeze(["customer.registered"] as const);

export type CustomerEventType = (typeof CUSTOMER_EVENT_TYPES)[number];

/** Metadata key a plugin's provider sets to be found as a domain event handler (`SetMetadata`). */
export const DOMAIN_EVENT_HANDLER_METADATA = "fluxkit:domain-event-handler";

/** Injection token of the payment port: `@Inject(ORDER_PAYMENTS_PORT)` in a plugin, implemented by `apps/api`. */
export const ORDER_PAYMENTS_PORT = "fluxkit:order-payments-port";

const EVENT_BY_STATUS: Readonly<Record<OrderStatus, OrderEventType>> = Object.freeze({
  awaiting_payment: "order.placed",
  paid: "order.paid",
  fulfilled: "order.fulfilled",
  cancelled: "order.cancelled",
  expired: "order.expired",
});

/** The event for the status an order has just entered. An unknown status is a bug (RangeError). */
export function orderEventTypeFor(status: OrderStatus): OrderEventType {
  if (!ORDER_STATUSES.includes(status)) {
    throw new RangeError(`Unknown order status: ${String(status)}`);
  }
  return EVENT_BY_STATUS[status];
}

export interface OrderEventPayload {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The stored payload of an order event: id, number and status. Built field by field, so nothing else a caller passes
 * (an email, a phone) can end up in the outbox; a malformed value is a bug (RangeError).
 */
export function buildOrderEventPayload(input: OrderEventPayload): OrderEventPayload {
  if (typeof input.orderId !== "string" || !UUID.test(input.orderId)) {
    throw new RangeError("An order event needs the order id (uuid)");
  }
  if (typeof input.orderNumber !== "string" || !ORDER_NUMBER_PATTERN.test(input.orderNumber)) {
    throw new RangeError("An order event needs the order number");
  }
  if (!ORDER_STATUSES.includes(input.status)) {
    throw new RangeError(`Unknown order status: ${String(input.status)}`);
  }
  return Object.freeze({
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    status: input.status,
  });
}

/** What a payment plugin (or an admin) tells the order when money arrived. */
export interface MarkPaidRequest {
  /** Must equal the order total exactly (same currency); a partial or surplus payment is refused. */
  readonly amount: Money;
  /** The provider's id of the payment (or a bank transfer reference): the idempotency key of the payment. */
  readonly providerReference: string;
  /** Who reports it: the plugin name or `manual`. */
  readonly source: string;
}

export type MarkPaidRefusal =
  | "order_not_found"
  | "order_not_payable"
  | "amount_mismatch"
  | "payment_reference_conflict"
  | "invalid_transition";

export type MarkPaidOutcome =
  | { readonly ok: true; readonly orderId: string; readonly alreadyPaid: boolean }
  | { readonly ok: false; readonly reason: MarkPaidRefusal };

/**
 * The only way a plugin marks an order paid (ADR 0018). Idempotent: the same reference on a paid order answers ok with
 * `alreadyPaid`; a different reference is `payment_reference_conflict`; an expired or cancelled order is
 * `order_not_payable` and nothing changes.
 */
export interface OrderPaymentsPort {
  markPaid(orderId: string, request: MarkPaidRequest): Promise<MarkPaidOutcome>;
}
