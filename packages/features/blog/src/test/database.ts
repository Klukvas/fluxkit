import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/*
 * TEST ONLY: a scratch database per spec file, so the blog specs never touch the shared `_test` database the API suite uses
 * (and run in parallel with it). The core migrations are read from disk (never imported) because the blog's table has a
 * foreign key to the core `media_upload` table; then the blog's own journal is applied the way `pnpm db:migrate` applies a
 * feature's (ADR 0049: its own migrations table in the `drizzle` schema).
 */

/** The core journal, applied first (the API's `apps/api/drizzle`). */
const CORE_MIGRATIONS = fileURLToPath(new URL("../../../../../apps/api/drizzle", import.meta.url));

/** The blog's journal. */
export const BLOG_MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** The hand-written down migration of `0000_blog_post`. */
export const BLOG_DOWN_SQL = fileURLToPath(
  new URL("../../drizzle/0000_blog_post.down.sql", import.meta.url),
);

export const BLOG_MIGRATIONS_TABLE = "__drizzle_migrations_feature_blog";
export const MIGRATIONS_SCHEMA = "drizzle";

/** `DATABASE_URL`, refused unless it names a database ending in `_test` (destructive tests, AGENTS.md section 3). */
export function requireTestDatabaseUrl(): string {
  const value = process.env["DATABASE_URL"];
  if (value === undefined || value === "") {
    throw new Error(
      "DATABASE_URL must be set for the blog integration specs (README quick start).",
    );
  }
  const name = new URL(value).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run destructive specs against "${name}": the name must end in _test.`,
    );
  }
  return value;
}

export interface ScratchDatabase {
  readonly url: string;
  readonly pool: pg.Pool;
  /** Closes the pool and drops the database. */
  readonly drop: () => Promise<void>;
}

async function onServer(baseUrl: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** An empty database next to the `_test` one; its name ends in `_test` too. */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const baseUrl = requireTestDatabaseUrl();
  const name = `fluxkit_blog_${randomBytes(6).toString("hex")}_test`;
  const quoted = pg.escapeIdentifier(name);
  await onServer(baseUrl, `create database ${quoted}`);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  return {
    url: url.toString(),
    pool,
    drop: async () => {
      await pool.end();
      await onServer(baseUrl, `drop database if exists ${quoted} with (force)`);
    },
  };
}

export async function migrateCore(pool: pg.Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: CORE_MIGRATIONS });
}

export async function migrateBlog(pool: pg.Pool): Promise<void> {
  await migrate(drizzle(pool), {
    migrationsFolder: BLOG_MIGRATIONS,
    migrationsTable: BLOG_MIGRATIONS_TABLE,
    migrationsSchema: MIGRATIONS_SCHEMA,
  });
}

/** A scratch database with the core and the blog migrations applied. */
export async function createMigratedDatabase(): Promise<ScratchDatabase> {
  const database = await createScratchDatabase();
  try {
    await migrateCore(database.pool);
    await migrateBlog(database.pool);
  } catch (error) {
    await database.drop();
    throw error;
  }
  return database;
}

/** TEST ONLY: a `media_upload` row without a file, never attached. */
export async function insertUpload(
  pool: pg.Pool,
  size: { width: number; height: number } = { width: 1200, height: 675 },
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

export async function firstAttachedAt(pool: pg.Pool, uploadId: string): Promise<Date | null> {
  const result = await pool.query<{ first_attached_at: Date | null }>(
    "select first_attached_at from media_upload where id = $1",
    [uploadId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`No upload ${uploadId}.`);
  return row.first_attached_at;
}
