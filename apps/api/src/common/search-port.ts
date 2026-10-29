import type { SearchSyncReason } from "@fluxkit/core";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "./transaction.js";

/**
 * The extension point between the catalog, price, stock and order code and catalog search (ADR 0034 decisions 1 and 5):
 * code outside `apps/api/src/search/` sees only this port, never the search module (dependency-cruiser rule
 * `api-must-not-import-search`). The search module provides it.
 *
 * Every write that can change a search document calls one of the `*Changed` methods INSIDE its own transaction, after
 * its own row locks: the "needs reindex" mark commits or rolls back with the change (the outbox rule of ADR 0004). The
 * marks are coalescing upserts of `search_sync_queue` rows, one per product, taken in product id order in one statement;
 * call them once per transaction and last, so a transaction never waits for a queue row while holding a lock another
 * writer of the same rows needs first (the lock order is product, variant, level, then queue).
 *
 * With `SEARCH_ENABLED=false` `enabled` is false and every method returns at once without touching the database.
 */
export const SEARCH_PORT = Symbol("SEARCH_PORT");

export interface SearchPort {
  /** `SEARCH_ENABLED`: the `search` flag of both config routes. */
  readonly enabled: boolean;
  /** Marks these products for sync. Ids may repeat; an empty list does nothing. */
  productsChanged(
    tx: Transaction,
    productIds: Iterable<string>,
    reason: SearchSyncReason,
  ): Promise<void>;
  /** Marks the products of these variants (looked up in the same statement). */
  variantsChanged(
    tx: Transaction,
    variantIds: Iterable<string>,
    reason: SearchSyncReason,
  ): Promise<void>;
  /**
   * The fan-out of a shared definition (brand, category, option value, attribute, product type): `productIds` is a query
   * whose single column is a product id. Above the fan-out limit (core `SEARCH_INDEXING.fanOutRebuildThreshold`) nothing
   * is enqueued and a full rebuild of every locale is requested instead (one bounded write).
   */
  productsChangedWhere(tx: Transaction, productIds: SQL, reason: SearchSyncReason): Promise<void>;
}

/**
 * The demo seed's way to write synonym groups (`apps/api/src/seed/`, search plan step 11) without importing the search
 * module. Provided ONLY with `SEARCH_ENABLED=true`; with search off the runner reads `SEARCH_PORT.enabled` and writes
 * nothing to the search tables.
 */
export const SEARCH_SYNONYM_SEEDER = Symbol("SEARCH_SYNONYM_SEEDER");

export type SeedSynonymOutcome = "created" | "existing" | "locale_not_served";

export interface SearchSynonymSeeder {
  /**
   * Creates the group with the rules of `POST /admin/search/synonyms` (normalized terms, a refusal throws), unless a group
   * of the locale already holds one of its terms: then the group counts as existing and is left exactly as it is (an
   * admin may have edited it). A locale outside `LOCALES` creates nothing.
   */
  ensureGroup(locale: string, terms: readonly string[]): Promise<SeedSynonymOutcome>;
}

const nothing = (): Promise<void> => Promise.resolve();

export const DISABLED_SEARCH_PORT: SearchPort = Object.freeze({
  enabled: false,
  productsChanged: nothing,
  variantsChanged: nothing,
  productsChangedWhere: nothing,
});
