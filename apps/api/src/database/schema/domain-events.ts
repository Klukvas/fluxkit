import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The transactional outbox (docs/plans/2026-10-17-cart-and-orders.md, ADR 0018). A row is written in the same
 * transaction as the change it reports and dispatched at least once by the scheduler. Payloads carry ids only, never
 * personal data. `aggregate_id` has no foreign key on purpose: it names an order or a customer, and the event must
 * outlive both (a customer can be deleted, an order never is, but the outbox does not depend on either).
 */

const TYPE_PATTERN = "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$";
const ERROR_CODE_PATTERN = "^[A-Za-z0-9_.:-]{1,64}$";

export const domainEvent = pgTable(
  "domain_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // `order.placed`, `customer.registered`, ...: a dotted lower-case name.
    type: text("type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    // A code, never a message text: error messages may carry personal data.
    lastErrorCode: text("last_error_code"),
  },
  (t) => [
    check("domain_event_type_check", sql`${t.type} ~ ${sql.raw(`'${TYPE_PATTERN}'`)}`),
    check("domain_event_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`),
    check("domain_event_attempts_check", sql`${t.attempts} >= 0`),
    check(
      "domain_event_last_error_code_check",
      sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} ~ ${sql.raw(`'${ERROR_CODE_PATTERN}'`)}`,
    ),
    // The dispatcher reads the oldest undispatched rows; dispatched rows are not in this index.
    index("domain_event_dispatched_at_created_at_idx")
      .on(t.dispatchedAt, t.createdAt)
      .where(sql`${t.dispatchedAt} IS NULL`),
  ],
);
