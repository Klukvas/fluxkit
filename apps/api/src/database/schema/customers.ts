import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Customer accounts and their sessions (docs/plans/2026-10-17-cart-and-orders.md, ADR 0016). A separate principal from
 * `admin_user`: no link between the two tables. Same naming conventions as `admin-auth.ts`. Personal data is limited to
 * email, names and an optional phone; sessions store no IP address and no user agent.
 *
 * The limits mirror packages/core: EMAIL_MAX_LENGTH (auth/email), CONTACT_LIMITS (orders/contact). The spec compares them.
 */

const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 100;
// `+` is optional, then 7 to 15 digits (CONTACT_LIMITS.phoneMinDigits / phoneMaxDigits): the form `normalizePhone` stores.
const PHONE_PATTERN = "^\\+?[0-9]{7,15}$";
const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const customer = pgTable(
  "customer",
  {
    id: id(),
    // Stored normalized (enforced by the CHECK), so the plain unique constraint is a case-insensitive uniqueness.
    email: text("email").notNull(),
    // Self-describing scrypt string, like admin_user.password_hash.
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    // Always null in v1: email delivery is a later plan (ADR 0016); the column exists so that plan needs no migration.
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customer_email_key").on(t.email),
    check(
      "customer_email_check",
      sql`${t.email} = lower(btrim(${t.email})) AND char_length(${t.email}) BETWEEN 3 AND ${sql.raw(`${EMAIL_MAX_LENGTH}`)}`,
    ),
    check("customer_password_hash_check", sql`${t.passwordHash} <> ''`),
    check(
      "customer_first_name_check",
      sql`char_length(${t.firstName}) BETWEEN 1 AND ${sql.raw(`${NAME_MAX_LENGTH}`)}`,
    ),
    check(
      "customer_last_name_check",
      sql`char_length(${t.lastName}) BETWEEN 1 AND ${sql.raw(`${NAME_MAX_LENGTH}`)}`,
    ),
    check(
      "customer_phone_check",
      sql`${t.phone} IS NULL OR ${t.phone} ~ ${sql.raw(`'${PHONE_PATTERN}'`)}`,
    ),
    check("customer_failed_login_count_check", sql`${t.failedLoginCount} >= 0`),
  ],
);

export const customerSession = pgTable(
  "customer_session",
  {
    id: id(),
    customerId: uuid("customer_id").notNull(),
    // SHA-256 (hex) of the random session token; the raw token exists only in the cookie.
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "customer_session_customer_id_fkey",
      columns: [t.customerId],
      foreignColumns: [customer.id],
    }).onDelete("cascade"),
    unique("customer_session_token_hash_key").on(t.tokenHash),
    check(
      "customer_session_token_hash_check",
      sql`${t.tokenHash} ~ ${sql.raw(`'${SHA256_HEX_PATTERN}'`)}`,
    ),
    check("customer_session_expires_at_check", sql`${t.expiresAt} > ${t.createdAt}`),
    index("customer_session_customer_id_idx").on(t.customerId),
    index("customer_session_expires_at_idx").on(t.expiresAt),
  ],
);
