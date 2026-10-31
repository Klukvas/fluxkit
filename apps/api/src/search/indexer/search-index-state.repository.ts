import { nextSearchSyncAttemptAt } from "@fluxkit/core";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";
import { searchIndexState } from "../../database/schema/index.js";

export type IndexStateRow = typeof searchIndexState.$inferSelect;

/** What a finished build installs as the live index of one locale. */
export interface SwappedLocale {
  readonly locale: string;
  readonly liveIndexUid: string;
  readonly settingsHash: string;
  readonly documentVersion: number;
  readonly currency: string;
  readonly documentsCount: number;
}

/** `search_index_state`: one row per locale (ADR 0034 decision 5). Short statements, never around an engine call. */
export class SearchIndexStateRepository {
  async loadAll(db: DbExecutor): Promise<Map<string, IndexStateRow>> {
    const rows = await db.select().from(searchIndexState);
    return new Map(rows.map((row) => [row.locale, row]));
  }

  async ensureRows(db: DbExecutor, locales: readonly string[]): Promise<void> {
    if (locales.length === 0) {
      return;
    }
    await db
      .insert(searchIndexState)
      .values(locales.map((locale) => ({ locale })))
      .onConflictDoNothing({ target: searchIndexState.locale });
  }

  /** Asks for a rebuild of these locales; the stamp is strictly later than the row's previous one (`nextRequestStamp`). */
  async requestRebuild(db: DbExecutor, locales: readonly string[], now: Date): Promise<void> {
    await this.ensureRows(db, locales);
    await db
      .update(searchIndexState)
      .set({
        rebuildRequestedAt: nextRequestStamp(sql`${now.toISOString()}::timestamptz`),
        updatedAt: now,
      })
      .where(inArray(searchIndexState.locale, [...locales]));
  }

  /**
   * The pending rebuild request of every locale as Postgres text (microseconds kept: a JavaScript `Date` would drop
   * them and could make two requests look alike), to be answered with `startBuild` or `restartBuild`.
   */
  async loadRequests(db: DbExecutor): Promise<Map<string, string | null>> {
    const result = await db.execute<{ locale: string; requested: string | null }>(
      sql`select locale, rebuild_requested_at::text as requested from search_index_state`,
    );
    return new Map(result.rows.map((row) => [row.locale, row.requested]));
  }

  /** Records a new build; `answered` is the request the starting run read before the definitions (cleared if unchanged). */
  async startBuild(
    db: DbExecutor,
    locale: string,
    buildIndexUid: string,
    answered: string | null,
    now: Date,
  ): Promise<void> {
    await db
      .update(searchIndexState)
      .set({
        buildIndexUid,
        buildStartedAt: now,
        buildCursor: null,
        buildDocumentsCount: 0,
        rebuildRequestedAt: answeredRequest(answered),
        updatedAt: now,
      })
      .where(eq(searchIndexState.locale, locale));
  }

  /**
   * A request arrived while a build ran: the build starts over from the first product in the same build index (its
   * documents are replaced by id) and the request this run read is answered by it. A newer request stays.
   */
  async restartBuild(db: DbExecutor, locale: string, answered: string, now: Date): Promise<void> {
    await db
      .update(searchIndexState)
      .set({
        buildCursor: null,
        buildDocumentsCount: 0,
        rebuildRequestedAt: answeredRequest(answered),
        updatedAt: now,
      })
      .where(eq(searchIndexState.locale, locale));
  }

  /** Drops a build's bookkeeping (an expired build, or one whose index is gone). */
  async dropBuild(db: DbExecutor, locale: string, now: Date): Promise<void> {
    await db
      .update(searchIndexState)
      .set({
        buildIndexUid: null,
        buildStartedAt: null,
        buildCursor: null,
        buildDocumentsCount: 0,
        updatedAt: now,
      })
      .where(eq(searchIndexState.locale, locale));
  }

  async advanceBuild(
    db: DbExecutor,
    locale: string,
    cursor: string,
    addedDocuments: number,
    now: Date,
  ): Promise<void> {
    await db
      .update(searchIndexState)
      .set({
        buildCursor: cursor,
        buildDocumentsCount: sql`${searchIndexState.buildDocumentsCount} + ${addedDocuments}`,
        updatedAt: now,
      })
      .where(eq(searchIndexState.locale, locale));
  }

  /**
   * After the one atomic swap: the build is the live index of every locale. The swap answers no rebuild request: the
   * requests this build absorbed were cleared when it started or started over; one still set arrived during its last run
   * and is built at the next run.
   */
  async completeSwap(db: DbExecutor, swapped: readonly SwappedLocale[], now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      for (const entry of swapped) {
        await tx
          .update(searchIndexState)
          .set({
            liveIndexUid: entry.liveIndexUid,
            settingsHash: entry.settingsHash,
            documentVersion: entry.documentVersion,
            currency: entry.currency,
            documentsCount: entry.documentsCount,
            builtAt: now,
            buildIndexUid: null,
            buildStartedAt: null,
            buildCursor: null,
            buildDocumentsCount: 0,
            failedAttempts: 0,
            lastErrorCode: null,
            lastErrorAt: null,
            nextAttemptAt: null,
            updatedAt: now,
          })
          .where(eq(searchIndexState.locale, entry.locale));
      }
    });
  }

  async recordSettings(
    db: DbExecutor,
    locale: string,
    settingsHash: string,
    now: Date,
  ): Promise<void> {
    await db
      .update(searchIndexState)
      .set({
        settingsHash,
        failedAttempts: 0,
        lastErrorCode: null,
        lastErrorAt: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(searchIndexState.locale, locale));
  }

  /** A live index the engine no longer has (a wiped volume): the next rebuild run builds it from scratch. */
  async forgetLive(db: DbExecutor, locale: string, now: Date): Promise<void> {
    await db
      .update(searchIndexState)
      .set({ liveIndexUid: null, documentsCount: null, updatedAt: now })
      .where(eq(searchIndexState.locale, locale));
  }

  /**
   * A failed build or settings run: one more failed attempt, the CODE and when the next run may try again (the queue's
   * backoff). Visible in the admin status; the build keeps its cursor and resumes.
   */
  async recordFailure(
    db: DbExecutor,
    locales: readonly string[],
    code: string,
    now: Date,
  ): Promise<void> {
    if (locales.length === 0) {
      return;
    }
    const rows = await db
      .select({ locale: searchIndexState.locale, failedAttempts: searchIndexState.failedAttempts })
      .from(searchIndexState)
      .where(inArray(searchIndexState.locale, [...locales]));
    for (const row of rows) {
      const attempts = row.failedAttempts + 1;
      await db
        .update(searchIndexState)
        .set({
          failedAttempts: attempts,
          lastErrorCode: code,
          lastErrorAt: now,
          nextAttemptAt: nextSearchSyncAttemptAt(attempts, now),
          updatedAt: now,
        })
        .where(
          and(
            eq(searchIndexState.locale, row.locale),
            eq(searchIndexState.failedAttempts, row.failedAttempts),
          ),
        );
    }
  }
}

/**
 * A rebuild request stamp strictly later than the row's previous one (Postgres `greatest` ignores a NULL previous), so
 * clearing "exactly the value a run read" can never clear a newer request that happens to carry the same time. Shared
 * with the fan-out writer (`SearchQueue.requestRebuild`), which passes `now()`.
 */
export function nextRequestStamp(at: SQL): SQL {
  return sql`greatest(${at}, ${searchIndexState.rebuildRequestedAt} + interval '1 microsecond')`;
}

/** Clears the request only when it is still the one the run read (compared to the microsecond); a newer one stays. */
function answeredRequest(answered: string | null): SQL {
  return answered === null
    ? sql`${searchIndexState.rebuildRequestedAt}`
    : sql`case when ${searchIndexState.rebuildRequestedAt} = ${answered}::timestamptz then null else ${searchIndexState.rebuildRequestedAt} end`;
}
