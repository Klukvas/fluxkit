import { nextSearchSyncAttemptAt } from "@fluxkit/core";
import { and, eq, inArray, sql } from "drizzle-orm";
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

  async requestRebuild(db: DbExecutor, locales: readonly string[], now: Date): Promise<void> {
    await this.ensureRows(db, locales);
    await db
      .update(searchIndexState)
      .set({ rebuildRequestedAt: now, updatedAt: now })
      .where(inArray(searchIndexState.locale, [...locales]));
  }

  async startBuild(
    db: DbExecutor,
    locale: string,
    buildIndexUid: string,
    now: Date,
  ): Promise<void> {
    await db
      .update(searchIndexState)
      .set({
        buildIndexUid,
        buildStartedAt: now,
        buildCursor: null,
        buildDocumentsCount: 0,
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
   * After the one atomic swap: the build is the live index of every locale. A rebuild request made after the build
   * started survives (a change of the catalog definitions during the build is rebuilt again); an older one is answered.
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
            rebuildRequestedAt: sql`case when ${searchIndexState.rebuildRequestedAt} <= ${searchIndexState.buildStartedAt} then null else ${searchIndexState.rebuildRequestedAt} end`,
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
