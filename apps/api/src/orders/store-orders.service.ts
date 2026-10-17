import { Inject, Injectable } from "@nestjs/common";
import { parseOrderNumber } from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { StoreService } from "../catalog/store/store.service.js";
import { notFound, ruleViolation } from "../common/problem.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { OrderViewService } from "./order-view.js";
import { OrdersRepository, type OrderRow } from "./orders.repository.js";
import type { AccountOrdersQuery, StoreOrder, StoreOrderPage } from "./orders.schemas.js";
import { OrdersService, type OrderChangeResult } from "./orders.service.js";

/**
 * The reads and the cancellations of the shopper's own orders (`/store/orders/*` for guests with the access token,
 * `/store/account/orders/*` for signed-in customers). Rules and state changes are `OrdersService`; this class decides who
 * may see which order and what the answers look like.
 *
 * Enumeration: every way a guest can fail (a malformed or unknown number, a wrong or expired token, an order of a
 * customer) is the same `404 not_found`; a customer asking for a number that is not theirs gets the same 404 as for a
 * number that does not exist. The owner filter of a customer is in the SQL, so someone else's order is never loaded.
 */
@Injectable()
export class StoreOrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(OrdersService) private readonly orderService: OrdersService,
    @Inject(OrderViewService) private readonly views: OrderViewService,
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `POST /store/orders/lookup`: the number and the access token that placement returned. */
  async lookupAsGuest(
    number: string,
    accessToken: string,
    requestedLocale: string | undefined,
  ): Promise<StoreOrder> {
    this.validateLocale(requestedLocale);
    const parsed = parseOrderNumber(number);
    const order = parsed.ok
      ? await this.orders.findByNumber(this.database, parsed.number)
      : undefined;
    // Always one hash comparison, also for a number that does not exist.
    if (
      !this.orderService.guestMayOpen(order, accessToken, this.clock.now()) ||
      order === undefined
    ) {
      throw notFound("Order");
    }
    return this.view(order, requestedLocale);
  }

  /** `POST /store/orders/cancel`: a guest cancels an unpaid order. */
  async cancelAsGuest(
    number: string,
    accessToken: string,
    requestedLocale: string | undefined,
  ): Promise<StoreOrder> {
    this.validateLocale(requestedLocale);
    const parsed = parseOrderNumber(number);
    // A malformed number still pays for the token comparison, then answers like every other miss.
    const result = parsed.ok
      ? await this.orderService.cancelAsGuest(parsed.number, accessToken)
      : this.rejectMalformed(accessToken);
    return this.afterCancel(result, requestedLocale);
  }

  /** `GET /store/account/orders`: the customer's own orders, newest first. */
  async listForCustomer(customerId: string, query: AccountOrdersQuery): Promise<StoreOrderPage> {
    this.validateLocale(query.locale);
    const rows = await this.orders.listOfCustomer(
      this.database,
      customerId,
      query.limit,
      query.offset,
    );
    const total = await this.orders.countOfCustomer(this.database, customerId);
    return {
      items: await this.views.summaries(this.database, rows),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** `GET /store/account/orders/{number}`. */
  async getForCustomer(
    customerId: string,
    number: string,
    requestedLocale: string | undefined,
  ): Promise<StoreOrder> {
    this.validateLocale(requestedLocale);
    const parsed = parseOrderNumber(number);
    const order = parsed.ok
      ? await this.orders.findByNumberOfCustomer(this.database, parsed.number, customerId)
      : undefined;
    if (order === undefined) {
      throw notFound("Order");
    }
    return this.view(order, requestedLocale);
  }

  /** `POST /store/account/orders/{number}/cancel`. */
  async cancelAsCustomer(
    customerId: string,
    number: string,
    requestedLocale: string | undefined,
  ): Promise<StoreOrder> {
    this.validateLocale(requestedLocale);
    const parsed = parseOrderNumber(number);
    const result: OrderChangeResult = parsed.ok
      ? await this.orderService.cancelAsCustomer(customerId, parsed.number)
      : { ok: false, reason: "not_found" };
    return this.afterCancel(result, requestedLocale);
  }

  /** `?locale` is checked before anything is looked up, so a bad locale never depends on whether the order exists. */
  private validateLocale(requested: string | undefined): void {
    if (requested !== undefined) {
      this.store.resolveLocale(requested);
    }
  }

  private rejectMalformed(accessToken: string): OrderChangeResult {
    this.orderService.guestMayOpen(undefined, accessToken, this.clock.now());
    return { ok: false, reason: "not_found" };
  }

  private async afterCancel(
    result: OrderChangeResult,
    requestedLocale: string | undefined,
  ): Promise<StoreOrder> {
    if (!result.ok) {
      if (result.reason === "not_found") {
        throw notFound("Order");
      }
      throw ruleViolation("This order can no longer be cancelled.", "invalid_transition");
    }
    return this.view(result.order, requestedLocale);
  }

  private async view(order: OrderRow, requestedLocale: string | undefined): Promise<StoreOrder> {
    return this.views.view(this.database, order, this.views.localeFor(order, requestedLocale));
  }
}
