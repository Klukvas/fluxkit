import { Module } from "@nestjs/common";
import { OrderMailHandler } from "./order-mail.handler.js";

/**
 * The domain event handlers that enqueue mail (ADR 0031 decision 5): order and shipment mails. Core, no flag: with
 * `EMAIL_PROVIDER=none` the handler does nothing. `DomainEventHandlerRegistry` finds the handler by its metadata. Needs
 * the globals of the database, `AuthModule` (clock), `CommonModule` (locales), `OrdersModule` (`OrderReadPort`) and
 * `EmailOutboxModule` (`EmailOutbox`).
 */
@Module({ providers: [OrderMailHandler] })
export class EmailHandlersModule {}
