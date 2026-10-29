import type { PaymentOrderOutcome } from "../payments/outcome.js";
import type {
  PaymentAttentionCode,
  PaymentCreatedBy,
  PaymentEventSource,
  RefundReason,
} from "../payments/reasons.js";
import type { PaymentStatus, RefundStatus } from "../payments/status.js";
import type { ShippingMethodKind, ShippingPayer } from "../shipping/limits.js";
import type { PickupPointKind } from "../shipping/provider-port.js";
import type { ShipmentActor, ShipmentPayer, ShipmentStatus } from "../shipping/shipment-status.js";
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

/** The pickup point of a `pickup_point` order as the snapshot keeps it: public carrier data, no personal data. */
export interface OrderPickupPointView {
  readonly providerRef: string;
  readonly number: string;
  readonly kind: PickupPointKind;
  readonly cityRef: string;
  readonly cityName: string;
  readonly description: string;
}

/** The immutable shipping snapshot of an order (ADR 0029 decision 7, `order_shipping`). */
export interface AdminOrderShippingView {
  /** Null once the method row was deleted (the snapshot stays). */
  readonly methodId: string | null;
  readonly methodCode: string;
  readonly kind: ShippingMethodKind;
  readonly providerCode: string | null;
  readonly providerService: string | null;
  readonly title: AdminOrderTexts;
  /** What the shop charged; equals the shipping adjustment. */
  readonly amount: AdminOrderMoney;
  readonly payer: ShippingPayer;
  /** The carrier's informational estimate shown at checkout, never charged. */
  readonly estimatedCarrierAmount: AdminOrderMoney | null;
  /** Only for `pickup_point`. */
  readonly destination: OrderPickupPointView | null;
}

/** One status change of a shipment (`shipment_status_change`). */
export interface AdminOrderShipmentHistoryEntry {
  /** Null for the creation of the shipment row. */
  readonly fromStatus: ShipmentStatus | null;
  readonly toStatus: ShipmentStatus;
  /** The raw carrier code that caused the change; null for an admin action without a carrier answer. */
  readonly carrierStatusCode: string | null;
  readonly actorType: ShipmentActor;
  /** The admin who acted; null for the tracking job, and once that admin user was deleted. */
  readonly actorAdminId: string | null;
  /** ISO 8601, UTC. */
  readonly at: string;
}

/**
 * A carrier waybill of the order (ADR 0029 decisions 7 and 10, `shipment`). No recipient name or phone and no carrier
 * text: the raw carrier code only. `unknown` means the carrier's answer to the creation was lost: an admin settles it with
 * `POST /admin/orders/{id}/shipments/{shipmentId}/reconcile`.
 */
export interface AdminOrderShipmentView {
  readonly id: string;
  readonly status: ShipmentStatus;
  readonly providerCode: string;
  readonly providerService: string | null;
  /** The waybill number; null until the carrier answered. */
  readonly trackingNumber: string | null;
  readonly carrierStatusCode: string | null;
  readonly carrierStatusAt: string | null;
  /** Our order number as sent to the carrier. */
  readonly clientReference: string;
  readonly declaredValue: AdminOrderMoney;
  /** The carrier's own price of the waybill: informational, never charged. */
  readonly carrierCost: AdminOrderMoney | null;
  readonly payer: ShipmentPayer;
  readonly weightGrams: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly seats: number;
  /** Null once that admin user was deleted. */
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
  readonly deliveredAt: string | null;
  /** When the tracking job asks the carrier next; null when it does not (not yet created, terminal, or given up). */
  readonly nextTrackAt: string | null;
  readonly history: readonly AdminOrderShipmentHistoryEntry[];
}

/** One refund of a payment attempt (`payment_refund`, ADR 0032 decision 11). */
export interface AdminOrderPaymentRefundView {
  /** Also the idempotency reference sent to the provider (Monobank `extRef`). */
  readonly id: string;
  readonly amount: AdminOrderMoney;
  readonly status: RefundStatus;
  readonly reason: RefundReason;
  /** The admin's note; null for an automatic refund. */
  readonly note: string | null;
  /** Null for an automatic refund, and once that admin user was deleted. */
  readonly actorAdminId: string | null;
  /** The provider's code of a `failed` refund; never provider text. */
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One entry of a payment's journal (`payment_event`): a status change, a provider fact (applied or not) or an admin
 * action. The internal bookkeeping rows (refund send claims) and the dedupe keys are left out.
 */
export interface AdminOrderPaymentHistoryEntry {
  readonly source: PaymentEventSource;
  /** Both null when the status did not change. */
  readonly fromStatus: PaymentStatus | null;
  readonly toStatus: PaymentStatus | null;
  /** The provider's raw status word of a fact (`success`), never provider text. */
  readonly providerStatus: string | null;
  readonly providerModifiedAt: string | null;
  /** False for a fact that was older than the current state, did not bind or changed nothing. */
  readonly applied: boolean;
  readonly failureCode: string | null;
  /** The admin of an admin action; null otherwise and once that admin user was deleted. */
  readonly actorAdminId: string | null;
  readonly at: string;
}

/**
 * A payment attempt of the order (ADR 0032 decisions 5 and 18). Card data is the card system and the last four digits
 * only; no page URL, no idempotency key, no raw provider answer.
 */
export interface AdminOrderPaymentView {
  readonly id: string;
  readonly providerCode: string;
  /** The provider's id of the invoice; null until the provider answered the create. */
  readonly providerPaymentId: string | null;
  readonly status: PaymentStatus;
  readonly amount: AdminOrderMoney;
  /** The provider's final amount (after its refunds); null until known. */
  readonly finalAmount: AdminOrderMoney | null;
  /** The sum of the succeeded refunds. */
  readonly refundedAmount: AdminOrderMoney;
  /** What a new refund may still take: for a succeeded attempt the amount less every refund that is not `failed`, else 0. */
  readonly refundableAmount: AdminOrderMoney;
  readonly providerStatus: string | null;
  readonly providerModifiedAt: string | null;
  readonly failureCode: string | null;
  /** What `markPaidIn` answered for a success; null otherwise. */
  readonly orderOutcome: PaymentOrderOutcome | null;
  readonly needsAttention: boolean;
  /** Kept after an admin cleared the item. */
  readonly attentionCode: PaymentAttentionCode | null;
  readonly card: { readonly system: string; readonly last4: string } | null;
  readonly createdBy: PaymentCreatedBy;
  /** The end of the invoice. */
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When the reconcile job reads it next; null when it does not. */
  readonly nextCheckAt: string | null;
  readonly refunds: readonly AdminOrderPaymentRefundView[];
  readonly history: readonly AdminOrderPaymentHistoryEntry[];
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
  /** The shipping snapshot; `null` for an order placed without a shipping method (digital goods, or a shop without one). */
  readonly shipping: AdminOrderShippingView | null;
  /** The carrier waybills of the order, oldest first (at most one active); empty when none was created. */
  readonly shipments: readonly AdminOrderShipmentView[];
  /** The online payment attempts of the order, oldest first (ADR 0032); empty when none was made. */
  readonly payments: readonly AdminOrderPaymentView[];
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
 * only; changes go through `OrderPaymentsPort`. Fulfilment stays an admin action: the shipping plan (step 8) added no
 * fulfilment port, because the owner keeps fulfilment manual (ADR 0029 decision 10).
 */
export interface OrderReadPort {
  getOrder(orderId: string): Promise<AdminOrderView | undefined>;
}
