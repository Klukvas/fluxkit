import type { Address } from "./contact.js";
import type { OrderActor, OrderStatus } from "./status.js";

/*
 * The order read port and the order view it returns (ADR 0018, plan step 6). Types and constants only, so a payment,
 * shipping or email plugin can reach them from a package without importing `apps/api` (dependency-cruiser forbids it).
 * `apps/api` implements the port with the SAME builder as `GET /admin/orders/{id}`: there is one admin order view, and a
 * plugin sees exactly what an admin sees, minus nothing it needs and plus nothing internal. The view carries personal
 * data (contact, addresses): a plugin that reads it handles that data under the shop's privacy rules.
 *
 * Never part of the view, for a route and for a plugin alike: the guest access token or its hash, the idempotency key,
 * the request fingerprint, reservation ids, locations and stock levels (a reservation shows its status and quantity
 * only), password hashes.
 */

/** Injection token of the read port: `@Inject(ORDER_READ_PORT)` in a plugin, implemented by `apps/api`. */
export const ORDER_READ_PORT = "fluxkit:order-read-port";

/** An amount in minor units of a currency (ADR 0011). */
export interface AdminOrderMoney {
  readonly amount: number;
  readonly currency: string;
}

/** A translated text as stored in the snapshot: every locale the shop had when the order was placed. */
export type AdminOrderTexts = Readonly<Record<string, string>>;

/** Whether the units of a line are held, sold or given back. Status and quantity only, no ids and no stock figures. */
export interface AdminOrderReservationView {
  readonly status: string;
  readonly quantity: number;
}

export interface AdminOrderItemView {
  /** Position in the order, from 0. */
  readonly position: number;
  /** Null once the catalog row was deleted (the snapshot stays). */
  readonly productId: string | null;
  readonly variantId: string | null;
  readonly sku: string;
  readonly productTitle: AdminOrderTexts;
  readonly variantTitle: AdminOrderTexts | null;
  readonly optionValues: readonly {
    readonly option: AdminOrderTexts;
    readonly value: AdminOrderTexts;
  }[];
  readonly imageUrl: string | null;
  readonly unitPrice: AdminOrderMoney;
  readonly compareAtAmount: number | null;
  readonly quantity: number;
  readonly lineTotal: AdminOrderMoney;
  readonly requiresShipping: boolean;
  readonly reservations: readonly AdminOrderReservationView[];
}

export interface AdminOrderAdjustmentView {
  readonly kind: string;
  readonly code: string;
  readonly label: AdminOrderTexts;
  readonly amount: AdminOrderMoney;
  readonly includedInPrice: boolean;
  readonly source: string | null;
}

export interface AdminOrderHistoryEntry {
  /** Null for the creation of the order. */
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly actorType: OrderActor;
  /** The admin who made the change; null for every other actor, and once that admin user was deleted. */
  readonly actorAdminId: string | null;
  readonly reason: string | null;
  /** ISO 8601, UTC. */
  readonly at: string;
}

export interface AdminOrderView {
  readonly id: string;
  readonly number: string;
  readonly status: OrderStatus;
  /** The locale the order was placed in (for notifications). */
  readonly locale: string;
  readonly currency: string;
  /** Null when the customer account was deleted afterwards or the order was placed as a guest. */
  readonly customerId: string | null;
  /** Placed without an account: the shopper holds a guest access token. */
  readonly isGuest: boolean;
  readonly contact: {
    readonly email: string;
    readonly phone: string;
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly shippingAddress: Address | null;
  readonly billingAddress: Address | null;
  readonly items: readonly AdminOrderItemView[];
  readonly subtotal: AdminOrderMoney;
  readonly shippingTotal: AdminOrderMoney;
  readonly discountTotal: AdminOrderMoney;
  readonly taxTotal: AdminOrderMoney;
  readonly total: AdminOrderMoney;
  readonly adjustments: readonly AdminOrderAdjustmentView[];
  readonly history: readonly AdminOrderHistoryEntry[];
  /** ISO 8601, UTC. */
  readonly placedAt: string;
  readonly expiresAt: string;
  readonly paidAt: string | null;
  readonly fulfilledAt: string | null;
  readonly cancelledAt: string | null;
  readonly expiredAt: string | null;
  readonly cancellationReason: string | null;
  readonly paymentReference: string | null;
}

/**
 * How a plugin reads an order (ADR 0018): the payment plugin before it asks the provider for a payment, the email
 * plugin when a domain event arrives with only an id and a number. `undefined` when no such order exists. Reads
 * only; changes go through `OrderPaymentsPort` and, for fulfilment, a port the shipping plan adds.
 */
export interface OrderReadPort {
  getOrder(orderId: string): Promise<AdminOrderView | undefined>;
}
