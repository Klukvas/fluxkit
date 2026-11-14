import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import type { TestFeatureMigrations } from "./migrate.js";

/** Where the core specs' fixture features live (`sample` without tables, `notebook` with one; ADR 0049). */
export const FIXTURE_FEATURES_DIR = fileURLToPath(new URL("./fixtures/features", import.meta.url));

/** The `notebook` fixture feature's migrations, for `ensureMigrated([NOTEBOOK_MIGRATIONS])`. */
export const NOTEBOOK_MIGRATIONS: TestFeatureMigrations = Object.freeze({
  name: "notebook",
  folder: fileURLToPath(new URL("./fixtures/features/notebook/drizzle", import.meta.url)),
});

/** The down migration of the fixture's only migration (hand-written, like a real feature's). */
export const NOTEBOOK_DOWN_SQL = fileURLToPath(
  new URL("./fixtures/features/notebook/drizzle/0000_fixture_note.down.sql", import.meta.url),
);

/** TEST ONLY: a `media_upload` row without a file, never attached, for media port specs. Returns its id. */
export async function insertUploadRow(
  pool: pg.Pool,
  size: { width: number; height: number } = { width: 64, height: 32 },
): Promise<{ id: string; storageKey: string }> {
  const storageKey = `${randomBytes(16).toString("hex")}.jpg`;
  const result = await pool.query<{ id: string }>(
    `insert into media_upload (storage_key, content_type, byte_size, width, height, sha256)
     values ($1, 'image/jpeg', 100, $2, $3, $4) returning id`,
    [storageKey, size.width, size.height, randomBytes(32).toString("hex")],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("The database returned no row for an insert that must return one.");
  }
  return { id, storageKey };
}
