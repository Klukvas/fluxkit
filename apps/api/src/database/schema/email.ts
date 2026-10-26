import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";
import { customer } from "./customers.js";
import { salesOrder } from "./orders.js";

/**
 * Transactional email (ADR 0031 decisions 5 to 9, migration 0007). Same naming conventions as the other schema files.
 * No triggers: rows change only through the outbox (claim, record, cancel, purge) and the token rules.
 *
 * Personal data and secrets: the outbox keeps what is needed to render a mail again (template key and version, locale,
 * frozen variables) and the one recipient address; there is NO column for a rendered subject, HTML or text, a raw token,
 * a guest order link or a provider message text (ADR 0031 decision 8). `variables` is capped at
 * EMAIL_LIMITS.variablesMaxBytes so that a rendered body cannot be parked in it, and provider and error fields hold codes
 * only. `customer_auth_token` stores only SHA-256 of a token; the token itself is derived from the row id and
 * ORDER_TOKEN_SECRET when the mail is rendered (decision 9), so neither table holds a bearer secret.
 *
 * The lists and limits mirror packages/core: EMAIL_MESSAGE_STATUSES and the final statuses (isFinalEmailStatus,
 * EMAIL_RETENTION_DAYS), EMAIL_RECIPIENT_KINDS, EMAIL_TEMPLATE_KEY_PATTERN and EMAIL_TEMPLATE_KEY_MAX_LENGTH,
 * EMAIL_LOCALE_PATTERN, EMAIL_CODE_PATTERN, EMAIL_PROVIDER_CODE_PATTERN, EMAIL_LIMITS (variablesMaxBytes, local part and
 * label lengths), EMAIL_DEADLINE_HOURS, the address rule of validateEmailAddress, the key layout of buildEmailDedupeKey,
 * AUTH_TOKEN_PURPOSES and AUTH_TOKEN_LIFETIME_MINUTES (email), EMAIL_MAX_LENGTH (auth). email-schema.spec.ts compares
 * every one of them with core.
 */

const EMAIL_MAX_LENGTH = 254;
const LOCAL_PART_MAX_LENGTH = 64;
const TEMPLATE_KEY_MAX_LENGTH = 64;
const VARIABLES_MAX_BYTES = 16 * 1024;
const DEADLINE_HOURS = 12;
const RESET_LIFETIME_MINUTES = 60;
const VERIFICATION_LIFETIME_MINUTES = 48 * 60;
const TEMPLATE_KEY_PATTERN = "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$";
const LOCALE_PATTERN = "^[a-z]{2,8}(-[a-z]{2,8})*$";
const PROVIDER_CODE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const CODE_PATTERN = "^[A-Za-z0-9_.:-]{1,64}$";
const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";
// validateEmailAddress in its normalized (lower-case) output: a dot-atom local part of RFC 5322 `atext`, then at least
// two DNS labels of 1 to 63 letters, digits and inner hyphens. ASCII only, so no control, space, comma, angle bracket,
// quote or non-ASCII character can reach a header. The `'` of `atext` is doubled for the SQL literal.
const ATOM = "[a-z0-9!#$%&''*+/=?^_`{|}~-]+";
const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const ADDRESS_PATTERN = `^${ATOM}(\\.${ATOM})*@${LABEL}(\\.${LABEL})+$`;
// The top-level label is not all digits (core: no address literal like `a@127.0.0.1`).
const NUMERIC_TOP_LEVEL_PATTERN = "\\.[0-9]+$";
// buildEmailDedupeKey: `<domain_event.id>:<template key>`.
const DEDUPE_EVENT_ID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:";
const DEDUPE_TEMPLATE_KEY_START = 38;
const STATUS_LIST = "'pending', 'sending', 'sent', 'failed', 'unknown', 'cancelled'";
const OPEN_STATUS_LIST = "'pending', 'sending'";
const FINAL_STATUS_LIST = "'sent', 'failed', 'unknown', 'cancelled'";
const RECIPIENT_KIND_LIST = "'customer', 'guest', 'admin'";
const PURPOSE_LIST = "'password_reset', 'email_verification'";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * The mail outbox (ADR 0031 decisions 5 to 8). An event handler inserts a row with `dedupe_key` (`ON CONFLICT DO
 * NOTHING`), an auth flow in the transaction of its token row; job 9 and the immediate attempt claim, send outside any
 * transaction and record the result; job 10 purges final rows. `id` is the provider idempotency key.
 *
 * `deadline_at` and `created_at` are bounded together (at most EMAIL_DEADLINE_HOURS apart, inside the provider's 24 h
 * idempotency window), so the writer passes both from one clock reading (core `emailDeadlineAt`).
 */
export const emailMessage = pgTable(
  "email_message",
  {
    id: id(),
    templateKey: text("template_key").notNull(),
    // The version the template had at enqueue (ADR 0031 decision 7: rendering must give the same bytes on every attempt).
    templateVersion: integer("template_version").notNull(),
    locale: text("locale").notNull(),
    // The one recipient, normalized; validated by core before the insert and again here.
    toAddress: text("to_address").notNull(),
    recipientKind: text("recipient_kind").notNull(),
    // Links for the admin list and for erasing a customer's mail (privacy plan); SET NULL keeps the delivery record.
    customerId: uuid("customer_id"),
    orderId: uuid("order_id"),
    // The admin recipient of a test send.
    adminUserId: uuid("admin_user_id"),
    // Frozen template input; for an auth mail only the token row id, never the token.
    variables: jsonb("variables").notNull(),
    // `<eventId>:<templateKey>` for event mails; NULL for auth mails, test sends and manual resends.
    dedupeKey: text("dedupe_key"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    // Codes only: a provider's message text can echo an address.
    providerCode: text("provider_code"),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    resendOf: uuid("resend_of"),
    // The admin who made a resend or a test send.
    createdByAdminId: uuid("created_by_admin_id"),
    createdAt: createdAt(),
    // Accepted by the provider (not delivered).
    sentAt: timestamp("sent_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "email_message_customer_id_fkey",
      columns: [t.customerId],
      foreignColumns: [customer.id],
    }).onDelete("set null"),
    foreignKey({
      name: "email_message_order_id_fkey",
      columns: [t.orderId],
      foreignColumns: [salesOrder.id],
    }).onDelete("set null"),
    foreignKey({
      name: "email_message_admin_user_id_fkey",
      columns: [t.adminUserId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    // A purged original leaves its resends in place.
    foreignKey({
      name: "email_message_resend_of_fkey",
      columns: [t.resendOf],
      foreignColumns: [t.id],
    }).onDelete("set null"),
    foreignKey({
      name: "email_message_created_by_admin_id_fkey",
      columns: [t.createdByAdminId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    // Unique only among non-NULL keys: auth mails and resends have none.
    unique("email_message_dedupe_key_key").on(t.dedupeKey),
    check(
      "email_message_template_key_check",
      sql`${t.templateKey} ~ ${sql.raw(`'${TEMPLATE_KEY_PATTERN}'`)} AND char_length(${t.templateKey}) <= ${sql.raw(`${TEMPLATE_KEY_MAX_LENGTH}`)}`,
    ),
    check("email_message_template_version_check", sql`${t.templateVersion} >= 1`),
    check("email_message_locale_check", sql`${t.locale} ~ ${sql.raw(`'${LOCALE_PATTERN}'`)}`),
    check(
      "email_message_to_address_check",
      sql`char_length(${t.toAddress}) <= ${sql.raw(`${EMAIL_MAX_LENGTH}`)} AND ${t.toAddress} ~ ${sql.raw(`'${ADDRESS_PATTERN}'`)} AND char_length(split_part(${t.toAddress}, '@', 1)) <= ${sql.raw(`${LOCAL_PART_MAX_LENGTH}`)} AND ${t.toAddress} !~ ${sql.raw(`'${NUMERIC_TOP_LEVEL_PATTERN}'`)}`,
    ),
    check(
      "email_message_recipient_kind_check",
      sql`${t.recipientKind} IN (${sql.raw(RECIPIENT_KIND_LIST)})`,
    ),
    // A guest has no customer link; a test send concerns no customer and no order; only a test send names an admin
    // recipient. Links may become NULL later (SET NULL), never point elsewhere.
    check(
      "email_message_recipient_check",
      sql`(${t.recipientKind} <> 'guest' OR ${t.customerId} IS NULL) AND (${t.recipientKind} <> 'admin' OR (${t.customerId} IS NULL AND ${t.orderId} IS NULL)) AND (${t.recipientKind} = 'admin' OR ${t.adminUserId} IS NULL)`,
    ),
    // pg_column_size of the value as written (a parameter is not yet compressed), so a compressible body is refused too.
    check(
      "email_message_variables_check",
      sql`jsonb_typeof(${t.variables}) = 'object' AND pg_column_size(${t.variables}) <= ${sql.raw(`${VARIABLES_MAX_BYTES}`)}`,
    ),
    check(
      "email_message_dedupe_key_check",
      sql`${t.dedupeKey} IS NULL OR (${t.dedupeKey} ~ ${sql.raw(`'${DEDUPE_EVENT_ID_PATTERN}'`)} AND substr(${t.dedupeKey}, ${sql.raw(`${DEDUPE_TEMPLATE_KEY_START}`)}) = ${t.templateKey})`,
    ),
    check("email_message_status_check", sql`${t.status} IN (${sql.raw(STATUS_LIST)})`),
    // A claim counts the attempt before the send; failed (deadline passed while pending) and cancelled may have none.
    check(
      "email_message_attempts_check",
      sql`${t.attempts} >= 0 AND (${t.status} NOT IN ('sending', 'sent', 'unknown') OR ${t.attempts} >= 1)`,
    ),
    // The lease is what lets another claim retry a crashed sender's row.
    check(
      "email_message_lease_check",
      sql`${t.status} <> 'sending' OR ${t.leaseUntil} IS NOT NULL`,
    ),
    // Comparisons of booleans, not of the nullable columns, so a NULL never lets a row through.
    check(
      "email_message_sent_check",
      sql`(${t.status} = 'sent') = (${t.sentAt} IS NOT NULL) AND (${t.status} = 'sent') = (${t.providerMessageId} IS NOT NULL) AND (${t.status} <> 'sent' OR ${t.providerCode} IS NOT NULL)`,
    ),
    check(
      "email_message_last_error_check",
      sql`${t.status} NOT IN ('failed', 'unknown') OR ${t.lastErrorCode} IS NOT NULL`,
    ),
    check(
      "email_message_deadline_check",
      sql`${t.deadlineAt} > ${t.createdAt} AND ${t.deadlineAt} <= ${t.createdAt} + interval ${sql.raw(`'${DEADLINE_HOURS} hours'`)}`,
    ),
    check(
      "email_message_provider_code_check",
      sql`${t.providerCode} IS NULL OR ${t.providerCode} ~ ${sql.raw(`'${PROVIDER_CODE_PATTERN}'`)}`,
    ),
    check(
      "email_message_provider_message_id_check",
      sql`${t.providerMessageId} IS NULL OR ${t.providerMessageId} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
    check(
      "email_message_last_error_code_check",
      sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
    check("email_message_resend_of_check", sql`${t.resendOf} IS NULL OR ${t.resendOf} <> ${t.id}`),
    // The claim (job 9, the immediate attempt): due pending rows and sending rows whose lease expired. Final rows are
    // not in it, so it stays as small as the open queue.
    index("email_message_next_attempt_at_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} IN (${sql.raw(OPEN_STATUS_LIST)})`),
    // Job 10: final rows by status and last change (30 or 90 days, EMAIL_RETENTION_DAYS).
    index("email_message_status_updated_at_idx")
      .on(t.status, t.updatedAt)
      .where(sql`${t.status} IN (${sql.raw(FINAL_STATUS_LIST)})`),
    // The admin list (newest first, last 24 h counts) and the exact address filter, also for erasure.
    index("email_message_created_at_idx").on(t.createdAt),
    index("email_message_to_address_idx").on(t.toAddress),
    index("email_message_customer_id_idx").on(t.customerId),
    index("email_message_order_id_idx").on(t.orderId),
    index("email_message_admin_user_id_idx").on(t.adminUserId),
    index("email_message_resend_of_idx").on(t.resendOf),
    index("email_message_created_by_admin_id_idx").on(t.createdByAdminId),
  ],
);

/**
 * Password reset and email verification tokens of customers (ADR 0031 decision 9; admins would get their own table).
 * A token is valid only while unused, unexpired, for its purpose, for an active customer whose address still equals
 * `email` (core `evaluateAuthToken`). At most one unused token per customer and purpose: a new token is stored only after
 * the older ones are marked used (a newer token invalidates the older, decision 9).
 *
 * `expires_at` and `created_at` are bounded together, so the writer passes both from one clock reading (core
 * `authTokenExpiresAt`).
 */
export const customerAuthToken = pgTable(
  "customer_auth_token",
  {
    // Random, and the input of the token derivation.
    id: id(),
    customerId: uuid("customer_id").notNull(),
    purpose: text("purpose").notNull(),
    // SHA-256 of the token, lower-case hex; the lookup key for a presented token.
    tokenHash: text("token_hash").notNull(),
    // The address the token was sent to, normalized like customer.email.
    email: text("email").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set on use and when a newer token, a password change or a deactivation invalidates the token.
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "customer_auth_token_customer_id_fkey",
      columns: [t.customerId],
      foreignColumns: [customer.id],
    }).onDelete("cascade"),
    unique("customer_auth_token_token_hash_key").on(t.tokenHash),
    check("customer_auth_token_purpose_check", sql`${t.purpose} IN (${sql.raw(PURPOSE_LIST)})`),
    check(
      "customer_auth_token_token_hash_check",
      sql`${t.tokenHash} ~ ${sql.raw(`'${SHA256_HEX_PATTERN}'`)}`,
    ),
    check(
      "customer_auth_token_email_check",
      sql`${t.email} = lower(btrim(${t.email})) AND char_length(${t.email}) BETWEEN 3 AND ${sql.raw(`${EMAIL_MAX_LENGTH}`)}`,
    ),
    // Never longer than the lifetime of its purpose (reset 60 minutes, verification 48 hours). One implication per
    // purpose, so an unknown purpose fails the purpose CHECK, not this one.
    check(
      "customer_auth_token_expires_at_check",
      sql`${t.expiresAt} > ${t.createdAt} AND (${t.purpose} <> 'password_reset' OR ${t.expiresAt} <= ${t.createdAt} + interval ${sql.raw(`'${RESET_LIFETIME_MINUTES} minutes'`)}) AND (${t.purpose} <> 'email_verification' OR ${t.expiresAt} <= ${t.createdAt} + interval ${sql.raw(`'${VERIFICATION_LIFETIME_MINUTES} minutes'`)})`,
    ),
    // The per-address request limit counts a customer's recent tokens of one purpose.
    index("customer_auth_token_customer_id_purpose_created_at_idx").on(
      t.customerId,
      t.purpose,
      t.createdAt,
    ),
    uniqueIndex("customer_auth_token_customer_id_purpose_unused_key")
      .on(t.customerId, t.purpose)
      .where(sql`${t.usedAt} IS NULL`),
  ],
);
