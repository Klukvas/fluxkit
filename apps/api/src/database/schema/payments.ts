import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";
import { salesOrder } from "./orders.js";

/**
 * Online payments (ADR 0032 decision 5, migration 0008). Same naming conventions as `orders.ts` and `shipping.ts`.
 *
 * The trigger lives in the hand-written part of `0008_payments.sql` (drizzle-kit does not model triggers):
 * `payment_event` is append-only (the ADR 0019 technique).
 *
 * The lists and limits mirror packages/core, as in `shipping.ts`: PAYMENT_STATUSES, LIVE_PAYMENT_STATUSES,
 * REFUND_STATUSES, PAYMENT_ORDER_OUTCOMES, PAYMENT_ATTENTION_CODES, REFUND_REASONS, PAYMENT_EVENT_SOURCES,
 * PAYMENT_CREATED_BY, PAYMENT_PROVIDER_CODE_PATTERN, PAYMENT_CODE_PATTERN, PROVIDER_PAYMENT_ID_PATTERN,
 * PAYMENT_PROVIDER_STATUS_PATTERN, PAYMENT_CARD_SYSTEM_PATTERN, PAYMENT_CARD_LAST4_PATTERN, PAYMENT_LIMITS and the key
 * shapes of buildWebhookDedupeKey / buildPollDedupeKey (payments), MAX_AMOUNT (pricing), TEXT_LIMITS (catalog).
 * payments-schema.spec.ts compares every one of them with core.
 *
 * What the database cannot check and the service must (ADR 0032 decisions 5, 7 and 11): status transitions (core
 * PAYMENT_TRANSITIONS / REFUND_TRANSITIONS), the monotonic provider time, that the provider id never changes once set,
 * and that the sum of the `requested`, `processing`, `succeeded` and `unknown` refunds of a payment never exceeds its
 * amount (core `remainingRefundable`, under the payment row lock). The database bounds each refund by the payment's
 * amount and the succeeded sum (`refunded_amount`) by it.
 */

const MAX_AMOUNT = 1_000_000_000_000;
const URL_MAX_LENGTH = 2048;
const REFUND_NOTE_MAX_LENGTH = 500;
const DEDUPE_KEY_MAX_LENGTH = 200;
const CODE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const CURRENCY_PATTERN = "^[A-Z]{3}$";
const PAYMENT_CODE_PATTERN = "^[A-Za-z0-9_.:-]{1,64}$";
const PROVIDER_PAYMENT_ID_PATTERN = "^[A-Za-z0-9_.-]{1,64}$";
const PROVIDER_STATUS_PATTERN = "^[A-Za-z0-9_.-]{1,32}$";
const CARD_SYSTEM_PATTERN = "^[A-Za-z][A-Za-z0-9_.-]{0,31}$";
const CARD_LAST4_PATTERN = "^[0-9]{4}$";
// A page URL is https and visible ASCII only (no space, no control character).
const REDIRECT_URL_PATTERN = "^https://[!-~]+$";
// `<source>:<key>` for every journal row that has a key.
const DEDUPE_KEY_PATTERN = "^[a-z]+:[A-Za-z0-9_.:-]+$";
// buildWebhookDedupeKey: `webhook:<sha256 hex of the raw body>`.
const WEBHOOK_DEDUPE_KEY_PATTERN = "^webhook:[0-9a-f]{64}$";
// buildPollDedupeKey: `poll:<providerStatus>:<modifiedAt ISO>:<finalAmount|null>:<sha256 of the refund list>`.
const POLL_DEDUPE_KEY_PATTERN =
  "^poll:[A-Za-z0-9_.-]{1,32}:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z:(null|0|[1-9][0-9]{0,12}):[0-9a-f]{64}$";
const PAYMENT_STATUS_LIST =
  "'creating', 'awaiting_customer', 'processing', 'succeeded', 'failed', 'expired', 'invalidated', 'create_unknown'";
const LIVE_PAYMENT_STATUS_LIST = "'creating', 'awaiting_customer', 'processing', 'create_unknown'";
// Statuses only a provider answer or fact reaches, so the provider's invoice id is known (`awaiting_customer` has its own CHECK).
const PROVIDER_KNOWN_STATUS_LIST = "'processing', 'succeeded', 'expired', 'invalidated'";
const REFUND_STATUS_LIST = "'requested', 'processing', 'succeeded', 'failed', 'unknown'";
const REFUND_REASON_LIST = "'admin', 'late_payment', 'duplicate_payment', 'amount_mismatch'";
// The reasons core queues on its own (`OrderOutcomeDecision.automaticRefund`).
const AUTOMATIC_REFUND_REASON_LIST = "'late_payment', 'duplicate_payment'";
const EVENT_SOURCE_LIST = "'webhook', 'poll', 'create', 'admin', 'system'";
// Sources whose row is a verified provider fact.
const FACT_SOURCE_LIST = "'webhook', 'poll'";
const CREATED_BY_LIST = "'customer', 'guest', 'admin'";
const ORDER_OUTCOME_LIST =
  "'applied', 'already_paid', 'order_not_payable', 'amount_mismatch', 'reference_conflict'";
const ATTENTION_CODE_LIST =
  "'late_payment', 'duplicate_payment', 'amount_mismatch', 'fact_not_bound', 'unknown_provider_status', 'unexpected_provider_status', 'external_reversal', 'refund_failed', 'refund_mismatch', 'reconcile_gave_up'";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
// Minor units. bigint as number is exact: the CHECKs keep every value below 2^53.
const money = (name: string) => bigint(name, { mode: "number" });
const raw = (value: string | number) =>
  sql.raw(typeof value === "number" ? `${value}` : `'${value}'`);

/**
 * One payment attempt of an order (ADR 0032 decisions 4 and 5): written `creating` before the provider call, at most one
 * live attempt per order. Holds no card data beyond the card system and the last four digits, no provider message text
 * and no raw provider answer; `redirect_url` exists only while the attempt is live. An order with payments is never
 * deleted (RESTRICT). The CHECKs are consistency rules between columns; every one is NULL-safe (a CHECK that evaluates
 * to NULL passes, so each compares IS NULL / IS NOT NULL explicitly).
 */
export const payment = pgTable(
  "payment",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    providerCode: text("provider_code").notNull(),
    // The provider's invoice id (Monobank `invoiceId`); NULL until the create call answered or a fact bound it.
    providerPaymentId: text("provider_payment_id"),
    // Equal to the order total at creation; never changes (the refunds' composite foreign key keeps it).
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    // The last APPLIED provider status and its time (monotonic, a service rule).
    providerStatus: text("provider_status"),
    providerModifiedAt: timestamp("provider_modified_at", { withTimezone: true }),
    finalAmount: money("final_amount"),
    // The sum of succeeded refunds, written in the refund's transaction.
    refundedAmount: money("refunded_amount").notNull().default(0),
    redirectUrl: text("redirect_url"),
    // The invoice validity end (decision 9).
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // What markPaidIn answered; NULL until then.
    orderOutcome: text("order_outcome"),
    needsAttention: boolean("needs_attention").notNull().default(false),
    // Kept after an admin cleared the item (needs_attention false), so the history stays readable.
    attentionCode: text("attention_code"),
    failureCode: text("failure_code"),
    cardSystem: text("card_system"),
    cardLast4: text("card_last4"),
    // The reconcile schedule (job 11): due when <= now; NULL when nothing is left to check, invalidate or refund.
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    checkAttempts: integer("check_attempts").notNull().default(0),
    // The store create route's Idempotency-Key; an admin-created attempt (later) may have none.
    idempotencyKey: uuid("idempotency_key"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "payment_order_id_fkey",
      columns: [t.orderId],
      foreignColumns: [salesOrder.id],
    }).onDelete("restrict"),
    unique("payment_provider_code_provider_payment_id_key").on(t.providerCode, t.providerPaymentId),
    unique("payment_order_id_idempotency_key_key").on(t.orderId, t.idempotencyKey),
    // The target of the refunds' composite foreign key (a refund copies its payment's currency and amount).
    unique("payment_id_currency_amount_key").on(t.id, t.currency, t.amount),
    check("payment_provider_code_check", sql`${t.providerCode} ~ ${raw(CODE_PATTERN)}`),
    check(
      "payment_provider_payment_id_check",
      sql`${t.providerPaymentId} IS NULL OR ${t.providerPaymentId} ~ ${raw(PROVIDER_PAYMENT_ID_PATTERN)}`,
    ),
    check("payment_amount_check", sql`${t.amount} > 0 AND ${t.amount} <= ${raw(MAX_AMOUNT)}`),
    check("payment_currency_check", sql`${t.currency} ~ ${raw(CURRENCY_PATTERN)}`),
    check("payment_status_check", sql`${t.status} IN (${sql.raw(PAYMENT_STATUS_LIST)})`),
    check(
      "payment_provider_status_check",
      sql`${t.providerStatus} IS NULL OR ${t.providerStatus} ~ ${raw(PROVIDER_STATUS_PATTERN)}`,
    ),
    check(
      "payment_provider_fact_check",
      sql`(${t.providerStatus} IS NULL) = (${t.providerModifiedAt} IS NULL)`,
    ),
    check(
      "payment_provider_payment_id_status_check",
      sql`${t.status} NOT IN (${sql.raw(PROVIDER_KNOWN_STATUS_LIST)}) OR ${t.providerPaymentId} IS NOT NULL`,
    ),
    check(
      "payment_final_amount_check",
      sql`${t.finalAmount} IS NULL OR (${t.finalAmount} >= 0 AND ${t.finalAmount} <= ${t.amount})`,
    ),
    // Only a succeeded attempt is refunded.
    check(
      "payment_refunded_amount_check",
      sql`${t.refundedAmount} >= 0 AND ${t.refundedAmount} <= ${t.amount} AND (${t.refundedAmount} = 0 OR ${t.status} = 'succeeded')`,
    ),
    check(
      "payment_redirect_url_check",
      sql`${t.redirectUrl} IS NULL OR (char_length(${t.redirectUrl}) <= ${raw(URL_MAX_LENGTH)} AND ${t.redirectUrl} ~ ${raw(REDIRECT_URL_PATTERN)})`,
    ),
    // The page URL is kept while the attempt is live and cleared when it is final (decision 5).
    check(
      "payment_redirect_url_status_check",
      sql`${t.redirectUrl} IS NULL OR ${t.status} IN (${sql.raw(LIVE_PAYMENT_STATUS_LIST)})`,
    ),
    check(
      "payment_awaiting_customer_check",
      sql`${t.status} <> 'awaiting_customer' OR (${t.providerPaymentId} IS NOT NULL AND ${t.redirectUrl} IS NOT NULL)`,
    ),
    check(
      "payment_order_outcome_check",
      sql`${t.orderOutcome} IS NULL OR ${t.orderOutcome} IN (${sql.raw(ORDER_OUTCOME_LIST)})`,
    ),
    // Not the reverse: the attempt becomes succeeded and markPaidIn answers in the same transaction, in two statements.
    check(
      "payment_order_outcome_status_check",
      sql`${t.orderOutcome} IS NULL OR ${t.status} = 'succeeded'`,
    ),
    check(
      "payment_attention_code_check",
      sql`${t.attentionCode} IS NULL OR ${t.attentionCode} IN (${sql.raw(ATTENTION_CODE_LIST)})`,
    ),
    check(
      "payment_needs_attention_check",
      sql`NOT ${t.needsAttention} OR ${t.attentionCode} IS NOT NULL`,
    ),
    check(
      "payment_failure_code_check",
      sql`${t.failureCode} IS NULL OR ${t.failureCode} ~ ${raw(PAYMENT_CODE_PATTERN)}`,
    ),
    check(
      "payment_card_system_check",
      sql`${t.cardSystem} IS NULL OR ${t.cardSystem} ~ ${raw(CARD_SYSTEM_PATTERN)}`,
    ),
    check(
      "payment_card_last4_check",
      sql`${t.cardLast4} IS NULL OR ${t.cardLast4} ~ ${raw(CARD_LAST4_PATTERN)}`,
    ),
    check("payment_card_check", sql`(${t.cardSystem} IS NULL) = (${t.cardLast4} IS NULL)`),
    // A live attempt nobody schedules would block the order's payments forever (the one-live-attempt index).
    check(
      "payment_next_check_at_check",
      sql`${t.status} NOT IN (${sql.raw(LIVE_PAYMENT_STATUS_LIST)}) OR ${t.nextCheckAt} IS NOT NULL`,
    ),
    check("payment_check_attempts_check", sql`${t.checkAttempts} >= 0`),
    check("payment_expires_at_check", sql`${t.expiresAt} > ${t.createdAt}`),
    check("payment_created_by_check", sql`${t.createdBy} IN (${sql.raw(CREATED_BY_LIST)})`),
    check(
      "payment_idempotency_key_check",
      sql`${t.createdBy} = 'admin' OR ${t.idempotencyKey} IS NOT NULL`,
    ),
    // At most one live attempt per order (decision 5); closed attempts do not count.
    uniqueIndex("payment_order_id_live_key")
      .on(t.orderId)
      .where(sql`${t.status} IN (${sql.raw(LIVE_PAYMENT_STATUS_LIST)})`),
    // Job 11: due attempts. The schedule column itself marks the work (live attempts, refunds, invalidation), because
    // refund work lives in payment_refund and cannot be part of an index predicate on this table.
    index("payment_next_check_at_idx")
      .on(t.nextCheckAt)
      .where(sql`${t.nextCheckAt} IS NOT NULL`),
    // The admin payment list (`PaymentsRepository.listPage`, migration 0011): newest first, keyset `(created_at, id) <
    // cursor`. NULLS FIRST is the default of DESC in an ORDER BY; with NULLS LAST the planner could not use the index
    // for that order and would sort. The partial index serves the attention list, the full one the unfiltered list and
    // `needsAttention=false`.
    index("payment_attention_created_at_id_idx")
      .on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.needsAttention}`),
    index("payment_created_at_id_idx").on(
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
);

/**
 * Append-only journal of an attempt (trigger in the migration): every verified provider fact (applied or not), every
 * status change and every admin or system action. Normalized fields only: no raw body, no card mask, no provider message
 * text, no bank reference (decision 5). Rows go away only with their payment (cascade), which itself is never deleted
 * while it has refunds and never with its order (RESTRICT).
 */
export const paymentEvent = pgTable(
  "payment_event",
  {
    id: id(),
    paymentId: uuid("payment_id").notNull(),
    source: text("source").notNull(),
    // Required for webhook and poll rows (the replay guard, `ON CONFLICT DO NOTHING`); optional for the others.
    dedupeKey: text("dedupe_key"),
    providerStatus: text("provider_status"),
    providerModifiedAt: timestamp("provider_modified_at", { withTimezone: true }),
    // The fact's amounts and their currency, as received (they may not bind).
    amount: money("amount"),
    finalAmount: money("final_amount"),
    currency: text("currency"),
    failureCode: text("failure_code"),
    // false when the fact was older than the current state, did not bind or changed nothing.
    applied: boolean("applied").notNull(),
    // Both NULL when nothing changed; from_status NULL with a to_status for the creation of the attempt.
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    // SET NULL when the admin user is deleted (same depth-guarded exception as order_status_change.actor_admin_id).
    actorAdminId: uuid("actor_admin_id"),
    // clock_timestamp(), not now(): several rows in one transaction keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "payment_event_payment_id_fkey",
      columns: [t.paymentId],
      foreignColumns: [payment.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "payment_event_actor_admin_id_fkey",
      columns: [t.actorAdminId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    unique("payment_event_dedupe_key_key").on(t.dedupeKey),
    check("payment_event_source_check", sql`${t.source} IN (${sql.raw(EVENT_SOURCE_LIST)})`),
    check(
      "payment_event_dedupe_key_check",
      sql`${t.dedupeKey} IS NULL OR (char_length(${t.dedupeKey}) <= ${raw(DEDUPE_KEY_MAX_LENGTH)} AND ${t.dedupeKey} ~ ${raw(DEDUPE_KEY_PATTERN)} AND split_part(${t.dedupeKey}, ':', 1) = ${t.source})`,
    ),
    check(
      "payment_event_webhook_dedupe_key_check",
      sql`${t.source} <> 'webhook' OR (${t.dedupeKey} IS NOT NULL AND ${t.dedupeKey} ~ ${raw(WEBHOOK_DEDUPE_KEY_PATTERN)})`,
    ),
    check(
      "payment_event_poll_dedupe_key_check",
      sql`${t.source} <> 'poll' OR (${t.dedupeKey} IS NOT NULL AND ${t.dedupeKey} ~ ${raw(POLL_DEDUPE_KEY_PATTERN)})`,
    ),
    check(
      "payment_event_provider_status_check",
      sql`${t.providerStatus} IS NULL OR ${t.providerStatus} ~ ${raw(PROVIDER_STATUS_PATTERN)}`,
    ),
    check(
      "payment_event_provider_fact_check",
      sql`(${t.providerStatus} IS NULL) = (${t.providerModifiedAt} IS NULL)`,
    ),
    // A webhook or poll row is a whole normalized fact: status, time, amount and currency.
    check(
      "payment_event_fact_check",
      sql`${t.source} NOT IN (${sql.raw(FACT_SOURCE_LIST)}) OR (${t.providerStatus} IS NOT NULL AND ${t.providerModifiedAt} IS NOT NULL AND ${t.amount} IS NOT NULL)`,
    ),
    check(
      "payment_event_money_check",
      sql`(${t.amount} IS NULL) = (${t.currency} IS NULL) AND (${t.finalAmount} IS NULL OR ${t.amount} IS NOT NULL)`,
    ),
    check(
      "payment_event_amount_check",
      sql`${t.amount} IS NULL OR (${t.amount} > 0 AND ${t.amount} <= ${raw(MAX_AMOUNT)})`,
    ),
    check(
      "payment_event_final_amount_check",
      sql`${t.finalAmount} IS NULL OR (${t.finalAmount} >= 0 AND ${t.finalAmount} <= ${raw(MAX_AMOUNT)})`,
    ),
    check(
      "payment_event_currency_check",
      sql`${t.currency} IS NULL OR ${t.currency} ~ ${raw(CURRENCY_PATTERN)}`,
    ),
    check(
      "payment_event_failure_code_check",
      sql`${t.failureCode} IS NULL OR ${t.failureCode} ~ ${raw(PAYMENT_CODE_PATTERN)}`,
    ),
    check(
      "payment_event_from_status_check",
      sql`${t.fromStatus} IS NULL OR ${t.fromStatus} IN (${sql.raw(PAYMENT_STATUS_LIST)})`,
    ),
    check(
      "payment_event_to_status_check",
      sql`${t.toStatus} IS NULL OR ${t.toStatus} IN (${sql.raw(PAYMENT_STATUS_LIST)})`,
    ),
    // A change is applied, has a target, and moves to another status (core refuses the same status twice).
    check(
      "payment_event_status_change_check",
      sql`(${t.toStatus} IS NULL OR ${t.applied}) AND (${t.fromStatus} IS NULL OR (${t.toStatus} IS NOT NULL AND ${t.fromStatus} <> ${t.toStatus}))`,
    ),
    check("payment_event_actor_check", sql`${t.actorAdminId} IS NULL OR ${t.source} = 'admin'`),
    index("payment_event_payment_id_created_at_idx").on(t.paymentId, t.createdAt),
    index("payment_event_actor_admin_id_idx").on(t.actorAdminId),
  ],
);

/**
 * One refund of a succeeded attempt (decision 11). The id is sent to the provider as its idempotency reference (Monobank
 * `extRef`); there is no separate provider refund id. `currency` and `payment_amount` copy the payment's through a
 * composite foreign key, so each refund is in its payment's currency and at most its amount; the cumulative limit is a
 * service rule (see the file comment). A payment with refunds is never deleted (RESTRICT).
 */
export const paymentRefund = pgTable(
  "payment_refund",
  {
    id: id(),
    paymentId: uuid("payment_id").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    paymentAmount: money("payment_amount").notNull(),
    status: text("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    // An admin's note; automatic refunds have none.
    note: text("note"),
    // SET NULL when the admin user is deleted.
    actorAdminId: uuid("actor_admin_id"),
    // The admin route's Idempotency-Key.
    idempotencyKey: uuid("idempotency_key"),
    providerModifiedAt: timestamp("provider_modified_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "payment_refund_payment_fkey",
      columns: [t.paymentId, t.currency, t.paymentAmount],
      foreignColumns: [payment.id, payment.currency, payment.amount],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_refund_actor_admin_id_fkey",
      columns: [t.actorAdminId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    unique("payment_refund_idempotency_key_key").on(t.idempotencyKey),
    check(
      "payment_refund_amount_check",
      sql`${t.amount} > 0 AND ${t.amount} <= ${t.paymentAmount} AND ${t.paymentAmount} <= ${raw(MAX_AMOUNT)}`,
    ),
    check("payment_refund_currency_check", sql`${t.currency} ~ ${raw(CURRENCY_PATTERN)}`),
    check("payment_refund_status_check", sql`${t.status} IN (${sql.raw(REFUND_STATUS_LIST)})`),
    check("payment_refund_reason_check", sql`${t.reason} IN (${sql.raw(REFUND_REASON_LIST)})`),
    check(
      "payment_refund_note_check",
      sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND ${raw(REFUND_NOTE_MAX_LENGTH)}`,
    ),
    check(
      "payment_refund_automatic_check",
      sql`${t.reason} NOT IN (${sql.raw(AUTOMATIC_REFUND_REASON_LIST)}) OR (${t.actorAdminId} IS NULL AND ${t.note} IS NULL AND ${t.idempotencyKey} IS NULL)`,
    ),
    check(
      "payment_refund_failure_code_check",
      sql`${t.failureCode} IS NULL OR ${t.failureCode} ~ ${raw(PAYMENT_CODE_PATTERN)}`,
    ),
    check(
      "payment_refund_failure_code_status_check",
      sql`${t.failureCode} IS NULL OR ${t.status} = 'failed'`,
    ),
    index("payment_refund_payment_id_idx").on(t.paymentId),
    index("payment_refund_actor_admin_id_idx").on(t.actorAdminId),
  ],
);
