import { ORDER_STATUSES, type OrderStatus } from "../orders/status.js";
import {
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  type PaymentStatus,
  type RefundStatus,
} from "../payments/status.js";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "../shipping/shipment-status.js";

/*
 * Erasure eligibility (ADR 0033 decision 6): which orders of a data subject block an erasure, and what happens to each
 * order when nothing does. Pure: the API gathers the facts under its locks and feeds them in. A blocker refuses the whole
 * erasure and changes nothing; an admin cannot override one in v1. An unknown status is corrupt data or a bug (RangeError).
 */

export const ERASURE_BLOCKER_REASONS = Object.freeze([
  "open_order",
  "payment_in_progress",
  "refund_in_progress",
  "active_shipment",
] as const);

export type ErasureBlockerReason = (typeof ERASURE_BLOCKER_REASONS)[number];

/** Orders that still await payment or fulfilment. `paid` is open until it is fulfilled or cancelled. */
const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["awaiting_payment", "paid"];

/** A payment attempt that may still move money or answer (`LIVE_PAYMENT_STATUSES` of the payment machine). */
const LIVE_PAYMENT_ATTEMPT_STATUSES: readonly PaymentStatus[] = [
  "creating",
  "awaiting_customer",
  "processing",
  "create_unknown",
];

/** A refund whose outcome is not settled. `succeeded` and `failed` are final. */
const NON_FINAL_REFUND_STATUSES: readonly RefundStatus[] = ["requested", "processing", "unknown"];

/** A shipment that is still moving. `delivered`, `returned`, `cancelled` and `failed` are final. */
const MOVING_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "pending",
  "unknown",
  "created",
  "in_transit",
  "arrived",
  "returning",
];

export interface ErasureOrderFacts {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  /** True when the contact fields were already anonymised: a repeated erasure changes nothing there. */
  readonly contactErased: boolean;
  /** The `status` of every payment attempt of the order. */
  readonly paymentStatuses: readonly PaymentStatus[];
  /** The `status` of every refund of every payment of the order. */
  readonly refundStatuses: readonly RefundStatus[];
  /** The `status` of every shipment of the order. */
  readonly shipmentStatuses: readonly ShipmentStatus[];
}

export interface ErasureBlocker {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly reason: ErasureBlockerReason;
}

export type OrderErasureAction = "anonymise" | "already_anonymised";

export type ErasureDecision =
  | {
      readonly allowed: true;
      readonly orders: readonly {
        readonly orderId: string;
        readonly orderNumber: string;
        readonly action: OrderErasureAction;
      }[];
    }
  | { readonly allowed: false; readonly blockers: readonly ErasureBlocker[] };

function requireKnown<T extends string>(value: T, known: readonly T[], what: string): void {
  if (!known.includes(value)) {
    throw new RangeError(`Unknown ${what} status: ${String(value)}`);
  }
}

function reasonsOf(facts: ErasureOrderFacts): ErasureBlockerReason[] {
  requireKnown(facts.status, ORDER_STATUSES, "order");
  for (const status of facts.paymentStatuses) requireKnown(status, PAYMENT_STATUSES, "payment");
  for (const status of facts.refundStatuses) requireKnown(status, REFUND_STATUSES, "refund");
  for (const status of facts.shipmentStatuses) requireKnown(status, SHIPMENT_STATUSES, "shipment");
  const reasons: ErasureBlockerReason[] = [];
  if (OPEN_ORDER_STATUSES.includes(facts.status)) reasons.push("open_order");
  if (facts.paymentStatuses.some((status) => LIVE_PAYMENT_ATTEMPT_STATUSES.includes(status))) {
    reasons.push("payment_in_progress");
  }
  if (facts.refundStatuses.some((status) => NON_FINAL_REFUND_STATUSES.includes(status))) {
    reasons.push("refund_in_progress");
  }
  if (facts.shipmentStatuses.some((status) => MOVING_SHIPMENT_STATUSES.includes(status))) {
    reasons.push("active_shipment");
  }
  return reasons;
}

/**
 * Decides an erasure over all orders of the subject. Either every order can be anonymised (`allowed`) or none is touched
 * (`blockers`, ordered by order number, then in the order of `ERASURE_BLOCKER_REASONS`, each reason once per order).
 */
export function decideErasure(orders: readonly ErasureOrderFacts[]): ErasureDecision {
  const blockers: ErasureBlocker[] = [];
  const plan: {
    orderId: string;
    orderNumber: string;
    action: OrderErasureAction;
  }[] = [];
  for (const facts of orders) {
    const reasons = reasonsOf(facts);
    for (const reason of reasons) {
      blockers.push({ orderId: facts.orderId, orderNumber: facts.orderNumber, reason });
    }
    plan.push({
      orderId: facts.orderId,
      orderNumber: facts.orderNumber,
      action: facts.contactErased ? "already_anonymised" : "anonymise",
    });
  }
  if (blockers.length > 0) {
    return {
      allowed: false,
      blockers: blockers.sort(
        (a, b) =>
          a.orderNumber.localeCompare(b.orderNumber) ||
          ERASURE_BLOCKER_REASONS.indexOf(a.reason) - ERASURE_BLOCKER_REASONS.indexOf(b.reason),
      ),
    };
  }
  return { allowed: true, orders: plan };
}
