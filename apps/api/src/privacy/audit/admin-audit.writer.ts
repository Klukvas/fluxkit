import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  buildAdminAuditEvent,
  type AdminAuditAction,
  type AdminAuditTargetKind,
  type AuditDetail,
} from "@fluxkit/core";
import type { DbExecutor } from "../../common/transaction.js";

export interface AdminAuditInput {
  readonly action: AdminAuditAction;
  readonly targetKind: AdminAuditTargetKind;
  readonly targetId: string;
  readonly detail?: AuditDetail;
}

/**
 * The single writer of `admin_audit_event` (ADR 0033 decision 9). It runs in the caller's transaction, so an audit row
 * exists exactly when the audited change committed. The event is built by core `buildAdminAuditEvent`: an action from
 * the closed list, a uuid target and a detail of codes, counts and flags only; anything that could carry personal data
 * is a RangeError (a bug of the caller), never stored.
 *
 * The actor is stored only while the admin user exists, the same NULL the foreign key's SET NULL leaves when an admin
 * user is deleted later (signed-in admins always exist; only test principals have no row).
 */
@Injectable()
export class AdminAuditWriter {
  async record(db: DbExecutor, actorAdminId: string | null, input: AdminAuditInput): Promise<void> {
    const event = buildAdminAuditEvent(input);
    await db.execute(sql`
      insert into "admin_audit_event" ("admin_user_id", "action", "target_kind", "target_id", "detail")
      values (
        (select "id" from "admin_user" where "id" = ${actorAdminId}::uuid),
        ${event.action}, ${event.targetKind}, ${event.targetId}::uuid, ${JSON.stringify(event.detail)}::jsonb
      )`);
  }
}
