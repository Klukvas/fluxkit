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

const adminAuthTables = ["admin_user", "admin_session"] as const;

// Creation order of 0003 (the drop order is the reverse).
const pricingInventoryTables = [
  "location",
  "price",
  "inventory_level",
  "stock_movement",
  "reservation",
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

  async function existingAdminAuthTables(): Promise<string[]> {
    const present: string[] = [];
    for (const name of adminAuthTables) {
      if (await tableExists(name)) present.push(name);
    }
    return present;
  }

  async function existingPricingInventoryTables(): Promise<string[]> {
    const present: string[] = [];
    for (const name of pricingInventoryTables) {
      if (await tableExists(name)) present.push(name);
    }
    return present;
  }

  async function variantStockColumns(): Promise<string[]> {
    const result = await pool.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'variant'
         and column_name in ('track_inventory', 'allow_backorder') order by column_name`,
    );
    return result.rows.map((row: { column_name: string }) => row.column_name);
  }

  async function triggerFunctionExists(): Promise<boolean> {
    const result = await pool.query(
      "select count(*)::int as count from pg_proc where proname = 'stock_movement_append_only'",
    );
    return result.rows[0].count > 0;
  }

  async function journalRowCount(createdAt: number): Promise<number> {
    const result = await pool.query(
      'select count(*)::int as count from "drizzle"."__drizzle_migrations" where created_at = $1',
      [createdAt],
    );
    return result.rows[0].count;
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
    for (const name of [...pricingInventoryTables].reverse()) {
      await pool.query(`drop table if exists "${name}"`);
    }
    await pool.query('drop function if exists "stock_movement_append_only"()');
    for (const name of [...adminAuthTables].reverse()) {
      await pool.query(`drop table if exists "${name}"`);
    }
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

  it("applies 0000 to 0003, rolls back 0003, 0002, 0001 then 0000, applies again and rolls back again", async () => {
    expect(await tableExists("health_check")).toBe(false);
    expect(await existingCatalogTables()).toEqual([]);
    expect(await existingAdminAuthTables()).toEqual([]);
    expect(await existingPricingInventoryTables()).toEqual([]);

    // "when" of the journal entries: each down script must delete exactly its own bookkeeping row.
    const journal = JSON.parse(
      await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"),
    ) as {
      entries: { tag: string; when: number }[];
    };
    const whenOf = (tag: string): number => {
      const when = journal.entries.find((entry) => entry.tag === tag)?.when;
      if (when === undefined) throw new Error(`${tag} is missing in the journal`);
      return when;
    };
    const adminAuthWhen = whenOf("0002_admin_auth");
    const pricingInventoryWhen = whenOf("0003_pricing_inventory");

    for (let round = 1; round <= 2; round += 1) {
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await tableExists("health_check"), `round ${round}: up`).toBe(true);
      expect(await existingCatalogTables(), `round ${round}: up`).toEqual([...catalogTables]);
      expect(await existingAdminAuthTables(), `round ${round}: up`).toEqual([...adminAuthTables]);
      expect(await existingPricingInventoryTables(), `round ${round}: up`).toEqual([
        ...pricingInventoryTables,
      ]);
      expect(await variantStockColumns(), `round ${round}: up`).toEqual([
        "allow_backorder",
        "track_inventory",
      ]);
      expect(await appliedMigrationCount(), `round ${round}: up`).toBe(4);
      expect(await journalRowCount(pricingInventoryWhen), `round ${round}: up`).toBe(1);

      // Down 0003 only: its tables, function, variant columns and journal row are gone, the rest stays applied.
      await rollback("0003_pricing_inventory.down.sql");
      expect(await existingPricingInventoryTables(), `round ${round}: down 0003`).toEqual([]);
      expect(await variantStockColumns(), `round ${round}: down 0003`).toEqual([]);
      expect(await triggerFunctionExists(), `round ${round}: down 0003`).toBe(false);
      expect(await existingAdminAuthTables(), `round ${round}: down 0003`).toEqual([
        ...adminAuthTables,
      ]);
      expect(await existingCatalogTables(), `round ${round}: down 0003`).toEqual([
        ...catalogTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: down 0003`).toBe(3);
      expect(await journalRowCount(pricingInventoryWhen), `round ${round}: down 0003`).toBe(0);

      // Up again: only 0003 may run. This fails if the down script forgot its bookkeeping row.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingPricingInventoryTables(), `round ${round}: re-up 0003`).toEqual([
        ...pricingInventoryTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0003`).toBe(4);

      await rollback("0003_pricing_inventory.down.sql");

      // Down 0002: the admin tables and their journal row are gone, 0001 and 0000 stay applied.
      await rollback("0002_admin_auth.down.sql");
      expect(await existingAdminAuthTables(), `round ${round}: down 0002`).toEqual([]);
      expect(await existingCatalogTables(), `round ${round}: down 0002`).toEqual([
        ...catalogTables,
      ]);
      expect(await tableExists("health_check"), `round ${round}: down 0002`).toBe(true);
      expect(await appliedMigrationCount(), `round ${round}: down 0002`).toBe(2);
      expect(await journalRowCount(adminAuthWhen), `round ${round}: down 0002`).toBe(0);

      // Up again from the half-rolled-back state: 0002 and 0003 run.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingAdminAuthTables(), `round ${round}: re-up 0002`).toEqual([
        ...adminAuthTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0002`).toBe(4);

      await rollback("0003_pricing_inventory.down.sql");
      await rollback("0002_admin_auth.down.sql");

      // Down 0001: the catalog is gone, the earlier migration stays applied.
      await rollback("0001_catalog.down.sql");
      expect(await existingCatalogTables(), `round ${round}: down 0001`).toEqual([]);
      expect(await tableExists("health_check"), `round ${round}: down 0001`).toBe(true);
      expect(await appliedMigrationCount(), `round ${round}: down 0001`).toBe(1);

      // Up again: 0001, 0002 and 0003 run, 0000 must not run twice.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingCatalogTables(), `round ${round}: re-up 0001`).toEqual([
        ...catalogTables,
      ]);
      expect(await existingAdminAuthTables(), `round ${round}: re-up 0001`).toEqual([
        ...adminAuthTables,
      ]);
      expect(await existingPricingInventoryTables(), `round ${round}: re-up 0001`).toEqual([
        ...pricingInventoryTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0001`).toBe(4);

      await rollback("0003_pricing_inventory.down.sql");
      await rollback("0002_admin_auth.down.sql");
      await rollback("0001_catalog.down.sql");
      await rollback("0000_health_check.down.sql");
      expect(await existingCatalogTables(), `round ${round}: full down`).toEqual([]);
      expect(await existingAdminAuthTables(), `round ${round}: full down`).toEqual([]);
      expect(await existingPricingInventoryTables(), `round ${round}: full down`).toEqual([]);
      expect(await tableExists("health_check"), `round ${round}: full down`).toBe(false);
      expect(await appliedMigrationCount(), `round ${round}: full down`).toBe(0);
    }
  });

  it("refuses to drop a table that still has dependents (no CASCADE in the down script)", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    // An object that depends on a catalog table must make the down script fail loudly instead of being dropped silently.
    await pool.query('create view "catalog_down_probe" as select id from "product"');
    try {
      // 0003 and 0002 are rolled back first: 0003 is the newest migration (and holds foreign keys to variant).
      await rollback("0003_pricing_inventory.down.sql");
      await rollback("0002_admin_auth.down.sql");
      await expect(rollback("0001_catalog.down.sql")).rejects.toMatchObject({ code: "2BP01" });
    } finally {
      await pool.query('drop view if exists "catalog_down_probe"');
    }
    await rollback("0001_catalog.down.sql");
    await rollback("0000_health_check.down.sql");
    expect(await existingCatalogTables()).toEqual([]);
  });
});
