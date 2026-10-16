import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { requireTestDatabaseUrl } from "./env.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Same key as the schema specs, so a second test process cannot migrate while another one holds the schema. */
const SCHEMA_LOCK_KEY = 7_426_001;

async function journalTimestamps(): Promise<number[]> {
  const journal = JSON.parse(await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
    entries: { when: number }[];
  };
  return journal.entries.map((entry) => entry.when).sort((a, b) => a - b);
}

async function appliedTimestamps(client: pg.PoolClient): Promise<number[]> {
  const exists = await client.query("select to_regclass('drizzle.__drizzle_migrations') as name");
  if (exists.rows[0].name === null) {
    return [];
  }
  const result = await client.query(
    'select created_at from "drizzle"."__drizzle_migrations" order by created_at',
  );
  return result.rows.map((row: { created_at: string }) => Number(row.created_at));
}

/**
 * Makes sure the `_test` database contains exactly the migrations listed in `drizzle/meta/_journal.json`.
 * Call it in `beforeAll` of every HTTP spec: `migrations.spec.ts` leaves the database empty, so the order of spec
 * files must not matter. When the state differs, everything in the `public` and `drizzle` schemas is dropped and
 * all migrations are applied. Refuses databases whose name does not end in `_test`.
 */
export async function ensureMigrated(): Promise<void> {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    const [expected, applied] = [await journalTimestamps(), await appliedTimestamps(client)];
    if (expected.length === applied.length && expected.every((when, i) => when === applied[i])) {
      return;
    }
    await client.query('drop schema if exists "drizzle" cascade');
    const tables = await client.query(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    for (const row of tables.rows as { tablename: string }[]) {
      await client.query(
        `drop table if exists "public".${client.escapeIdentifier(row.tablename)} cascade`,
      );
    }
    // Dropping a table does not drop the trigger function of migration 0003; leaving it would make the migration fail.
    await client.query('drop function if exists "public"."stock_movement_append_only"()');
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
    client.release();
    await pool.end();
  }
}
