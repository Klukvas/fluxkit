import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  appliedTimestamps,
  CORE_MIGRATIONS_TABLE,
  FEATURE_MIGRATIONS_TABLE_PREFIX,
  featureMigrationsTable,
  MIGRATIONS_SCHEMA,
  readJournal,
} from "../database/migration-journal.js";
import { requireTestDatabaseUrl } from "./env.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Same key as the schema specs, so a second test process cannot migrate while another one holds the schema. */
const SCHEMA_LOCK_KEY = 7_426_001;

/** A feature whose migrations a spec needs applied (ADR 0049): its name and its `drizzle/` folder. */
export interface TestFeatureMigrations {
  name: string;
  folder: string;
}

/** `migrations table -> created_at list` the database should hold, or holds. */
type MigrationState = Map<string, number[]>;

async function expectedState(features: readonly TestFeatureMigrations[]): Promise<MigrationState> {
  const state: MigrationState = new Map();
  for (const [table, folder] of [
    [CORE_MIGRATIONS_TABLE, migrationsFolder],
    ...features.map(({ name, folder }) => [featureMigrationsTable(name), folder] as const),
  ] as const) {
    state.set(
      table,
      (await readJournal(folder)).map((entry) => entry.when).sort((a, b) => a - b),
    );
  }
  return state;
}

/** The core table (when present) and every feature migrations table found in the database. */
async function appliedState(client: pg.PoolClient): Promise<MigrationState> {
  const featureTables = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = $1 and starts_with(tablename, $2)",
    [MIGRATIONS_SCHEMA, FEATURE_MIGRATIONS_TABLE_PREFIX],
  );
  const state: MigrationState = new Map();
  for (const table of [CORE_MIGRATIONS_TABLE, ...featureTables.rows.map((row) => row.tablename)]) {
    const applied = await appliedTimestamps(client, table);
    if (applied.length > 0 || table !== CORE_MIGRATIONS_TABLE) {
      state.set(table, applied);
    }
  }
  return state;
}

function sameState(expected: MigrationState, applied: MigrationState): boolean {
  if (expected.size !== applied.size) {
    return false;
  }
  for (const [table, whens] of expected) {
    const found = applied.get(table);
    if (
      found === undefined ||
      found.length !== whens.length ||
      !whens.every((when, i) => when === found[i])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Makes sure the `_test` database contains exactly the migrations listed in `drizzle/meta/_journal.json` plus those of
 * `features` (ADR 0049), and no other feature's. Call it in `beforeAll` of every HTTP spec: `migrations.spec.ts` leaves
 * the database empty, so the order of spec files must not matter, and a spec that ran with a feature leaves its tables
 * behind. When the state differs, everything in the `public` and `drizzle` schemas is dropped (a feature table and its
 * foreign keys to core tables go with `CASCADE`, its migrations table with the `drizzle` schema), then the core
 * migrations and the given features' are applied. Refuses databases whose name does not end in `_test`. A spec that passes
 * features calls `ensureMigrated()` again in its `afterAll`: the schema specs drop core tables by name, without `CASCADE`,
 * and a feature table's foreign key to a core table would block them.
 */
export async function ensureMigrated(
  features: readonly TestFeatureMigrations[] = [],
): Promise<void> {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    if (sameState(await expectedState(features), await appliedState(client))) {
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
    // Dropping a table does not drop the sequence of 0010 (its column default only uses it).
    await client.query('drop sequence if exists "public"."search_sync_seq"');
    // Dropping a table does not drop the trigger functions of migrations 0003, 0004, 0006, 0008, 0009 and 0011; leaving one would make the migration fail.
    for (const name of [
      "append_only_refuse_truncate",
      "admin_audit_event_append_only",
      "payment_event_append_only",
      "stock_movement_append_only",
      "order_item_immutable",
      "order_adjustment_append_only",
      "order_status_change_append_only",
      "order_shipping_immutable",
      "shipment_status_change_append_only",
    ]) {
      await client.query(`drop function if exists "public".${client.escapeIdentifier(name)}()`);
    }
    await migrate(drizzle(pool), { migrationsFolder });
    for (const feature of features) {
      await migrate(drizzle(pool), {
        migrationsFolder: feature.folder,
        migrationsTable: featureMigrationsTable(feature.name),
        migrationsSchema: MIGRATIONS_SCHEMA,
      });
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
    client.release();
    await pool.end();
  }
}
