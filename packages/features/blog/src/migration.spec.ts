import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BLOG_DOWN_SQL,
  BLOG_MIGRATIONS_TABLE,
  createScratchDatabase,
  insertUpload,
  migrateBlog,
  migrateCore,
  type ScratchDatabase,
} from "./test/database.js";

const JOURNAL = JSON.parse(
  readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: { tag: string; when: number }[] };

/*
 * Migration 0000_blog_post (plan section 5, ADR 0049): up, down, up, down on a scratch `_test` database. The foreign key to
 * the core `media_upload` table is added by hand in the SQL, invisible to the drift check, so this spec is its only guard.
 */
describe("migration 0000_blog_post: up, down, up, down", () => {
  let database: ScratchDatabase;
  const downSql = readFileSync(BLOG_DOWN_SQL, "utf8");

  async function tableExists(): Promise<boolean> {
    const { rows } = await database.pool.query<{ found: string | null }>(
      "select to_regclass('public.blog_post')::text as found",
    );
    return rows[0]?.found === "blog_post";
  }

  async function coverForeignKey(): Promise<{ referenced: string; onDelete: string } | undefined> {
    const { rows } = await database.pool.query<{ referenced: string; on_delete: string }>(
      `select confrelid::regclass::text as referenced, confdeltype::text as on_delete
         from pg_constraint where conname = 'blog_post_cover_upload_id_fkey' and contype = 'f'`,
    );
    const row = rows[0];
    return row === undefined ? undefined : { referenced: row.referenced, onDelete: row.on_delete };
  }

  async function recordedMigrations(): Promise<number[]> {
    const { rows } = await database.pool.query<{ created_at: string }>(
      `select created_at::text from drizzle.${BLOG_MIGRATIONS_TABLE} order by created_at`,
    );
    return rows.map((row) => Number(row.created_at));
  }

  async function expectUp(): Promise<void> {
    expect(await tableExists()).toBe(true);
    // `r` = ON DELETE RESTRICT: an upload a post shows as its cover cannot be deleted.
    expect(await coverForeignKey()).toEqual({ referenced: "media_upload", onDelete: "r" });
    expect(await recordedMigrations()).toEqual(JOURNAL.entries.map((entry) => entry.when));
  }

  async function expectDown(): Promise<void> {
    expect(await tableExists()).toBe(false);
    expect(await coverForeignKey()).toBeUndefined();
    expect(await recordedMigrations()).toEqual([]);
  }

  beforeAll(async () => {
    database = await createScratchDatabase();
    await migrateCore(database.pool);
  });

  afterAll(async () => {
    await database.drop();
  });

  it("has one journal entry, and the down script deletes exactly its row", () => {
    expect(JOURNAL.entries.map((entry) => entry.tag)).toEqual(["0000_blog_post"]);
    const when = JOURNAL.entries[0]?.when;
    expect(downSql).toContain(
      `DELETE FROM "drizzle"."${BLOG_MIGRATIONS_TABLE}" WHERE "created_at" = ${String(when)};`,
    );
  });

  it("goes up, down, up and down again, the hand-added foreign key with it", async () => {
    await migrateBlog(database.pool);
    await expectUp();

    await database.pool.query(downSql);
    await expectDown();

    await migrateBlog(database.pool);
    await expectUp();

    await database.pool.query(downSql);
    await expectDown();
  });

  it("enforces the foreign key and the checks once up", async () => {
    await migrateBlog(database.pool);
    const upload = await insertUpload(database.pool);
    await database.pool.query(
      `insert into blog_post (slug, title, cover_upload_id) values ('fk-check', '{"uk": "A"}', $1)`,
      [upload.id],
    );
    await expect(
      database.pool.query("delete from media_upload where id = $1", [upload.id]),
    ).rejects.toThrow(/blog_post_cover_upload_id_fkey/);
    await expect(
      database.pool.query(
        `insert into blog_post (slug, title, cover_upload_id) values ('fk-missing', '{"uk": "A"}', gen_random_uuid())`,
      ),
    ).rejects.toThrow(/blog_post_cover_upload_id_fkey/);
    await expect(
      database.pool.query(
        `insert into blog_post (slug, title, status) values ('no-date', '{"uk": "A"}', 'published')`,
      ),
    ).rejects.toThrow(/blog_post_published_at_check/);
    await expect(
      database.pool.query(`insert into blog_post (slug, title) values ('array', '["A"]')`),
    ).rejects.toThrow(/blog_post_title_check/);
    await expect(
      database.pool.query(`insert into blog_post (slug, title) values ('fk-check', '{"uk": "B"}')`),
    ).rejects.toThrow(/blog_post_slug_key/);
    // The down script removes the posts with the table; the upload stays.
    await database.pool.query(downSql);
    const { rows } = await database.pool.query("select id from media_upload where id = $1", [
      upload.id,
    ]);
    expect(rows).toHaveLength(1);
  });
});
