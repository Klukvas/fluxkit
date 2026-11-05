import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { banner, bannerImage, mediaUpload } from "../database/schema/index.js";

export type BannerRow = typeof banner.$inferSelect;
type NewBanner = typeof banner.$inferInsert;
export type BannerChanges = Partial<Omit<NewBanner, "id" | "position" | "createdAt" | "updatedAt">>;

/** An upload as a banner shows it: the storage key builds the URL, the size avoids layout shift. */
export interface BannerPicture {
  readonly uploadId: string;
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
}

export interface BannerWithPictures {
  readonly row: BannerRow;
  readonly picture: BannerPicture;
  /** Own pictures by locale. */
  readonly localePictures: ReadonlyMap<string, BannerPicture>;
}

/**
 * Advisory lock key of the banner list: creates (the 50 cap and the next position) and reorders take
 * `pg_advisory_xact_lock(BANNER_LIST_LOCK_KEY)` first, so the count and the set they read are the ones they write into.
 * A bigint unique among the advisory keys of this application (next to `CATEGORY_TREE_LOCK_KEY`). Never reuse it.
 */
export const BANNER_LIST_LOCK_KEY = 7_302_150_002;

const pictureColumns = {
  uploadId: mediaUpload.id,
  storageKey: mediaUpload.storageKey,
  width: mediaUpload.width,
  height: mediaUpload.height,
};

/** Queries only (Drizzle query builder, parameterized). Rules live in the services and in core. */
@Injectable()
export class BannersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Blocks until no other transaction holds the list lock; released at commit or rollback. */
  async lockList(db: DbExecutor): Promise<void> {
    await db.execute(sql`select pg_advisory_xact_lock(${BANNER_LIST_LOCK_KEY})`);
  }

  async count(db: DbExecutor): Promise<number> {
    return db.$count(banner);
  }

  /** The position after the last one (0 for an empty list). */
  async nextPosition(db: DbExecutor): Promise<number> {
    const [row] = await db
      .select({ next: sql<number>`coalesce(max(${banner.position}) + 1, 0)::int` })
      .from(banner);
    return row?.next ?? 0;
  }

  async insert(db: DbExecutor, values: NewBanner): Promise<BannerRow> {
    const [row] = await db.insert(banner).values(values).returning();
    if (row === undefined) {
      throw new Error("The database returned no row for a statement that must return one.");
    }
    return row;
  }

  /** The row under a `FOR UPDATE` lock, so a PATCH merges into the state it writes over. */
  async findForUpdate(db: DbExecutor, id: string): Promise<BannerRow | undefined> {
    const [row] = await db.select().from(banner).where(eq(banner.id, id)).for("update");
    return row;
  }

  async update(db: DbExecutor, id: string, changes: BannerChanges): Promise<void> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    await db.update(banner).set(changes).where(eq(banner.id, id));
  }

  /** Replaces the own pictures of a banner (delete, then insert). */
  async replaceImages(
    db: DbExecutor,
    bannerId: string,
    images: readonly { locale: string; imageUploadId: string }[],
  ): Promise<void> {
    await db.delete(bannerImage).where(eq(bannerImage.bannerId, bannerId));
    if (images.length > 0) {
      await db.insert(bannerImage).values(images.map((image) => ({ bannerId, ...image })));
    }
  }

  /** The stored own pictures of a banner, by locale. */
  async images(
    db: DbExecutor,
    bannerId: string,
  ): Promise<{ locale: string; imageUploadId: string }[]> {
    return db
      .select({ locale: bannerImage.locale, imageUploadId: bannerImage.imageUploadId })
      .from(bannerImage)
      .where(eq(bannerImage.bannerId, bannerId))
      .orderBy(asc(bannerImage.locale));
  }

  /** Returns false when no such banner exists; its own pictures go with it (ON DELETE CASCADE). */
  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(banner).where(eq(banner.id, id)).returning({ id: banner.id });
    return rows.length > 0;
  }

  async ids(db: DbExecutor): Promise<string[]> {
    const rows = await db.select({ id: banner.id }).from(banner);
    return rows.map((row) => row.id);
  }

  /** Positions 0..n-1 in the order of `ids`, in one statement. */
  async setPositions(db: DbExecutor, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await db.execute(sql`
      update ${banner} set "position" = ordered.ordinality - 1, "updated_at" = now()
      from unnest(${sql.param([...ids])}::uuid[]) with ordinality as ordered(id, ordinality)
      where ${banner.id} = ordered.id`);
  }

  /**
   * Banners with their default picture and their own pictures, by position then id; two queries whatever the count.
   * `options.activeOnly` keeps active banners only (the store read); `options.locale` loads only that locale's own
   * pictures.
   */
  async listWithPictures(
    options: { activeOnly?: boolean; locale?: string } = {},
    db: DbExecutor = this.db,
  ): Promise<BannerWithPictures[]> {
    const conditions = options.activeOnly === true ? [eq(banner.isActive, true)] : [];
    const rows = await db
      .select({ row: banner, picture: pictureColumns })
      .from(banner)
      .innerJoin(mediaUpload, eq(mediaUpload.id, banner.imageUploadId))
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(banner.position), asc(banner.id));
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map(({ row }) => row.id);
    const images = await db
      .select({
        bannerId: bannerImage.bannerId,
        locale: bannerImage.locale,
        picture: pictureColumns,
      })
      .from(bannerImage)
      .innerJoin(mediaUpload, eq(mediaUpload.id, bannerImage.imageUploadId))
      .where(
        and(
          inArray(bannerImage.bannerId, ids),
          ...(options.locale === undefined ? [] : [eq(bannerImage.locale, options.locale)]),
        ),
      )
      .orderBy(asc(bannerImage.locale));
    const byBanner = new Map<string, Map<string, BannerPicture>>();
    for (const image of images) {
      const pictures = byBanner.get(image.bannerId) ?? new Map<string, BannerPicture>();
      pictures.set(image.locale, image.picture);
      byBanner.set(image.bannerId, pictures);
    }
    return rows.map(({ row, picture }) => ({
      row,
      picture,
      localePictures: byBanner.get(row.id) ?? new Map(),
    }));
  }
}
