import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Same value in every spec that needs the migrated schema: they run in parallel workers on one database. */
const SCHEMA_LOCK_KEY = 7_426_001;

const catalogTables = [
  "attribute",
  "attribute_option",
  "option",
  "option_value",
  "product_type",
  "product_type_attribute",
  "product_type_option",
  "category",
  "brand",
  "product",
  "product_category",
  "product_option",
  "product_option_value",
  "variant",
  "variant_option_value",
  "media",
] as const;

describe("migrations", () => {
  // Destructive: drops the drizzle schema and every table. requireTestDatabaseUrl refuses non-"_test" databases.
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let lockClient: pg.PoolClient;

  async function tableExists(name: string): Promise<boolean> {
    const result = await pool.query("select to_regclass($1) as name", [`public.${name}`]);
    return result.rows[0].name !== null;
  }

  async function existingCatalogTables(): Promise<string[]> {
    const present: string[] = [];
    for (const name of catalogTables) {
      if (await tableExists(name)) present.push(name);
    }
    return present;
  }

  async function appliedMigrationCount(): Promise<number> {
    const result = await pool.query(
      'select count(*)::int as count from "drizzle"."__drizzle_migrations"',
    );
    return result.rows[0].count;
  }

  async function rollback(file: string): Promise<void> {
    await pool.query(await readFile(`${migrationsFolder}/${file}`, "utf8"));
  }

  async function dropEverything(): Promise<void> {
    await pool.query('drop schema if exists "drizzle" cascade');
    // Reverse dependency order, no CASCADE: leftovers of a failed run must not hide a broken down script.
    for (const name of [...catalogTables].reverse()) {
      await pool.query(`drop table if exists "${name}"`);
    }
    await pool.query('drop table if exists "health_check"');
  }

  beforeAll(async () => {
    lockClient = await pool.connect();
    await lockClient.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    await dropEverything();
  }, 120_000);

  afterAll(async () => {
    try {
      await dropEverything();
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
      lockClient.release();
      await pool.end();
    }
  });

  it("applies 0000 and 0001, rolls back 0001 then 0000, applies again and rolls back again", async () => {
    expect(await tableExists("health_check")).toBe(false);
    expect(await existingCatalogTables()).toEqual([]);

    for (let round = 1; round <= 2; round += 1) {
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await tableExists("health_check"), `round ${round}: up`).toBe(true);
      expect(await existingCatalogTables(), `round ${round}: up`).toEqual([...catalogTables]);
      expect(await appliedMigrationCount(), `round ${round}: up`).toBe(2);

      // Down 0001 only: the catalog is gone, the earlier migration stays applied.
      await rollback("0001_catalog.down.sql");
      expect(await existingCatalogTables(), `round ${round}: down 0001`).toEqual([]);
      expect(await tableExists("health_check"), `round ${round}: down 0001`).toBe(true);
      expect(await appliedMigrationCount(), `round ${round}: down 0001`).toBe(1);

      // Up again from the half-rolled-back state: only 0001 may run. This fails if the down script
      // forgot its bookkeeping row (the migrator would silently skip 0001) or if 0000 ran twice.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingCatalogTables(), `round ${round}: re-up 0001`).toEqual([
        ...catalogTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0001`).toBe(2);

      await rollback("0001_catalog.down.sql");
      await rollback("0000_health_check.down.sql");
      expect(await existingCatalogTables(), `round ${round}: full down`).toEqual([]);
      expect(await tableExists("health_check"), `round ${round}: full down`).toBe(false);
      expect(await appliedMigrationCount(), `round ${round}: full down`).toBe(0);
    }
  });

  it("refuses to drop a table that still has dependents (no CASCADE in the down script)", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    // An object that depends on a catalog table must make the down script fail loudly instead of being dropped silently.
    await pool.query('create view "catalog_down_probe" as select id from "product"');
    try {
      await expect(rollback("0001_catalog.down.sql")).rejects.toMatchObject({ code: "2BP01" });
    } finally {
      await pool.query('drop view if exists "catalog_down_probe"');
    }
    await rollback("0001_catalog.down.sql");
    await rollback("0000_health_check.down.sql");
    expect(await existingCatalogTables()).toEqual([]);
  });
});
