import { Inject, Injectable } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";
import type { MediaKey } from "@fluxkit/core";
import type { DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { mediaUpload } from "../database/schema/index.js";

export type MediaUploadRow = typeof mediaUpload.$inferSelect;
export type NewMediaUpload = Omit<typeof mediaUpload.$inferInsert, "id" | "createdAt">;

/** Queries of `media_upload` only (Drizzle query builder, parameterized). */
@Injectable()
export class MediaUploadRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(values: NewMediaUpload): Promise<MediaUploadRow> {
    const [row] = await this.db.insert(mediaUpload).values(values).returning();
    if (row === undefined) {
      throw new Error("The database returned no row for a statement that must return one.");
    }
    return row;
  }

  /**
   * Sets `first_attached_at` where it is still null and returns the keys that exist, in ONE statement inside the caller's
   * transaction: the UPDATE takes the row locks, so the cleanup job's `DELETE ... WHERE first_attached_at IS NULL` either
   * ran before (the row is gone: not returned) or waits and then finds the row attached (ADR 0028 decision 7).
   */
  async markAttached(db: DbExecutor, keys: readonly MediaKey[]): Promise<Set<string>> {
    if (keys.length === 0) {
      return new Set();
    }
    const rows = await db
      .update(mediaUpload)
      .set({ firstAttachedAt: sql`coalesce(${mediaUpload.firstAttachedAt}, now())` })
      .where(inArray(mediaUpload.storageKey, [...keys]))
      .returning({ storageKey: mediaUpload.storageKey });
    return new Set(rows.map((row) => row.storageKey));
  }

  /** The id, key and pixel size of the uploads named by `ids` (lower-case UUIDs); unknown ids are simply absent. */
  async describeByIds(
    ids: readonly string[],
  ): Promise<{ id: string; storageKey: string; width: number; height: number }[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.db
      .select({
        id: mediaUpload.id,
        storageKey: mediaUpload.storageKey,
        width: mediaUpload.width,
        height: mediaUpload.height,
      })
      .from(mediaUpload)
      .where(inArray(mediaUpload.id, [...ids]));
  }

  /**
   * `markAttached` for uploads named by id (banner pictures, ADR 0046): the same ONE `UPDATE ... RETURNING` in the caller's
   * transaction, with the same row locks against the cleanup job's delete. Returns the ids that exist.
   */
  async markAttachedByIds(db: DbExecutor, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = await db
      .update(mediaUpload)
      .set({ firstAttachedAt: sql`coalesce(${mediaUpload.firstAttachedAt}, now())` })
      .where(inArray(mediaUpload.id, [...ids]))
      .returning({ id: mediaUpload.id });
    return new Set(rows.map((row) => row.id));
  }
}
