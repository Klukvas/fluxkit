import { Inject, Injectable, Logger, SetMetadata } from "@nestjs/common";
import {
  DOMAIN_EVENT_HANDLER_METADATA,
  domainEventHandlerMetadata,
  ORDER_READ_PORT,
  type AdminOrderView,
  type DomainEventEnvelope,
  type DomainEventHandler,
  type OrderReadPort,
} from "@fluxkit/core";
import { z } from "zod";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { withJobTransaction } from "../../common/job-limits.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { EmailOutbox } from "../outbox/index.js";
import {
  orderClosedVariables,
  orderPaidVariables,
  orderPlacedVariables,
  shipmentCreatedVariables,
} from "./order-mail-variables.js";

/** Event type to the mail it causes (plan 6.3). `order.fulfilled` and `shipment.status_changed` send nothing in v1. */
const MAIL_OF_EVENT = Object.freeze({
  "order.placed": "order.placed",
  "order.paid": "order.paid",
  "order.cancelled": "order.cancelled",
  "order.expired": "order.expired",
  "shipment.created": "shipment.created",
} as const);

type HandledEventType = keyof typeof MAIL_OF_EVENT;

const orderPayload = z.object({ orderId: z.uuid() });
const shipmentPayload = z.object({ orderId: z.uuid(), shipmentId: z.uuid() });

/**
 * Turns the order and shipment domain events into mails of the outbox (ADR 0031 decision 5, plan 6.3). It ONLY enqueues:
 * one short transaction inserting an `email_message` row with `dedupe_key = <eventId>:<template>`; nothing is rendered,
 * sent or fetched over the network here, so the 30 s handler budget of the dispatcher is never the provider's problem
 * (job 9 sends). Redelivery of the same event (a retry calls every handler again, ADR 0018) inserts no second row.
 *
 * The order is read through `OrderReadPort` (no table reads of orders here). The recipient is the order's contact email
 * (a guest's or a customer's; an order of a deactivated or deleted account still gets its mails, they concern the order),
 * the locale is the order's. Frozen variables only: ids, the number, minor units, bounded texts (`./order-mail-variables.ts`).
 *
 * Skipped without an error, with a code-only log: no provider (`EMAIL_PROVIDER=none`), an order that no longer exists, an
 * order without an email address, an address no mail header can carry (the outbox logs that one), a shipment without a
 * tracking number. A failing read or write throws: the event is retried with backoff and the other handlers still run.
 */
@Injectable()
@SetMetadata(DOMAIN_EVENT_HANDLER_METADATA, domainEventHandlerMetadata(Object.keys(MAIL_OF_EVENT)))
export class OrderMailHandler implements DomainEventHandler {
  private readonly logger = new Logger("OrderMailHandler");

  constructor(
    @Inject(ORDER_READ_PORT) private readonly orders: OrderReadPort,
    @Inject(EmailOutbox) private readonly outbox: EmailOutbox,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
  ) {}

  async handle(event: DomainEventEnvelope): Promise<void> {
    if (!Object.hasOwn(MAIL_OF_EVENT, event.type)) {
      return;
    }
    const type = event.type as HandledEventType;
    const templateKey = MAIL_OF_EVENT[type];
    if (!this.outbox.enabled()) {
      this.logger.debug(`${type} ${event.id}: no mail (email_disabled)`);
      return;
    }
    const payload = (type === "shipment.created" ? shipmentPayload : orderPayload).safeParse(
      event.payload,
    );
    if (!payload.success) {
      // A malformed payload is a bug of the writer; retrying cannot fix it, so it fails loudly once per attempt.
      throw new RangeError(`The payload of ${type} ${event.id} is malformed`);
    }
    const { orderId } = payload.data;
    const view = await this.orders.getOrder(orderId);
    if (view === undefined) {
      this.logger.warn(`${type} ${event.id}: no mail (order_not_found)`);
      return;
    }
    const to = view.contact.email;
    // An erased contact (ADR 0033 decision 5) has no address: never mail it.
    if (to === null || to.trim() === "") {
      this.logger.warn(`${type} ${event.id}: no mail (no_recipient)`);
      return;
    }
    const variables = this.variablesOf(type, view, event);
    if (variables === undefined) {
      this.logger.warn(`${type} ${event.id}: no mail (no_tracking_number)`);
      return;
    }
    const result = await withJobTransaction(this.database, (tx) =>
      this.outbox.enqueue(tx, {
        templateKey,
        locale: view.locale,
        to,
        recipientKind: view.isGuest ? "guest" : "customer",
        customerId: view.customerId,
        orderId: view.id,
        variables,
        eventId: event.id,
        now: this.clock.now(),
      }),
    );
    if (result.status === "duplicate") {
      this.logger.debug(`${type} ${event.id}: mail already enqueued (duplicate)`);
    }
    // `disabled` (a race with a provider change) and `undeliverable` are answered and logged by the outbox itself.
  }

  private variablesOf(
    type: HandledEventType,
    view: AdminOrderView,
    event: DomainEventEnvelope,
  ): Record<string, unknown> | undefined {
    switch (type) {
      case "order.placed":
        return orderPlacedVariables(view, this.locale.defaultLocale);
      case "order.paid":
        return orderPaidVariables(view);
      case "order.cancelled":
      case "order.expired":
        return orderClosedVariables(view);
      case "shipment.created": {
        const { shipmentId } = shipmentPayload.parse(event.payload);
        return shipmentCreatedVariables(view, shipmentId, this.locale.defaultLocale);
      }
    }
  }
}
