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

// Creation order of 0004 (the drop order is the reverse).
const cartCustomersOrdersTables = [
  "customer",
  "customer_session",
  "cart",
  "cart_item",
  "sales_order",
  "order_item",
  "order_adjustment",
  "order_status_change",
  "order_item_reservation",
  "domain_event",
] as const;

// Migration 0005 (ADR 0028): one table.
const mediaTables = ["media_upload"] as const;

const cartCustomersOrdersFunctions = [
  "order_item_immutable",
  "order_adjustment_append_only",
  "order_status_change_append_only",
] as const;

// Creation order of 0006 (ADR 0029; the drop order is the reverse).
const shippingTables = [
  "shipping_method",
  "shipping_provider_setting",
  "order_shipping",
  "shipment",
  "shipment_status_change",
] as const;

const shippingFunctions = [
  "order_shipping_immutable",
  "shipment_status_change_append_only",
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

  async function existingCartCustomersOrdersTables(): Promise<string[]> {
    const present: string[] = [];
    for (const name of cartCustomersOrdersTables) {
      if (await tableExists(name)) present.push(name);
    }
    return present;
  }

  async function existingMediaTables(): Promise<string[]> {
    const present: string[] = [];
    for (const name of mediaTables) {
      if (await tableExists(name)) present.push(name);
    }
    return present;
  }

  async function existingShippingTables(): Promise<string[]> {
    const present: string[] = [];
    for (const name of shippingTables) {
      if (await tableExists(name)) present.push(name);
    }
    return present;
  }

  async function existingShippingFunctions(): Promise<string[]> {
    const result = await pool.query(
      "select proname from pg_proc where proname = any($1) order by proname",
      [[...shippingFunctions]],
    );
    return result.rows.map((row: { proname: string }) => row.proname);
  }

  async function existingCartCustomersOrdersFunctions(): Promise<string[]> {
    const result = await pool.query(
      "select proname from pg_proc where proname = any($1) order by proname",
      [[...cartCustomersOrdersFunctions]],
    );
    return result.rows.map((row: { proname: string }) => row.proname);
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
    for (const name of [...shippingTables].reverse()) {
      await pool.query(`drop table if exists "${name}"`);
    }
    for (const name of shippingFunctions) {
      await pool.query(`drop function if exists "${name}"()`);
    }
    for (const name of [...mediaTables].reverse()) {
      await pool.query(`drop table if exists "${name}"`);
    }
    for (const name of [...cartCustomersOrdersTables].reverse()) {
      await pool.query(`drop table if exists "${name}"`);
    }
    for (const name of cartCustomersOrdersFunctions) {
      await pool.query(`drop function if exists "${name}"()`);
    }
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

  it("applies 0000 to 0006, rolls back 0006, 0005, 0004, 0003, 0002, 0001 then 0000, applies again and rolls back again", async () => {
    expect(await tableExists("health_check")).toBe(false);
    expect(await existingCatalogTables()).toEqual([]);
    expect(await existingAdminAuthTables()).toEqual([]);
    expect(await existingPricingInventoryTables()).toEqual([]);
    expect(await existingCartCustomersOrdersTables()).toEqual([]);

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
    const cartCustomersOrdersWhen = whenOf("0004_cart_customers_orders");
    const mediaWhen = whenOf("0005_media_upload");
    const shippingWhen = whenOf("0006_shipping");

    for (let round = 1; round <= 2; round += 1) {
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await tableExists("health_check"), `round ${round}: up`).toBe(true);
      expect(await existingCatalogTables(), `round ${round}: up`).toEqual([...catalogTables]);
      expect(await existingAdminAuthTables(), `round ${round}: up`).toEqual([...adminAuthTables]);
      expect(await existingPricingInventoryTables(), `round ${round}: up`).toEqual([
        ...pricingInventoryTables,
      ]);
      expect(await existingCartCustomersOrdersTables(), `round ${round}: up`).toEqual([
        ...cartCustomersOrdersTables,
      ]);
      expect(await existingCartCustomersOrdersFunctions(), `round ${round}: up`).toEqual(
        [...cartCustomersOrdersFunctions].sort(),
      );
      expect(await variantStockColumns(), `round ${round}: up`).toEqual([
        "allow_backorder",
        "track_inventory",
      ]);
      expect(await appliedMigrationCount(), `round ${round}: up`).toBe(7);
      expect(await journalRowCount(cartCustomersOrdersWhen), `round ${round}: up`).toBe(1);
      expect(await existingMediaTables(), `round ${round}: up`).toEqual([...mediaTables]);
      expect(await journalRowCount(mediaWhen), `round ${round}: up`).toBe(1);
      expect(await existingShippingTables(), `round ${round}: up`).toEqual([...shippingTables]);
      expect(await existingShippingFunctions(), `round ${round}: up`).toEqual(
        [...shippingFunctions].sort(),
      );
      expect(await journalRowCount(shippingWhen), `round ${round}: up`).toBe(1);

      // Down 0006 only: its tables, functions and journal row are gone, everything else stays applied.
      await rollback("0006_shipping.down.sql");
      expect(await existingShippingTables(), `round ${round}: down 0006`).toEqual([]);
      expect(await existingShippingFunctions(), `round ${round}: down 0006`).toEqual([]);
      expect(await existingMediaTables(), `round ${round}: down 0006`).toEqual([...mediaTables]);
      expect(await existingCartCustomersOrdersTables(), `round ${round}: down 0006`).toEqual([
        ...cartCustomersOrdersTables,
      ]);
      expect(await existingCartCustomersOrdersFunctions(), `round ${round}: down 0006`).toEqual(
        [...cartCustomersOrdersFunctions].sort(),
      );
      expect(await appliedMigrationCount(), `round ${round}: down 0006`).toBe(6);
      expect(await journalRowCount(shippingWhen), `round ${round}: down 0006`).toBe(0);
      expect(await journalRowCount(mediaWhen), `round ${round}: down 0006`).toBe(1);

      // Up again: only 0006 may run. This fails if the down script forgot its bookkeeping row.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingShippingTables(), `round ${round}: re-up 0006`).toEqual([
        ...shippingTables,
      ]);
      expect(await existingShippingFunctions(), `round ${round}: re-up 0006`).toEqual(
        [...shippingFunctions].sort(),
      );
      expect(await appliedMigrationCount(), `round ${round}: re-up 0006`).toBe(7);
      expect(await journalRowCount(shippingWhen), `round ${round}: re-up 0006`).toBe(1);

      // Down 0005 (after 0006): its table and its journal row are gone, everything else stays applied.
      await rollback("0006_shipping.down.sql");
      await rollback("0005_media_upload.down.sql");
      expect(await existingMediaTables(), `round ${round}: down 0005`).toEqual([]);
      expect(await existingAdminAuthTables(), `round ${round}: down 0005`).toEqual([
        ...adminAuthTables,
      ]);
      expect(await existingCatalogTables(), `round ${round}: down 0005`).toEqual([
        ...catalogTables,
      ]);
      expect(await existingCartCustomersOrdersTables(), `round ${round}: down 0005`).toEqual([
        ...cartCustomersOrdersTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: down 0005`).toBe(5);
      expect(await journalRowCount(mediaWhen), `round ${round}: down 0005`).toBe(0);
      expect(await journalRowCount(cartCustomersOrdersWhen), `round ${round}: down 0005`).toBe(1);

      // Up again: only 0005 and 0006 may run. This fails if the down script forgot its bookkeeping row.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingMediaTables(), `round ${round}: re-up 0005`).toEqual([...mediaTables]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0005`).toBe(7);
      expect(await journalRowCount(mediaWhen), `round ${round}: re-up 0005`).toBe(1);

      // Down 0004 only: its tables and functions and its journal row are gone, the rest stays applied.
      await rollback("0006_shipping.down.sql");
      await rollback("0005_media_upload.down.sql");
      await rollback("0004_cart_customers_orders.down.sql");
      expect(await existingCartCustomersOrdersTables(), `round ${round}: down 0004`).toEqual([]);
      expect(await existingCartCustomersOrdersFunctions(), `round ${round}: down 0004`).toEqual([]);
      expect(await existingPricingInventoryTables(), `round ${round}: down 0004`).toEqual([
        ...pricingInventoryTables,
      ]);
      expect(await triggerFunctionExists(), `round ${round}: down 0004`).toBe(true);
      expect(await appliedMigrationCount(), `round ${round}: down 0004`).toBe(4);
      expect(await journalRowCount(cartCustomersOrdersWhen), `round ${round}: down 0004`).toBe(0);

      // Up again: only 0004 may run. This fails if the down script forgot its bookkeeping row.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingCartCustomersOrdersTables(), `round ${round}: re-up 0004`).toEqual([
        ...cartCustomersOrdersTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0004`).toBe(7);

      await rollback("0006_shipping.down.sql");
      await rollback("0005_media_upload.down.sql");
      await rollback("0004_cart_customers_orders.down.sql");

      // Down 0003: its tables, function, variant columns and journal row are gone, the rest stays applied.
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

      // Up again: 0003 and 0004 run.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingPricingInventoryTables(), `round ${round}: re-up 0003`).toEqual([
        ...pricingInventoryTables,
      ]);
      expect(await existingCartCustomersOrdersTables(), `round ${round}: re-up 0003`).toEqual([
        ...cartCustomersOrdersTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0003`).toBe(7);

      await rollback("0006_shipping.down.sql");
      await rollback("0005_media_upload.down.sql");
      await rollback("0004_cart_customers_orders.down.sql");
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

      // Up again from the half-rolled-back state: 0002, 0003 and 0004 run.
      await migrate(drizzle(pool), { migrationsFolder });
      expect(await existingAdminAuthTables(), `round ${round}: re-up 0002`).toEqual([
        ...adminAuthTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0002`).toBe(7);

      await rollback("0006_shipping.down.sql");
      await rollback("0005_media_upload.down.sql");
      await rollback("0004_cart_customers_orders.down.sql");
      await rollback("0003_pricing_inventory.down.sql");
      await rollback("0002_admin_auth.down.sql");

      // Down 0001: the catalog is gone, the earlier migration stays applied.
      await rollback("0001_catalog.down.sql");
      expect(await existingCatalogTables(), `round ${round}: down 0001`).toEqual([]);
      expect(await tableExists("health_check"), `round ${round}: down 0001`).toBe(true);
      expect(await appliedMigrationCount(), `round ${round}: down 0001`).toBe(1);

      // Up again: 0001 to 0004 run, 0000 must not run twice.
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
      expect(await existingCartCustomersOrdersTables(), `round ${round}: re-up 0001`).toEqual([
        ...cartCustomersOrdersTables,
      ]);
      expect(await appliedMigrationCount(), `round ${round}: re-up 0001`).toBe(7);

      await rollback("0006_shipping.down.sql");
      await rollback("0005_media_upload.down.sql");
      await rollback("0004_cart_customers_orders.down.sql");
      await rollback("0003_pricing_inventory.down.sql");
      await rollback("0002_admin_auth.down.sql");
      await rollback("0001_catalog.down.sql");
      await rollback("0000_health_check.down.sql");
      expect(await existingCatalogTables(), `round ${round}: full down`).toEqual([]);
      expect(await existingAdminAuthTables(), `round ${round}: full down`).toEqual([]);
      expect(await existingPricingInventoryTables(), `round ${round}: full down`).toEqual([]);
      expect(await existingCartCustomersOrdersTables(), `round ${round}: full down`).toEqual([]);
      expect(await existingCartCustomersOrdersFunctions(), `round ${round}: full down`).toEqual([]);
      expect(await existingShippingTables(), `round ${round}: full down`).toEqual([]);
      expect(await existingShippingFunctions(), `round ${round}: full down`).toEqual([]);
      expect(await tableExists("health_check"), `round ${round}: full down`).toBe(false);
      expect(await appliedMigrationCount(), `round ${round}: full down`).toBe(0);
    }
  });

  it("refuses to drop a table that still has dependents (no CASCADE in the down script)", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    // An object that depends on a catalog table must make the down script fail loudly instead of being dropped silently.
    await pool.query('create view "catalog_down_probe" as select id from "product"');
    try {
      // 0004, 0003 and 0002 are rolled back first: they hold foreign keys to variant.
      await rollback("0006_shipping.down.sql");
      await rollback("0005_media_upload.down.sql");
      await rollback("0004_cart_customers_orders.down.sql");
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

  it("refuses to drop an order table that has a dependent object, and changes nothing", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    await pool.query('create view "orders_down_probe" as select id from "sales_order"');
    try {
      await expect(rollback("0004_cart_customers_orders.down.sql")).rejects.toMatchObject({
        code: "2BP01",
      });
      // The script runs as one multi-statement query, so it is atomic: nothing was dropped, the journal row is still there.
      expect(await existingCartCustomersOrdersTables()).toEqual([...cartCustomersOrdersTables]);
      expect(await existingCartCustomersOrdersFunctions()).toEqual(
        [...cartCustomersOrdersFunctions].sort(),
      );
      expect(await appliedMigrationCount()).toBe(7);
    } finally {
      await pool.query('drop view if exists "orders_down_probe"');
    }
    await rollback("0006_shipping.down.sql");
    await rollback("0005_media_upload.down.sql");
    await rollback("0004_cart_customers_orders.down.sql");
    await rollback("0003_pricing_inventory.down.sql");
    await rollback("0002_admin_auth.down.sql");
    await rollback("0001_catalog.down.sql");
    await rollback("0000_health_check.down.sql");
  });

  it("refuses to drop media_upload when it has a dependent object, and changes nothing", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    await pool.query('create view "media_down_probe" as select id from "media_upload"');
    try {
      await expect(rollback("0005_media_upload.down.sql")).rejects.toMatchObject({
        code: "2BP01",
      });
      expect(await existingMediaTables()).toEqual([...mediaTables]);
      expect(await appliedMigrationCount()).toBe(7);
    } finally {
      await pool.query('drop view if exists "media_down_probe"');
    }
    await rollback("0006_shipping.down.sql");
    await rollback("0005_media_upload.down.sql");
    await rollback("0004_cart_customers_orders.down.sql");
    await rollback("0003_pricing_inventory.down.sql");
    await rollback("0002_admin_auth.down.sql");
    await rollback("0001_catalog.down.sql");
    await rollback("0000_health_check.down.sql");
    expect(await existingMediaTables()).toEqual([]);
  });

  it("refuses to drop a shipping table that has a dependent object, and changes nothing", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    await pool.query('create view "shipping_down_probe" as select id from "shipping_method"');
    try {
      await expect(rollback("0006_shipping.down.sql")).rejects.toMatchObject({ code: "2BP01" });
      // One multi-statement query is atomic: the tables dropped before shipping_method are back, the journal row stays.
      expect(await existingShippingTables()).toEqual([...shippingTables]);
      expect(await existingShippingFunctions()).toEqual([...shippingFunctions].sort());
      expect(await appliedMigrationCount()).toBe(7);
    } finally {
      await pool.query('drop view if exists "shipping_down_probe"');
    }
    await rollback("0006_shipping.down.sql");
    await rollback("0005_media_upload.down.sql");
    await rollback("0004_cart_customers_orders.down.sql");
    await rollback("0003_pricing_inventory.down.sql");
    await rollback("0002_admin_auth.down.sql");
    await rollback("0001_catalog.down.sql");
    await rollback("0000_health_check.down.sql");
    expect(await existingShippingTables()).toEqual([]);
  });

  it("upgrades a database that already holds orders to 0006 without touching them, and the down script leaves them intact", async () => {
    // A database exactly as release 0005 left it: everything applied, then 0006 rolled back.
    await migrate(drizzle(pool), { migrationsFolder });
    await rollback("0006_shipping.down.sql");
    expect(await appliedMigrationCount()).toBe(6);

    const order = await pool.query(
      `insert into "sales_order" (number, status, email, phone, first_name, last_name, locale, currency,
         subtotal_amount, shipping_total, discount_total, tax_total, total_amount, idempotency_key,
         request_fingerprint, expires_at, shipping_address)
       values ('0000-0006', 'paid', 'upgrade@example.com', '+380501234567', 'A', 'B', 'uk', 'UAH',
         20000, 500, 0, 0, 20500, gen_random_uuid(), repeat('a', 64), '2099-01-01T00:00:00Z',
         '{"countryCode":"UA","city":"Kyiv","line1":"Branch 1"}') returning id`,
    );
    const orderId = order.rows[0].id as string;
    await pool.query(
      `insert into "order_adjustment" (order_id, kind, code, label, amount, included_in_price)
       values ($1, 'shipping', 'courier', '{"uk":"c"}', 500, false)`,
      [orderId],
    );
    await pool.query(
      `insert into "order_status_change" (order_id, from_status, to_status, actor_type)
       values ($1, null, 'awaiting_payment', 'guest')`,
      [orderId],
    );

    async function ordersSnapshot(): Promise<unknown> {
      const result = await pool.query(
        `select
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from "sales_order" t) as orders,
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from "order_adjustment" t) as adjustments,
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from "order_status_change" t) as changes`,
      );
      return result.rows[0];
    }
    const before = await ordersSnapshot();
    expect(JSON.stringify(before)).toContain("0000-0006");

    // The real migrator applies only 0006; the existing order rows are untouched.
    await migrate(drizzle(pool), { migrationsFolder });
    expect(await appliedMigrationCount()).toBe(7);
    expect(await existingShippingTables()).toEqual([...shippingTables]);
    expect(await ordersSnapshot()).toEqual(before);

    // Use the new tables against the old order: a snapshot, a shipment and its journal.
    const method = await pool.query(
      `insert into "shipping_method" (code, title, kind, pricing, currency, country_codes)
       values ('courier', '{"uk":"c"}', 'address', '{"type":"flat","amount":500}', 'UAH', '{UA}') returning id`,
    );
    await pool.query(
      `insert into "order_shipping" (order_id, method_id, method_code, kind, title, amount, currency, payer)
       values ($1, $2, 'courier', 'address', '{"uk":"c"}', 500, 'UAH', 'shop_charge')`,
      [orderId, method.rows[0].id],
    );
    const shipment = await pool.query(
      `insert into "shipment" (order_id, provider_code, status, client_reference, declared_value_amount, currency,
         payer, weight_grams, length_mm, width_mm, height_mm)
       values ($1, 'fake', 'pending', '0000-0006', 20000, 'UAH', 'recipient', 500, 100, 100, 100) returning id`,
      [orderId],
    );
    await pool.query(
      `insert into "shipment_status_change" (shipment_id, from_status, to_status, actor_type)
       values ($1, null, 'pending', 'admin')`,
      [shipment.rows[0].id],
    );
    // A shipped order is not deleted under its shipment.
    await expect(
      pool.query(`delete from "sales_order" where id = $1`, [orderId]),
    ).rejects.toMatchObject({ code: "23503" });

    // Down 0006: the shipping rows are gone; every order row is exactly as before.
    await rollback("0006_shipping.down.sql");
    expect(await existingShippingTables()).toEqual([]);
    expect(await appliedMigrationCount()).toBe(6);
    expect(await ordersSnapshot()).toEqual(before);

    await rollback("0005_media_upload.down.sql");
    await rollback("0004_cart_customers_orders.down.sql");
    await rollback("0003_pricing_inventory.down.sql");
    await rollback("0002_admin_auth.down.sql");
    await rollback("0001_catalog.down.sql");
    await rollback("0000_health_check.down.sql");
  });

  it("upgrades a database that already holds 0003 data without touching it, and the down script leaves it intact", async () => {
    // A database exactly as release 0003 left it: everything applied, then 0004 rolled back (tables and bookkeeping row).
    await migrate(drizzle(pool), { migrationsFolder });
    await rollback("0006_shipping.down.sql");
    await rollback("0005_media_upload.down.sql");
    await rollback("0004_cart_customers_orders.down.sql");
    expect(await appliedMigrationCount()).toBe(4);

    const productType = await pool.query(
      `insert into "product_type" (code, name) values ('upgrade_type', '{"uk":"t"}') returning id`,
    );
    const product = await pool.query(
      `insert into "product" (product_type_id, slug, title) values ($1, 'upgrade-product', '{"uk":"p"}') returning id`,
      [productType.rows[0].id],
    );
    const variant = await pool.query(
      `insert into "variant" (product_id, sku, option_signature) values ($1, 'UPGRADE-1', '') returning id`,
      [product.rows[0].id],
    );
    const variantId = variant.rows[0].id as string;
    const location = await pool.query(`select id from "location" where code = 'main'`);
    const locationId = location.rows[0].id as string;
    await pool.query(
      `insert into "price" (variant_id, currency, amount, compare_at_amount) values ($1, 'UAH', 10000, 12000)`,
      [variantId],
    );
    await pool.query(
      `insert into "inventory_level" (variant_id, location_id, on_hand, reserved) values ($1, $2, 7, 2)`,
      [variantId, locationId],
    );
    await pool.query(
      `insert into "stock_movement" (variant_id, location_id, delta, kind, on_hand_after, reason)
       values ($1, $2, 7, 'receipt', 7, 'upgrade test')`,
      [variantId, locationId],
    );
    const reservation = await pool.query(
      `insert into "reservation" (variant_id, location_id, quantity, status, expires_at, reference)
       values ($1, $2, 2, 'active', '2099-01-01T00:00:00Z', 'upgrade-ref') returning id`,
      [variantId, locationId],
    );
    const reservationId = reservation.rows[0].id as string;

    async function pricingInventorySnapshot(): Promise<unknown> {
      const result = await pool.query(
        `select
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from "price" t) as price,
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.variant_id), '[]') from "inventory_level" t) as level,
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from "stock_movement" t) as movement,
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from "reservation" t) as reservation,
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]') from "location" t) as location,
           (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from "variant" t) as variant`,
      );
      return result.rows[0];
    }
    const before = await pricingInventorySnapshot();
    expect(JSON.stringify(before)).toContain("upgrade-ref");

    // The real migrator applies only 0004, 0005 and 0006 to this database.
    await migrate(drizzle(pool), { migrationsFolder });
    expect(await appliedMigrationCount()).toBe(7);
    expect(await existingCartCustomersOrdersTables()).toEqual([...cartCustomersOrdersTables]);
    expect(await pricingInventorySnapshot()).toEqual(before);

    // Use the new tables against the old data: an order line holds the old reservation.
    const order = await pool.query(
      `insert into "sales_order" (number, status, email, phone, first_name, last_name, locale, currency,
         subtotal_amount, shipping_total, discount_total, tax_total, total_amount, idempotency_key,
         request_fingerprint, expires_at)
       values ('0000-0001', 'awaiting_payment', 'upgrade@example.com', '+380501234567', 'A', 'B', 'uk', 'UAH',
         20000, 0, 0, 0, 20000, gen_random_uuid(), repeat('a', 64), '2099-01-01T00:00:00Z') returning id`,
    );
    const item = await pool.query(
      `insert into "order_item" (order_id, position, product_id, variant_id, sku, product_title, option_values,
         unit_amount, quantity, line_total, currency, requires_shipping)
       values ($1, 0, $2, $3, 'UPGRADE-1', '{"uk":"p"}', '[]', 10000, 2, 20000, 'UAH', true) returning id`,
      [order.rows[0].id, product.rows[0].id, variantId],
    );
    await pool.query(
      `insert into "order_item_reservation" (order_item_id, reservation_id) values ($1, $2)`,
      [item.rows[0].id, reservationId],
    );
    // The old reservation is now held by an order line.
    await expect(
      pool.query(`delete from "reservation" where id = $1`, [reservationId]),
    ).rejects.toMatchObject({ code: "23503" });

    // Down 0004: the new tables and their data are gone; every 0003 row is exactly as before.
    await rollback("0006_shipping.down.sql");
    await rollback("0005_media_upload.down.sql");
    await rollback("0004_cart_customers_orders.down.sql");
    expect(await existingCartCustomersOrdersTables()).toEqual([]);
    expect(await appliedMigrationCount()).toBe(4);
    expect(await pricingInventorySnapshot()).toEqual(before);

    await rollback("0003_pricing_inventory.down.sql");
    await rollback("0002_admin_auth.down.sql");
    await rollback("0001_catalog.down.sql");
    await rollback("0000_health_check.down.sql");
  });
});
