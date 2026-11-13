import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrateCommand } from "../../database/migrate-command.js";
import { featureMigrationsTable, MIGRATIONS_SCHEMA } from "../../database/migration-journal.js";
import {
  DEFAULT_FEATURES_DIR,
  loadFeatures,
  readManifests,
  type LoadedFeature,
} from "../../features/feature-loader.js";
import { FIXTURE_FEATURES_DIR } from "../../test/notebook-feature.js";
import { createScratchDatabase, type ScratchDatabase } from "../../test/scratch-database.js";
import { checkInventory, coreInventory, mergeFeatureInventories } from "./index.js";
import type { Inventory, SchemaTable } from "./types.js";

/** Every feature package on disk (the real ones and the core fixtures), loaded as if all were enabled. */
async function everyFeatureOnDisk(): Promise<LoadedFeature[]> {
  const loaded: LoadedFeature[] = [];
  for (const featuresDir of [DEFAULT_FEATURES_DIR, FIXTURE_FEATURES_DIR]) {
    const names = (await readManifests(featuresDir)).map((manifest) => manifest.name);
    loaded.push(...(await loadFeatures({ enabled: names, featuresDir })));
  }
  return loaded;
}

/** Every base table of `public` with its columns, as the migrated database has them. */
async function databaseTables(url: string): Promise<SchemaTable[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      `select c.table_name, c.column_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        order by c.table_name, c.ordinal_position`,
    );
    const tables = new Map<string, string[]>();
    for (const row of rows) {
      tables.set(row.table_name, [...(tables.get(row.table_name) ?? []), row.column_name]);
    }
    return [...tables].map(([name, columns]) => ({ name, columns }));
  } finally {
    await client.end();
  }
}

/*
 * ADR 0049, E3: the core enforces that no table escapes classification, whoever wrote it. A scratch database gets the core
 * migrations and the migrations of EVERY feature package present on disk (real features and the core fixtures); every
 * column of every table in `public` must then be classified by the inventory the API builds at startup (core plus the
 * features' `personalDataInventory`). A feature cannot pass with an empty or partial inventory, even without its own spec.
 */
describe("every table of the migrated database is classified (core and every feature on disk)", () => {
  let database: ScratchDatabase;
  let features: LoadedFeature[];
  let merged: Inventory;

  beforeAll(async () => {
    database = await createScratchDatabase();
    await runMigrateCommand([], { DATABASE_URL: database.url }, { log: () => undefined });
    features = await everyFeatureOnDisk();
    const pool = new pg.Pool({ connectionString: database.url, max: 1 });
    try {
      for (const feature of features) {
        if (feature.migrationsFolder === undefined) continue;
        await migrate(drizzle(pool), {
          migrationsFolder: feature.migrationsFolder,
          migrationsTable: featureMigrationsTable(feature.name),
          migrationsSchema: MIGRATIONS_SCHEMA,
        });
      }
    } finally {
      await pool.end();
    }
    merged = mergeFeatureInventories(coreInventory, features);
  });

  afterAll(async () => {
    await database.drop();
  });

  it("migrates at least one feature with tables (the check below is not vacuous)", () => {
    expect(features.some((feature) => feature.name === "notebook")).toBe(true);
    expect(features.filter((feature) => feature.migrationsFolder !== undefined).length).toBe(
      features.filter((feature) => feature.personalDataInventory !== undefined).length,
    );
  });

  it("finds no unclassified table or column, and no entry without its table", async () => {
    expect(checkInventory(merged, await databaseTables(database.url))).toEqual([]);
  });

  it("reports a feature column its inventory leaves out", async () => {
    const rest = Object.fromEntries(
      Object.entries(merged["fixture_note"] ?? {}).filter(
        ([column]) => column !== "cover_upload_id",
      ),
    );
    const partial: Inventory = { ...merged, fixture_note: rest };
    expect(checkInventory(partial, await databaseTables(database.url))).toEqual([
      "fixture_note.cover_upload_id: column has no inventory entry",
    ]);
  });

  it("reports a table nobody classified", async () => {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query("create table unclassified_probe (id integer)");
      expect(checkInventory(merged, await databaseTables(database.url))).toEqual([
        "unclassified_probe: table has no inventory entry",
      ]);
    } finally {
      await client.query("drop table if exists unclassified_probe");
      await client.end();
    }
  });
});
