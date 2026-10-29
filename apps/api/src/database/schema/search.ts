import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";

/**
 * Catalog search bookkeeping (ADR 0034 decisions 5 and 8, migration 0010). Same naming conventions as the other schema
 * files. No catalog table gets a column: the index is derived from the catalog and never the source of truth.
 *
 * - `search_sync_queue`: one row per product that may be stale in the index, written in the SAME transaction as the
 *   change. No foreign key on `product_id`: a deleted product must still be removed from the index. `change_seq` comes
 *   from `search_sync_seq` and is bumped by every enqueue, so the sync job deletes a row only when no change arrived
 *   after its claim. Codes only (`reason`, `last_error_code`), never an engine message.
 * - `search_index_state`: one row per locale: the live index uid, what it was built with, the rebuild bookkeeping and the
 *   last error code.
 * - `search_synonym_group`: admin-managed synonym groups per locale, applied as the engine's `synonyms` setting.
 *
 * The patterns and limits mirror packages/core: CODE_PATTERN (reasons and error codes), SEARCH_INDEX_UID_PATTERN,
 * SYNONYM_LIMITS and the config locale pattern. search-schema.spec.ts compares them.
 */

const CODE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const LOCALE_PATTERN = "^[a-z]{2,8}(-[a-z]{2,8})*$";
const INDEX_UID_PATTERN = "^[a-z0-9_]{1,128}$";
const CURRENCY_PATTERN = "^[A-Z]{3}$";
// The settings hash of core deriveIndexSettings: 14 lower-case hex digits.
const SETTINGS_HASH_PATTERN = "^[0-9a-f]{14}$";
export const SYNONYM_MIN_TERMS = 2;
export const SYNONYM_MAX_TERMS = 20;
export const SYNONYM_MAX_TERM_LENGTH = 50;

export const searchSyncSeq = pgSequence("search_sync_seq");

export const searchSyncQueue = pgTable(
  "search_sync_queue",
  {
    productId: uuid("product_id").primaryKey(),
    reason: text("reason").notNull(),
    changeSeq: bigint("change_seq", { mode: "number" })
      .notNull()
      .default(sql`nextval('search_sync_seq')`),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
  },
  (t) => [
    check("search_sync_queue_reason_check", sql`${t.reason} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`),
    check(
      "search_sync_queue_last_error_code_check",
      sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
    check("search_sync_queue_attempts_check", sql`${t.attempts} >= 0`),
    check("search_sync_queue_change_seq_check", sql`${t.changeSeq} > 0`),
    // The claim of the sync job: due rows, oldest due first.
    index("search_sync_queue_next_attempt_at_idx").on(t.nextAttemptAt),
  ],
);

export const searchIndexState = pgTable(
  "search_index_state",
  {
    locale: text("locale").primaryKey(),
    liveIndexUid: text("live_index_uid"),
    buildIndexUid: text("build_index_uid"),
    // What the live index was built and configured with (core deriveIndexSettings).
    settingsHash: text("settings_hash"),
    documentVersion: integer("document_version"),
    currency: text("currency"),
    rebuildRequestedAt: timestamp("rebuild_requested_at", { withTimezone: true }),
    buildStartedAt: timestamp("build_started_at", { withTimezone: true }),
    // The last product id a build has sent (builds page by product id and resume after it).
    buildCursor: uuid("build_cursor"),
    buildDocumentsCount: integer("build_documents_count").notNull().default(0),
    builtAt: timestamp("built_at", { withTimezone: true }),
    documentsCount: integer("documents_count"),
    // Consecutive failed build or settings runs, the code of the last one and when the next may start.
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("search_index_state_locale_check", sql`${t.locale} ~ ${sql.raw(`'${LOCALE_PATTERN}'`)}`),
    check(
      "search_index_state_live_index_uid_check",
      sql`${t.liveIndexUid} IS NULL OR ${t.liveIndexUid} ~ ${sql.raw(`'${INDEX_UID_PATTERN}'`)}`,
    ),
    check(
      "search_index_state_build_index_uid_check",
      sql`${t.buildIndexUid} IS NULL OR ${t.buildIndexUid} ~ ${sql.raw(`'${INDEX_UID_PATTERN}'`)}`,
    ),
    check(
      "search_index_state_build_check",
      sql`(${t.buildIndexUid} IS NULL) = (${t.buildStartedAt} IS NULL)`,
    ),
    check(
      "search_index_state_build_uid_distinct_check",
      sql`${t.buildIndexUid} IS NULL OR ${t.liveIndexUid} IS NULL OR ${t.buildIndexUid} <> ${t.liveIndexUid}`,
    ),
    check(
      "search_index_state_cursor_check",
      sql`${t.buildCursor} IS NULL OR ${t.buildIndexUid} IS NOT NULL`,
    ),
    check(
      "search_index_state_settings_hash_check",
      sql`${t.settingsHash} IS NULL OR ${t.settingsHash} ~ ${sql.raw(`'${SETTINGS_HASH_PATTERN}'`)}`,
    ),
    check(
      "search_index_state_currency_check",
      sql`${t.currency} IS NULL OR ${t.currency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`,
    ),
    // A live index always records what it was built with.
    check(
      "search_index_state_live_check",
      sql`${t.liveIndexUid} IS NULL OR (${t.documentVersion} IS NOT NULL AND ${t.currency} IS NOT NULL AND ${t.settingsHash} IS NOT NULL AND ${t.builtAt} IS NOT NULL AND ${t.documentsCount} IS NOT NULL)`,
    ),
    check(
      "search_index_state_document_version_check",
      sql`${t.documentVersion} IS NULL OR ${t.documentVersion} >= 1`,
    ),
    check(
      "search_index_state_counts_check",
      sql`${t.buildDocumentsCount} >= 0 AND (${t.documentsCount} IS NULL OR ${t.documentsCount} >= 0) AND ${t.failedAttempts} >= 0`,
    ),
    check(
      "search_index_state_last_error_code_check",
      sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
  ],
);

export const searchSynonymGroup = pgTable(
  "search_synonym_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locale: text("locale").notNull(),
    // Normalized terms (core parseSynonymTerms): the API is the rule, the checks are a backstop.
    terms: text("terms").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdByAdminId: uuid("created_by_admin_id"),
  },
  (t) => [
    foreignKey({
      name: "search_synonym_group_created_by_admin_id_fkey",
      columns: [t.createdByAdminId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    check(
      "search_synonym_group_locale_check",
      sql`${t.locale} ~ ${sql.raw(`'${LOCALE_PATTERN}'`)}`,
    ),
    // Between 2 and 20 terms, no NULL, no empty term, no control character, none longer than 50 characters: the terms
    // are joined with chr(31), a control character no term may contain, and no run of 51 other characters may appear.
    check(
      "search_synonym_group_terms_check",
      sql`cardinality(${t.terms}) BETWEEN ${sql.raw(`${SYNONYM_MIN_TERMS}`)} AND ${sql.raw(`${SYNONYM_MAX_TERMS}`)} AND array_position(${t.terms}, NULL) IS NULL AND array_position(${t.terms}, '') IS NULL AND array_to_string(${t.terms}, '') !~ '[[:cntrl:]]' AND NOT (array_to_string(${t.terms}, chr(31)) ~ ${sql.raw(`'[^\\x1f]{${SYNONYM_MAX_TERM_LENGTH + 1}}'`)})`,
    ),
    check("search_synonym_group_updated_at_check", sql`${t.updatedAt} >= ${t.createdAt}`),
    index("search_synonym_group_locale_idx").on(t.locale, t.createdAt),
    index("search_synonym_group_created_by_admin_id_idx").on(t.createdByAdminId),
  ],
);
