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
 * Admin authentication tables (docs/plans/2026-10-16-auth-and-roles.md). Same naming conventions as the catalog
 * (`catalog.ts`): explicit names of at most 63 characters, `_key` / `_idx` / `_check` / `_fkey` suffixes.
 * Personal data is limited to the email: sessions deliberately store no IP address and no user agent.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const adminUser = pgTable(
  "admin_user",
  {
    id: id(),
    // Stored lower-cased (enforced by the CHECK), so the plain unique constraint is a case-insensitive uniqueness.
    email: text("email").notNull(),
    // Self-describing scrypt string (`scrypt$N$r$p$salt$hash`); format and policy are service rules.
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
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
    unique("admin_user_email_key").on(t.email),
    check(
      "admin_user_email_check",
      sql`${t.email} = lower(${t.email}) AND char_length(${t.email}) BETWEEN 3 AND 254`,
    ),
    check("admin_user_password_hash_check", sql`${t.passwordHash} <> ''`),
    // Mirrors the `ROLES` list of packages/core (src/auth). A later step of the auth plan adds a test that compares both.
    check("admin_user_role_check", sql`${t.role} IN ('owner', 'manager', 'viewer')`),
    check("admin_user_failed_login_count_check", sql`${t.failedLoginCount} >= 0`),
  ],
);

export const adminSession = pgTable(
  "admin_session",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    // SHA-256 (hex) of the random session token; the raw token exists only in the cookie.
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "admin_session_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [adminUser.id],
    }).onDelete("cascade"),
    unique("admin_session_token_hash_key").on(t.tokenHash),
    check("admin_session_token_hash_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("admin_session_expires_at_check", sql`${t.expiresAt} > ${t.createdAt}`),
    index("admin_session_user_id_idx").on(t.userId),
    index("admin_session_expires_at_idx").on(t.expiresAt),
  ],
);
