import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { decideErasure, isOrderRetentionDue, type OrderStatus } from "@fluxkit/core";
import { withJobTransaction } from "../../common/job-limits.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminAuditEvent, privacyRequest, salesOrder } from "../../database/schema/index.js";
import { PrivacyErasureService } from "../erasure/privacy-erasure.service.js";

const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ["fulfilled", "cancelled", "expired"];

export type RetentionOutcome = "anonymised" | "blocked" | "not_due";

/**
 * The database work of job 12 (ADR 0033 decision 8). Candidates are read cheaply in pages by id; each one is then decided
 * and changed in its OWN short transaction under the order's row lock, with every status re-read: core
 * `isOrderRetentionDue` (closing time or newest refund strictly before the cut-off) and core `decideErasure` (a blocker
 * skips the order). Only the contact fields of the order change, never the customer, the mail or anything else. The
 * purges delete closed privacy requests and audit events past their periods in bounded batches.
 */
@Injectable()
export class PrivacyRetentionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PrivacyErasureService) private readonly erasure: PrivacyErasureService,
  ) {}

  /**
   * Ids of closed, not yet anonymised orders whose closing time is before the cut-off, after `afterId`, by id. A superset
   * of the due orders (a newer refund can still keep one): `anonymiseIfDue` decides.
   */
  async candidates(cutoff: Date, afterId: string | null, limit: number): Promise<string[]> {
    const closedAt = sql`coalesce(${salesOrder.fulfilledAt}, ${salesOrder.cancelledAt}, ${salesOrder.expiredAt})`;
    const rows = await this.db
      .select({ id: salesOrder.id })
      .from(salesOrder)
      .where(
        and(
          inArray(salesOrder.status, [...CLOSED_ORDER_STATUSES]),
          isNull(salesOrder.contactErasedAt),
          lt(closedAt, cutoff),
          afterId === null ? undefined : gt(salesOrder.id, afterId),
        ),
      )
      .orderBy(asc(salesOrder.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async anonymiseIfDue(orderId: string, cutoff: Date, now: Date): Promise<RetentionOutcome> {
    // Job statement and lock limits (docs/api/jobs.md): a row held by a stuck writer fails this order; job 12 records the
    // failure and goes on with the next order, so it never fails the tick (review F4).
    return withJobTransaction(this.db, async (tx) => {
      const [order] = await tx
        .select()
        .from(salesOrder)
        .where(eq(salesOrder.id, orderId))
        .for("update");
      if (order === undefined || order.contactErasedAt !== null) {
        return "not_due";
      }
      const { facts, lastRefundAt } = await this.erasure.orderFacts(tx, [order]);
      const due = isOrderRetentionDue(
        {
          status: order.status as OrderStatus,
          fulfilledAt: order.fulfilledAt,
          cancelledAt: order.cancelledAt,
          expiredAt: order.expiredAt,
          lastRefundAt: lastRefundAt.get(order.id) ?? null,
        },
        cutoff,
      );
      if (!due) {
        return "not_due";
      }
      if (!decideErasure(facts).allowed) {
        return "blocked";
      }
      await this.erasure.anonymiseOrder(tx, order, now);
      return "anonymised";
    });
  }

  /** Deletes up to `limit` completed or rejected requests closed before the cut-off; returns how many. */
  async deleteOldRequests(cutoff: Date, limit: number): Promise<number> {
    const result = await withJobTransaction(this.db, (tx) =>
      tx.execute(sql`
      delete from ${privacyRequest} where ${privacyRequest.id} in (
        select ${privacyRequest.id} from ${privacyRequest}
        where ${privacyRequest.status} in ('completed', 'rejected') and ${privacyRequest.completedAt} < ${cutoff}
        order by ${privacyRequest.completedAt} limit ${limit}
        for update skip locked
      )`),
    );
    return result.rowCount ?? 0;
  }

  /** Deletes up to `limit` audit events created before the cut-off (the trigger refuses younger ones); returns how many. */
  async deleteOldAuditEvents(cutoff: Date, limit: number): Promise<number> {
    const result = await withJobTransaction(this.db, (tx) =>
      tx.execute(sql`
      delete from ${adminAuditEvent} where ${adminAuditEvent.id} in (
        select ${adminAuditEvent.id} from ${adminAuditEvent}
        where ${adminAuditEvent.createdAt} < ${cutoff}
          -- The trigger's own limit, so an injected time ahead of the database clock never makes the statement fail.
          and ${adminAuditEvent.createdAt} < clock_timestamp() - interval '365 days'
        order by ${adminAuditEvent.createdAt} limit ${limit}
        for update skip locked
      )`),
    );
    return result.rowCount ?? 0;
  }
}
