import { Inject, Injectable } from "@nestjs/common";
import { normalizeEmail, parseOrderNumber } from "@fluxkit/core";
import { toPage, type Page } from "../../common/pagination.js";
import { notFound, ruleViolation } from "../../common/problem.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { OrdersRepository, type AdminOrderFilter } from "../orders.repository.js";
import { OrdersService } from "../orders.service.js";
import { AdminOrderViewService } from "./admin-order-view.js";
import type {
  AdminOrderDetail,
  AdminOrderSummary,
  CancelOrderBody,
  ListAdminOrdersQuery,
  MarkPaidBody,
} from "./admin-orders.schemas.js";

/** The source recorded for a payment an admin reports by hand (`MarkPaidRequest.source`). */
const MANUAL_SOURCE = "manual";

/**
 * Order management for admins (`orders.read` and `orders.write`, ADR 0017). Reads go through the one admin view; every
 * change goes through `OrdersService`, the only place an order changes status, with the admin recorded as the actor
 * in the status journal. Nothing here decides a rule: results are only mapped to problem codes.
 */
@Injectable()
export class AdminOrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(OrdersService) private readonly service: OrdersService,
    @Inject(AdminOrderViewService) private readonly views: AdminOrderViewService,
  ) {}

  async list(query: ListAdminOrdersQuery): Promise<Page<AdminOrderSummary>> {
    const filter = this.toFilter(query);
    const rows = await this.orders.listForAdmin(this.database, filter, query.limit, query.offset);
    const total = await this.orders.countForAdmin(this.database, filter);
    return toPage(await this.views.summaries(this.database, rows), total, query);
  }

  async get(orderId: string): Promise<AdminOrderDetail> {
    return this.require(orderId);
  }

  async cancel(orderId: string, adminId: string, body: CancelOrderBody): Promise<AdminOrderDetail> {
    const result = await this.service.cancelAsAdmin(orderId, adminId, body.reason);
    if (!result.ok) {
      throw result.reason === "not_found"
        ? notFound("Order")
        : ruleViolation("The order can not be cancelled in its current status.", result.reason);
    }
    return this.require(orderId);
  }

  async markPaid(orderId: string, adminId: string, body: MarkPaidBody): Promise<AdminOrderDetail> {
    const outcome = await this.service.markPaid(
      orderId,
      { amount: body.amount, providerReference: body.reference, source: MANUAL_SOURCE },
      { type: "admin", adminId },
    );
    if (!outcome.ok) {
      throw outcome.reason === "order_not_found"
        ? notFound("Order")
        : ruleViolation(PAYMENT_REFUSALS[outcome.reason], outcome.reason);
    }
    return this.require(orderId);
  }

  async markFulfilled(orderId: string, adminId: string): Promise<AdminOrderDetail> {
    const result = await this.service.markFulfilled(orderId, { type: "admin", adminId });
    if (!result.ok) {
      throw result.reason === "not_found"
        ? notFound("Order")
        : ruleViolation(FULFILMENT_REFUSALS[result.reason], result.reason);
    }
    return this.require(orderId);
  }

  /** `q`: an order number the way a person types it, or an email; both are compared for equality only. */
  private toFilter(query: ListAdminOrdersQuery): AdminOrderFilter {
    const text = query.q?.trim() ?? "";
    const parsedNumber = text === "" ? undefined : parseOrderNumber(text);
    return {
      status: query.status,
      placedFrom: query.placedFrom,
      placedTo: query.placedTo,
      number: parsedNumber?.ok === true ? parsedNumber.number : undefined,
      email: text === "" ? undefined : normalizeEmail(text),
    };
  }

  private async require(orderId: string): Promise<AdminOrderDetail> {
    const view = await this.views.getOrder(orderId);
    if (view === undefined) {
      throw notFound("Order");
    }
    return view;
  }
}

const PAYMENT_REFUSALS = {
  order_not_payable: "The order is expired or cancelled, or its stock is no longer held.",
  amount_mismatch: "The amount does not equal the order total in the order currency.",
  payment_reference_conflict: "The order is already paid with another payment reference.",
  invalid_transition: "The order can not be paid in its current status.",
} as const;

const FULFILMENT_REFUSALS = {
  awaiting_stock: "A backordered line is not on hand yet.",
  invalid_transition: "Only a paid order can be fulfilled.",
} as const;
