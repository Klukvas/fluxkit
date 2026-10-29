import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import type { AdminAuditAction, AdminAuditTargetKind } from "@fluxkit/core";
import { toPage, type Page } from "../../common/pagination.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminAuditEvent } from "../../database/schema/index.js";
import type { AuditEventView, ListAuditEventsQuery } from "./admin-audit.schemas.js";

/** Reads of the admin audit log (`GET /admin/audit-events`, `users.manage`). Newest first; one page and one count. */
@Injectable()
export class AdminAuditService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(query: ListAuditEventsQuery): Promise<Page<AuditEventView>> {
    const filters: SQL[] = [];
    if (query.action !== undefined) filters.push(eq(adminAuditEvent.action, query.action));
    if (query.adminUserId !== undefined) {
      filters.push(eq(adminAuditEvent.adminUserId, query.adminUserId));
    }
    if (query.targetKind !== undefined) {
      filters.push(eq(adminAuditEvent.targetKind, query.targetKind));
    }
    if (query.targetId !== undefined) filters.push(eq(adminAuditEvent.targetId, query.targetId));
    if (query.from !== undefined) filters.push(gte(adminAuditEvent.createdAt, query.from));
    if (query.to !== undefined) filters.push(lt(adminAuditEvent.createdAt, query.to));
    const where = filters.length === 0 ? undefined : and(...filters);
    const rows = await this.db
      .select()
      .from(adminAuditEvent)
      .where(where)
      .orderBy(desc(adminAuditEvent.createdAt), desc(adminAuditEvent.id))
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await this.db.select({ value: count() }).from(adminAuditEvent).where(where);
    return toPage(
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        adminUserId: row.adminUserId,
        action: row.action as AdminAuditAction,
        targetKind: row.targetKind as AdminAuditTargetKind,
        targetId: row.targetId,
        // Written only through core buildAdminAuditEvent (AdminAuditWriter).
        detail: row.detail as AuditEventView["detail"],
      })),
      total?.value ?? 0,
      query,
    );
  }
}
