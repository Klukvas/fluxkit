import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";

/**
 * Privacy requests and the admin audit log (ADR 0033 decision 9, migration 0009). Same naming conventions as the other
 * schema files.
 *
 * Neither table holds contact data: a request names its subject by a customer id (no foreign key, the request may delete
 * the customer) or an HMAC of the normalized email; its `result` keeps counts, codes and the erased order numbers and
 * customer id, so erasures can be re-applied after a backup restore. An audit row holds an admin id, an action code, a
 * target kind and uuid and a detail of codes and counts, so it survives the erasure of the person it is about.
 *
 * `admin_audit_event` is append-only through the trigger in the hand-written part of `0009_privacy.sql` (drizzle-kit does
 * not model triggers; the ADR 0019 technique): no UPDATE except the SET NULL of `admin_user_id` by the foreign key, and no
 * DELETE of a row younger than AUDIT_EVENT_RETENTION_DAYS (job 12 purges the older ones).
 *
 * The lists and limits mirror packages/core: PRIVACY_REQUEST_KINDS, PRIVACY_REQUEST_SUBJECT_KINDS,
 * PRIVACY_REQUEST_CHANNELS, PRIVACY_REQUEST_STATUSES, ADMIN_AUDIT_TARGET_KINDS, ADMIN_AUDIT_DETAIL_MAX_BYTES,
 * AUDIT_EVENT_RETENTION_DAYS and the 500-character note of the request rules. privacy-schema.spec.ts compares them.
 */

/** Exported for the spec; the trigger in the migration repeats the number. */
export const AUDIT_EVENT_RETENTION_DAYS = 365;
export const ADMIN_AUDIT_DETAIL_MAX_BYTES = 2048;

const NOTE_MAX_LENGTH = 500;
const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";
// An action of the core list: `<area>.<verb>` in lower case (the list itself lives in core, ADR 0033 decision 9).
const AUDIT_ACTION_PATTERN = "^[a-z][a-z_]*\\.[a-z][a-z_]*$";
const REQUEST_KIND_LIST = "'export', 'erasure'";
const SUBJECT_KIND_LIST = "'customer', 'email'";
const CHANNEL_LIST = "'self_service', 'admin'";
const REQUEST_STATUS_LIST = "'received', 'in_progress', 'completed', 'rejected'";
const CLOSED_STATUS_LIST = "'completed', 'rejected'";
const TARGET_KIND_LIST = "'customer', 'order', 'admin_user', 'privacy_request'";

export const privacyRequest = pgTable(
  "privacy_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    subjectKind: text("subject_kind").notNull(),
    // No foreign key: an erasure request deletes the customer it names.
    subjectCustomerId: uuid("subject_customer_id"),
    // HMAC-SHA256 (hex) of the normalized address under a privacy label of ORDER_TOKEN_SECRET; never the address.
    subjectEmailHash: text("subject_email_hash"),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Counts, codes, erased order numbers and the customer id only (never contact data).
    result: jsonb("result"),
    // Admin free text ("how the identity was checked"); the admin UI says "no personal data".
    note: text("note"),
    handledBy: uuid("handled_by"),
  },
  (t) => [
    foreignKey({
      name: "privacy_request_handled_by_fkey",
      columns: [t.handledBy],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    check("privacy_request_kind_check", sql`${t.kind} IN (${sql.raw(REQUEST_KIND_LIST)})`),
    check(
      "privacy_request_subject_kind_check",
      sql`${t.subjectKind} IN (${sql.raw(SUBJECT_KIND_LIST)})`,
    ),
    check("privacy_request_channel_check", sql`${t.channel} IN (${sql.raw(CHANNEL_LIST)})`),
    check("privacy_request_status_check", sql`${t.status} IN (${sql.raw(REQUEST_STATUS_LIST)})`),
    check(
      "privacy_request_subject_customer_check",
      sql`${t.subjectKind} <> 'customer' OR ${t.subjectCustomerId} IS NOT NULL`,
    ),
    // A closed request may lose its hash (it is not needed to find a repeated request any more).
    check(
      "privacy_request_subject_email_check",
      sql`${t.subjectKind} <> 'email' OR ${t.subjectEmailHash} IS NOT NULL OR ${t.status} IN (${sql.raw(CLOSED_STATUS_LIST)})`,
    ),
    check(
      "privacy_request_subject_email_hash_check",
      sql`${t.subjectEmailHash} IS NULL OR ${t.subjectEmailHash} ~ ${sql.raw(`'${SHA256_HEX_PATTERN}'`)}`,
    ),
    // Self-service is the signed-in customer acting alone.
    check(
      "privacy_request_self_service_check",
      sql`${t.channel} <> 'self_service' OR (${t.subjectKind} = 'customer' AND ${t.handledBy} IS NULL)`,
    ),
    check(
      "privacy_request_completed_at_check",
      sql`(${t.status} IN (${sql.raw(CLOSED_STATUS_LIST)})) = (${t.completedAt} IS NOT NULL)`,
    ),
    check(
      "privacy_request_completed_after_received_check",
      sql`${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.receivedAt}`,
    ),
    check("privacy_request_due_at_check", sql`${t.dueAt} > ${t.receivedAt}`),
    check(
      "privacy_request_result_check",
      sql`${t.result} IS NULL OR jsonb_typeof(${t.result}) = 'object'`,
    ),
    check(
      "privacy_request_note_check",
      sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND ${sql.raw(`${NOTE_MAX_LENGTH}`)}`,
    ),
    // The admin list: open requests by due date.
    index("privacy_request_status_due_at_idx").on(t.status, t.dueAt),
    // A repeated request of the same subject.
    index("privacy_request_subject_email_hash_idx").on(t.subjectEmailHash),
    index("privacy_request_subject_customer_id_idx").on(t.subjectCustomerId),
    // Job 12: closed requests past their retention.
    index("privacy_request_completed_at_idx").on(t.completedAt),
    index("privacy_request_handled_by_idx").on(t.handledBy),
  ],
);

export const adminAuditEvent = pgTable(
  "admin_audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // clock_timestamp(): several events of one transaction keep their real order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    adminUserId: uuid("admin_user_id"),
    action: text("action").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    detail: jsonb("detail")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    foreignKey({
      name: "admin_audit_event_admin_user_id_fkey",
      columns: [t.adminUserId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    check(
      "admin_audit_event_action_check",
      sql`${t.action} ~ ${sql.raw(`'${AUDIT_ACTION_PATTERN}'`)}`,
    ),
    check(
      "admin_audit_event_target_kind_check",
      sql`${t.targetKind} IN (${sql.raw(TARGET_KIND_LIST)})`,
    ),
    // Measured on jsonb's text form, which is never shorter than the JSON.stringify form core limits (it adds spaces):
    // a backstop, the core builder is the rule.
    check(
      "admin_audit_event_detail_check",
      sql`jsonb_typeof(${t.detail}) = 'object' AND octet_length(${t.detail}::text) <= ${sql.raw(`${ADMIN_AUDIT_DETAIL_MAX_BYTES}`)}`,
    ),
    // The audit list, newest first, and its filters.
    index("admin_audit_event_created_at_idx").on(t.createdAt.desc()),
    index("admin_audit_event_admin_user_id_created_at_idx").on(t.adminUserId, t.createdAt.desc()),
    index("admin_audit_event_target_idx").on(t.targetKind, t.targetId),
  ],
);
