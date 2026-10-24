# Contract: domain events and order ports

Status: draft (introduced in plan step 5c of `docs/plans/2026-10-17-cart-and-orders.md`, ADR 0018 and 0021; the `OrderReadPort` was added in step 6). Covered by SemVer (AGENTS.md section 17); no release has been made yet. Everything exported from `@fluxkit/core` named here is contract; anything not listed is internal.

Plugins (payment, shipping, email, features) reach the order domain only through this contract and never import `apps/api`. Core never imports a plugin.

## Events

Written to the outbox table `domain_event` in the SAME transaction as the change they report (an event exists if and only if the change committed), dispatched at least once by the scheduler (`docs/api/jobs.md`).

| Type | Written when | Written by today | Payload (stored) |
|---|---|---|---|
| `order.placed` | the checkout commits | `POST /store/checkout` | `{orderId, orderNumber, status: "awaiting_payment"}` |
| `order.paid` | `awaiting_payment -> paid` | `OrdersService.markPaid` | `{orderId, orderNumber, status: "paid"}` |
| `order.cancelled` | any cancel | the order cancels | `{orderId, orderNumber, status: "cancelled"}` |
| `order.expired` | `awaiting_payment -> expired` | `OrdersService.expireOne` (the scheduler) | `{orderId, orderNumber, status: "expired"}` |
| `order.fulfilled` | `paid -> fulfilled` | `OrdersService.markFulfilled` | `{orderId, orderNumber, status: "fulfilled"}` |
| `customer.registered` | a customer registers | NOT written yet: the name is reserved in core and no code emits it | not defined yet (ids only, like the others) |
| `shipment.created` | the carrier accepted a waybill (`pending` or `unknown` -> `created`) | NOT written yet: the name is reserved in core (ADR 0029 decision 12, shipping plan step 8) | `{shipmentId, orderId, orderNumber, status}` (aggregate = the shipment id) |
| `shipment.status_changed` | any other shipment status change (entering `pending` emits nothing) | NOT written yet: reserved, as above | `{shipmentId, orderId, orderNumber, status}` |
| `shipment.cancelled` | a waybill is cancelled (`created` -> `cancelled`) | NOT written yet: reserved, as above | `{shipmentId, orderId, orderNumber, status: "cancelled"}` |

Event names are dotted lower case (`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, also a CHECK of the table). Payloads carry ids and the order number only, never personal data (built field by field by `buildOrderEventPayload`): a handler reads what it needs through a port. Core exports `ORDER_EVENT_TYPES`, `CUSTOMER_EVENT_TYPES`, `orderEventTypeFor(status)`, `buildOrderEventPayload`, `DOMAIN_EVENT_TYPE_PATTERN`, and for shipments `SHIPMENT_EVENT_TYPES`, `shipmentEventTypeFor(status)` and `buildShipmentEventPayload` (never a tracking number, phone or name).

## Writing a handler

A handler is a Nest provider of a plugin that implements `DomainEventHandler` and is marked with the metadata key. The API finds it at startup (ADR 0018, 0021); there is nothing to register and no flag.

```ts
import { Injectable, SetMetadata } from "@nestjs/common";
import {
  DOMAIN_EVENT_HANDLER_METADATA,
  domainEventHandlerMetadata,
  type DomainEventEnvelope,
  type DomainEventHandler,
} from "@fluxkit/core";

@Injectable()
@SetMetadata(DOMAIN_EVENT_HANDLER_METADATA, domainEventHandlerMetadata(["order.paid"]))
export class SendReceipt implements DomainEventHandler {
  async handle(event: DomainEventEnvelope): Promise<void> {
    // idempotent by event.id; throw to have the event retried
  }
}
```

| Item | Contract |
|---|---|
| Metadata key | `DOMAIN_EVENT_HANDLER_METADATA` = `"fluxkit:domain-event-handler"` |
| Metadata value | `{eventTypes: string[]}`, built with `domainEventHandlerMetadata(types)` (checks the names, removes duplicates, throws `RangeError` for an empty list or a malformed name) |
| Handler | `handle(event: DomainEventEnvelope): Promise<void>` on a STATIC provider (a request-scoped provider is refused). A marked provider without `handle`, with an invalid event type or not static stops the startup |
| Envelope | `{id, type, aggregateId, payload, occurredAt: Date, previousFailures}`: `id` is the event id (the idempotency key), `payload` the stored payload, `occurredAt` the time the outbox row was inserted, which is the START of the transaction that wrote it (`DEFAULT now()`), so it can precede the commit by the length of that transaction, `previousFailures` the number of earlier attempts (0 on the first; an attempt that died without finishing counts) |
| Types | An event is delivered only to handlers that declared its exact type |

Delivery rules a handler can rely on, and must respect:
- **At least once.** The same event can arrive again (after a failure, after a crash of the dispatcher, after a retry of another handler of the same event): be idempotent by `event.id`. Two dispatchers never run the same event at the same time, and no transaction is open while a handler runs.
- **Success is returning, failure is throwing.** An event is marked dispatched only when EVERY handler of its type succeeded (no handler at all counts as success). When one throws, the others are still called for that attempt, and the retry calls ALL handlers of the event again.
- **Retry with backoff.** After n attempts that did not finish (a failure, or a dispatcher that died) the event is picked again at `created_at + (2^n - 1) minutes` (1, 3, 7, 15, ... minutes after the event was written). After 10 attempts it stays undispatched and is no longer picked until an operator resets `attempts`; a failed 10th attempt is logged as an error.
- **Bound your own I/O.** A handler that has not answered after 30 seconds counts as failed (`HandlerTimeout`); it may still finish later.
- **No ordering guarantee** between events beyond "oldest due first"; do not rely on `order.paid` arriving after `order.placed` has been handled.
- **Only a code is stored** when a handler fails (the error class and its cause's code), never the message. Do not put personal data in an error class name.
- The outbox row is deleted 7 days after it was dispatched.

## Ports

| Port | Token | Status |
|---|---|---|
| `OrderPaymentsPort` | `ORDER_PAYMENTS_PORT` = `"fluxkit:order-payments-port"` (implemented by `OrdersService`; inject with `@Inject(ORDER_PAYMENTS_PORT)`) | exists |
| `OrderReadPort` | `ORDER_READ_PORT` = `"fluxkit:order-read-port"` (implemented by `AdminOrderViewService`; inject with `@Inject(ORDER_READ_PORT)`) | exists |

`OrderPaymentsPort.markPaid(orderId, {amount, providerReference, source}): Promise<MarkPaidOutcome>`: the only way a plugin marks an order paid. Idempotent (the same reference on a paid order answers `{ok: true, alreadyPaid: true}`; a different reference is `payment_reference_conflict`); the amount must equal the order total in the order currency (`amount_mismatch`); an expired or cancelled order is `order_not_payable` and nothing changes; also `order_not_found`, `invalid_transition`. Types: `MarkPaidRequest`, `MarkPaidOutcome`, `MarkPaidRefusal`.

`OrderReadPort.getOrder(orderId): Promise<AdminOrderView | undefined>`: how a plugin reads an order (a payment plugin before it asks the provider for a payment, an email plugin when an event arrives with only an id and a number). Reads only; `undefined` for an unknown id and for text that is not an id (it never throws for those). The view is exactly the one `GET /admin/orders/{id}` returns (one builder serves both, tested for equality in every status): contact and addresses (personal data: the plugin handles them under the shop's privacy rules), the item snapshot with every locale, totals, adjustments, the shipping snapshot (`shipping`, additive in shipping plan step 6: method code and link, kind, provider, the title in every locale, amount, payer, the informational carrier estimate and a pickup point's public data; `null` for an order without a method), the status journal with the acting admin id, and each line's reservations as `{status, quantity}`. It never contains the guest access token or its hash, the idempotency key, the request fingerprint, reservation ids, locations or stock figures. Types: `AdminOrderView`, `AdminOrderItemView`, `AdminOrderAdjustmentView`, `AdminOrderShippingView`, `OrderPickupPointView`, `AdminOrderHistoryEntry`, `AdminOrderReservationView`, `AdminOrderMoney`, `AdminOrderTexts`; each is read-only. Changes to an order go through `OrderPaymentsPort` (payment). No port changes the fulfilment yet: the shipping plan keeps fulfilment manual in v1 and decides on `OrderFulfilmentPort` at its step 8 (ADR 0029 decision 10).

A payment plugin registers its own routes, verifies the provider's signature and calls this port; a shipping plugin reacts to `order.paid`; an email plugin handles `order.placed`, `order.paid`, `order.cancelled`. Removing any of them leaves orders working: an order stays `awaiting_payment` until an admin marks it paid or it expires.

## Changing this contract

Adding an event type, an optional payload field, an envelope field or a field of the order view is a minor change. Removing or renaming any of them, changing the stored payload of an existing event, the metadata key, a token, the delivery rules above, or removing or retyping a field of the order view is breaking (major version, migration guide in `docs/migrations/`, `CHANGELOG.md` entry).
