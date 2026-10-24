import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_AMOUNT, MAX_ON_HAND, MAX_QUANTITY } from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import * as catalogSchema from "./schema/catalog.js";
import * as pricingInventorySchema from "./schema/pricing-inventory.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Same value in every spec that needs the migrated schema: they run in parallel workers on one database. */
const SCHEMA_LOCK_KEY = 7_426_001;

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("pricing and inventory schema (real Postgres)", () => {
  // Destructive: drops the whole schema in beforeAll/afterAll. requireTestDatabaseUrl refuses non-"_test" databases.
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let lockClient: pg.PoolClient;
  // Every test runs in its own transaction that is rolled back, so tests never see each other's rows.
  let client: pg.PoolClient;

  async function dropEverything(): Promise<void> {
    await pool.query('drop schema if exists "drizzle" cascade');
    // Reverse dependency order, no CASCADE (same reasoning as migrations.spec.ts).
    for (const name of [
      "shipment_status_change",
      "shipment",
      "order_shipping",
      "shipping_provider_setting",
      "shipping_method",
      "media_upload",
      "domain_event",
      "order_item_reservation",
      "order_status_change",
      "order_adjustment",
      "order_item",
      "sales_order",
      "cart_item",
      "cart",
      "customer_session",
      "customer",
      "reservation",
      "stock_movement",
      "inventory_level",
      "price",
      "location",
      "admin_session",
      "admin_user",
      "media",
      "variant_option_value",
      "variant",
      "product_option_value",
      "product_option",
      "product_category",
      "product",
      "brand",
      "category",
      "product_type_option",
      "product_type_attribute",
      "product_type",
      "option_value",
      "option",
      "attribute_option",
      "attribute",
      "health_check",
    ]) {
      await pool.query(`drop table if exists "${name}"`);
    }
    await pool.query('drop function if exists "shipment_status_change_append_only"()');
    await pool.query('drop function if exists "order_shipping_immutable"()');
    await pool.query('drop function if exists "order_status_change_append_only"()');
    await pool.query('drop function if exists "order_adjustment_append_only"()');
    await pool.query('drop function if exists "order_item_immutable"()');
    await pool.query('drop function if exists "stock_movement_append_only"()');
  }

  beforeAll(async () => {
    lockClient = await pool.connect();
    await lockClient.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    await dropEverything();
    await migrate(drizzle(pool), { migrationsFolder });
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

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
  });

  afterEach(async () => {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  async function insert(table: string, row: Row): Promise<Record<string, unknown>> {
    const columns = Object.keys(row);
    const result = await client.query(
      `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) ` +
        `values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
      Object.values(row),
    );
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} row`);
  }

  async function insertId(table: string, row: Row): Promise<string> {
    const created = await insert(table, row);
    if (typeof created.id !== "string") throw new Error(`Test setup bug: ${table} has no id`);
    return created.id;
  }

  async function count(table: string, where = "true"): Promise<number> {
    const result = await client.query(
      `select count(*)::int as count from "${table}" where ${where}`,
    );
    return must(result.rows[0] as { count: number } | undefined, "count row").count;
  }

  /** Runs one statement that must fail; asserts SQLSTATE and constraint name, then undoes the failed statement. */
  async function expectViolation(
    run: () => Promise<unknown>,
    code: string,
    constraint: string | undefined,
  ): Promise<pg.DatabaseError> {
    await client.query("savepoint expected_violation");
    const error = await run().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await client.query("rollback to savepoint expected_violation");
    expect(
      error,
      `expected "${constraint ?? code}" to be violated, but the statement succeeded`,
    ).toBeInstanceOf(pg.DatabaseError);
    if (!(error instanceof pg.DatabaseError)) throw new Error("unreachable");
    expect({ code: error.code, constraint: error.constraint }).toEqual({ code, constraint });
    return error;
  }

  /** A statement that must succeed even though it is a boundary value. */
  async function expectAccepted(run: () => Promise<unknown>): Promise<void> {
    await client.query("savepoint expected_accept");
    try {
      await run();
    } finally {
      await client.query("rollback to savepoint expected_accept");
    }
  }

  let sequence = 0;
  const i18n = (value: string) => JSON.stringify({ uk: value });

  async function createVariant(extra: Row = {}): Promise<string> {
    sequence += 1;
    const productTypeId = await insertId("product_type", {
      code: `type_${sequence}`,
      name: i18n("type"),
    });
    const productId = await insertId("product", {
      product_type_id: productTypeId,
      slug: `product-${sequence}`,
      title: i18n("product"),
    });
    return insertId("variant", {
      product_id: productId,
      sku: `SKU-${sequence}`,
      option_signature: "",
      ...extra,
    });
  }

  async function defaultLocationId(): Promise<string> {
    const result = await client.query(`select id from "location" where code = 'main'`);
    return must((result.rows[0] as { id: string } | undefined)?.id, "main location");
  }

  async function createLocation(code: string, extra: Row = {}): Promise<string> {
    return insertId("location", { code, name: code, ...extra });
  }

  async function createUser(email = "owner@example.com"): Promise<string> {
    return insertId("admin_user", {
      email,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      role: "owner",
    });
  }

  const priceRow = (variantId: string, extra: Row = {}): Row => ({
    variant_id: variantId,
    currency: "UAH",
    amount: 10_000,
    ...extra,
  });
  const levelRow = (variantId: string, locationId: string, extra: Row = {}): Row => ({
    variant_id: variantId,
    location_id: locationId,
    on_hand: 5,
    ...extra,
  });
  const movementRow = (variantId: string, locationId: string, extra: Row = {}): Row => ({
    variant_id: variantId,
    location_id: locationId,
    delta: 5,
    kind: "receipt",
    on_hand_after: 5,
    ...extra,
  });
  const reservationRow = (variantId: string, locationId: string, extra: Row = {}): Row => ({
    variant_id: variantId,
    location_id: locationId,
    quantity: 1,
    status: "active",
    expires_at: "2099-01-01T00:00:00Z",
    ...extra,
  });

  describe("variant stock flags", () => {
    it("default to tracked and no backorder for new variants", async () => {
      const variantId = await createVariant();
      const result = await client.query(
        'select track_inventory, allow_backorder from "variant" where id = $1',
        [variantId],
      );
      expect(result.rows[0]).toEqual({ track_inventory: true, allow_backorder: false });
    });

    it("accept explicit values", async () => {
      const variantId = await createVariant({ track_inventory: false, allow_backorder: true });
      const result = await client.query(
        'select track_inventory, allow_backorder from "variant" where id = $1',
        [variantId],
      );
      expect(result.rows[0]).toEqual({ track_inventory: false, allow_backorder: true });
    });

    it("are NOT NULL", async () => {
      await expectViolation(() => createVariant({ track_inventory: null }), "23502", undefined);
    });
  });

  describe("price", () => {
    it("accepts a price and applies the defaults", async () => {
      const variantId = await createVariant();
      const created = await insert("price", priceRow(variantId));
      expect(created).toMatchObject({
        variant_id: variantId,
        currency: "UAH",
        compare_at_amount: null,
      });
      // pg returns bigint as a string.
      expect(created.amount).toBe("10000");
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("rejects a currency that is not three capital letters", async () => {
      const variantId = await createVariant();
      for (const currency of ["uah", "UA", "UAHH", "U1H", "", "ГРН"]) {
        await expectViolation(
          () => insert("price", priceRow(variantId, { currency })),
          CHECK_VIOLATION,
          "price_currency_check",
        );
      }
    });

    it("accepts amount 0 and the maximum, rejects -1 and the maximum plus one", async () => {
      const variantId = await createVariant();
      await expectAccepted(() => insert("price", priceRow(variantId, { amount: 0 })));
      await expectAccepted(() => insert("price", priceRow(variantId, { amount: MAX_AMOUNT })));
      for (const amount of [-1, MAX_AMOUNT + 1]) {
        await expectViolation(
          () => insert("price", priceRow(variantId, { amount })),
          CHECK_VIOLATION,
          "price_amount_check",
        );
      }
    });

    it("compare-at must be NULL or greater than the amount and within the maximum", async () => {
      const variantId = await createVariant();
      await expectAccepted(() =>
        insert("price", priceRow(variantId, { amount: 100, compare_at_amount: 101 })),
      );
      await expectAccepted(() =>
        insert("price", priceRow(variantId, { amount: 100, compare_at_amount: MAX_AMOUNT })),
      );
      for (const compareAt of [100, 99, 0, -1, MAX_AMOUNT + 1]) {
        await expectViolation(
          () => insert("price", priceRow(variantId, { amount: 100, compare_at_amount: compareAt })),
          CHECK_VIOLATION,
          "price_compare_at_amount_check",
        );
      }
    });

    it("compare-at equal to the amount is rejected even at the maximum amount", async () => {
      const variantId = await createVariant();
      await expectViolation(
        () =>
          insert(
            "price",
            priceRow(variantId, { amount: MAX_AMOUNT, compare_at_amount: MAX_AMOUNT }),
          ),
        CHECK_VIOLATION,
        "price_compare_at_amount_check",
      );
    });

    it("allows one price per variant and currency, and several currencies per variant", async () => {
      const variantId = await createVariant();
      await insert("price", priceRow(variantId));
      await expectViolation(
        () => insert("price", priceRow(variantId, { amount: 5 })),
        UNIQUE_VIOLATION,
        "price_variant_id_currency_key",
      );
      await insert("price", priceRow(variantId, { currency: "USD" }));
      const other = await createVariant();
      await insert("price", priceRow(other));
      expect(await count("price")).toBe(3);
    });

    it("rejects an unknown variant", async () => {
      await expectViolation(
        () => insert("price", priceRow("00000000-0000-4000-8000-000000000000")),
        FOREIGN_KEY_VIOLATION,
        "price_variant_id_fkey",
      );
    });

    it("is deleted with its variant", async () => {
      const variantId = await createVariant();
      await insert("price", priceRow(variantId));
      await client.query('delete from "variant" where id = $1', [variantId]);
      expect(await count("price")).toBe(0);
    });
  });

  describe("location", () => {
    it("exists exactly once after the migration: main, Main, default", async () => {
      const result = await client.query('select code, name, is_default from "location"');
      expect(result.rows).toEqual([{ code: "main", name: "Main", is_default: true }]);
    });

    it("accepts a non-default location and applies the defaults", async () => {
      const created = await insert("location", { code: "warehouse_2", name: "Second" });
      expect(created).toMatchObject({ code: "warehouse_2", is_default: false });
      expect(created.created_at).toBeInstanceOf(Date);
    });

    it("rejects a second default and accepts any number of non-defaults", async () => {
      await expectViolation(
        () => insert("location", { code: "other", name: "Other", is_default: true }),
        UNIQUE_VIOLATION,
        "location_is_default_key",
      );
      await createLocation("a");
      await createLocation("b");
      expect(await count("location", "is_default")).toBe(1);
    });

    it("allows a new default after the old one is demoted", async () => {
      await client.query(`update "location" set is_default = false where code = 'main'`);
      await createLocation("new_default", { is_default: true });
      expect(await count("location", "is_default")).toBe(1);
    });

    it("rejects a duplicate code", async () => {
      await expectViolation(
        () => insert("location", { code: "main", name: "Again" }),
        UNIQUE_VIOLATION,
        "location_code_key",
      );
    });

    it("rejects codes that do not start with a letter, are upper case or too long, and accepts the limit", async () => {
      for (const code of ["1main", "_main", "Main", "main-2", "", "a".repeat(65)]) {
        await expectViolation(
          () => insert("location", { code, name: "x" }),
          CHECK_VIOLATION,
          "location_code_check",
        );
      }
      await expectAccepted(() => insert("location", { code: "a".repeat(64), name: "x" }));
      await expectAccepted(() => insert("location", { code: "a1_b", name: "x" }));
    });

    it("rejects an empty name", async () => {
      await expectViolation(
        () => insert("location", { code: "empty_name", name: "" }),
        CHECK_VIOLATION,
        "location_name_check",
      );
    });
  });

  describe("inventory_level", () => {
    it("accepts a level and applies the defaults", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      const created = await insert("inventory_level", {
        variant_id: variantId,
        location_id: locationId,
        on_hand: 7,
      });
      expect(created).toMatchObject({ on_hand: 7, reserved: 0 });
      expect(created.created_at).toBeInstanceOf(Date);
    });

    it("has one level per variant and location", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      const second = await createLocation("second");
      await insert("inventory_level", levelRow(variantId, locationId));
      await expectViolation(
        () => insert("inventory_level", levelRow(variantId, locationId)),
        UNIQUE_VIOLATION,
        "inventory_level_pkey",
      );
      await insert("inventory_level", levelRow(variantId, second));
      expect(await count("inventory_level")).toBe(2);
    });

    it("accepts on_hand 0 and the maximum, rejects -1 and the maximum plus one", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      await expectAccepted(() =>
        insert("inventory_level", levelRow(variantId, locationId, { on_hand: 0 })),
      );
      await expectAccepted(() =>
        insert("inventory_level", levelRow(variantId, locationId, { on_hand: MAX_ON_HAND })),
      );
      for (const onHand of [-1, MAX_ON_HAND + 1]) {
        await expectViolation(
          () => insert("inventory_level", levelRow(variantId, locationId, { on_hand: onHand })),
          CHECK_VIOLATION,
          "inventory_level_on_hand_check",
        );
      }
    });

    it("rejects negative reserved but allows reserved above on_hand (backorder)", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      await expectViolation(
        () => insert("inventory_level", levelRow(variantId, locationId, { reserved: -1 })),
        CHECK_VIOLATION,
        "inventory_level_reserved_check",
      );
      await expectAccepted(() =>
        insert("inventory_level", levelRow(variantId, locationId, { on_hand: 0, reserved: 3 })),
      );
    });

    it("rejects an unknown variant and an unknown location", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      const missing = "00000000-0000-4000-8000-000000000000";
      await expectViolation(
        () => insert("inventory_level", levelRow(missing, locationId)),
        FOREIGN_KEY_VIOLATION,
        "inventory_level_variant_id_fkey",
      );
      await expectViolation(
        () => insert("inventory_level", levelRow(variantId, missing)),
        FOREIGN_KEY_VIOLATION,
        "inventory_level_location_id_fkey",
      );
    });

    it("is deleted with its variant", async () => {
      const variantId = await createVariant();
      await insert("inventory_level", levelRow(variantId, await defaultLocationId()));
      await client.query('delete from "variant" where id = $1', [variantId]);
      expect(await count("inventory_level")).toBe(0);
    });

    it("restricts deleting a location that has a level", async () => {
      const variantId = await createVariant();
      const locationId = await createLocation("with_stock");
      await insert("inventory_level", levelRow(variantId, locationId));
      await expectViolation(
        () => client.query('delete from "location" where id = $1', [locationId]),
        FOREIGN_KEY_VIOLATION,
        "inventory_level_location_id_fkey",
      );
    });
  });

  describe("reservation", () => {
    it("accepts a reservation and applies the defaults", async () => {
      const variantId = await createVariant();
      const created = await insert(
        "reservation",
        reservationRow(variantId, await defaultLocationId()),
      );
      expect(created).toMatchObject({ quantity: 1, status: "active", reference: null });
      expect(created.expires_at).toBeInstanceOf(Date);
      expect(created.created_at).toBeInstanceOf(Date);
    });

    it("accepts quantity 1 and the maximum, rejects 0, -1 and the maximum plus one", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      for (const quantity of [1, MAX_QUANTITY]) {
        await expectAccepted(() =>
          insert("reservation", reservationRow(variantId, locationId, { quantity })),
        );
      }
      for (const quantity of [0, -1, MAX_QUANTITY + 1]) {
        await expectViolation(
          () => insert("reservation", reservationRow(variantId, locationId, { quantity })),
          CHECK_VIOLATION,
          "reservation_quantity_check",
        );
      }
    });

    it("accepts every status of the list and rejects others", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      for (const status of ["active", "committed", "released", "expired"]) {
        await insert("reservation", reservationRow(variantId, locationId, { status }));
      }
      for (const status of ["Active", "pending", ""]) {
        await expectViolation(
          () => insert("reservation", reservationRow(variantId, locationId, { status })),
          CHECK_VIOLATION,
          "reservation_status_check",
        );
      }
    });

    it("requires expires_at", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      await expectViolation(
        () => insert("reservation", reservationRow(variantId, locationId, { expires_at: null })),
        "23502",
        undefined,
      );
    });

    it("is deleted with its variant and restricts deleting its location", async () => {
      const variantId = await createVariant();
      const locationId = await createLocation("reserved_here");
      await insert("reservation", reservationRow(variantId, locationId));
      await expectViolation(
        () => client.query('delete from "location" where id = $1', [locationId]),
        FOREIGN_KEY_VIOLATION,
        "reservation_location_id_fkey",
      );
      await client.query('delete from "variant" where id = $1', [variantId]);
      expect(await count("reservation")).toBe(0);
    });

    it("rejects an unknown variant", async () => {
      await expectViolation(
        () =>
          insert(
            "reservation",
            reservationRow(
              "00000000-0000-4000-8000-000000000000",
              "00000000-0000-4000-8000-000000000001",
            ),
          ),
        FOREIGN_KEY_VIOLATION,
        "reservation_variant_id_fkey",
      );
    });
  });

  describe("stock_movement", () => {
    it("accepts a movement and applies the defaults", async () => {
      const variantId = await createVariant();
      const created = await insert(
        "stock_movement",
        movementRow(variantId, await defaultLocationId()),
      );
      expect(created).toMatchObject({
        delta: 5,
        kind: "receipt",
        on_hand_after: 5,
        reason: null,
        reference: null,
        actor_id: null,
      });
      expect(created.created_at).toBeInstanceOf(Date);
    });

    it("rejects delta 0, accepts negative and positive deltas", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      await expectViolation(
        () => insert("stock_movement", movementRow(variantId, locationId, { delta: 0 })),
        CHECK_VIOLATION,
        "stock_movement_delta_check",
      );
      await expectAccepted(() =>
        insert("stock_movement", movementRow(variantId, locationId, { delta: -3, kind: "sale" })),
      );
      await expectAccepted(() =>
        insert("stock_movement", movementRow(variantId, locationId, { delta: 1 })),
      );
    });

    it("accepts every kind of the list and rejects others", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      for (const kind of ["receipt", "adjustment", "sale", "return"]) {
        await insert("stock_movement", movementRow(variantId, locationId, { kind }));
      }
      for (const kind of ["Receipt", "transfer", ""]) {
        await expectViolation(
          () => insert("stock_movement", movementRow(variantId, locationId, { kind })),
          CHECK_VIOLATION,
          "stock_movement_kind_check",
        );
      }
    });

    it("accepts on_hand_after 0 and the maximum, rejects -1 and the maximum plus one", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      for (const onHandAfter of [0, MAX_ON_HAND]) {
        await expectAccepted(() =>
          insert(
            "stock_movement",
            movementRow(variantId, locationId, { on_hand_after: onHandAfter }),
          ),
        );
      }
      for (const onHandAfter of [-1, MAX_ON_HAND + 1]) {
        await expectViolation(
          () =>
            insert(
              "stock_movement",
              movementRow(variantId, locationId, { on_hand_after: onHandAfter }),
            ),
          CHECK_VIOLATION,
          "stock_movement_on_hand_after_check",
        );
      }
    });

    it("rejects an unknown variant, location and actor", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      const missing = "00000000-0000-4000-8000-000000000000";
      await expectViolation(
        () => insert("stock_movement", movementRow(missing, locationId)),
        FOREIGN_KEY_VIOLATION,
        "stock_movement_variant_id_fkey",
      );
      await expectViolation(
        () => insert("stock_movement", movementRow(variantId, missing)),
        FOREIGN_KEY_VIOLATION,
        "stock_movement_location_id_fkey",
      );
      await expectViolation(
        () => insert("stock_movement", movementRow(variantId, locationId, { actor_id: missing })),
        FOREIGN_KEY_VIOLATION,
        "stock_movement_actor_id_fkey",
      );
    });

    it("restricts deleting a location that has movements", async () => {
      const variantId = await createVariant();
      const locationId = await createLocation("journaled");
      await insert("stock_movement", movementRow(variantId, locationId));
      await expectViolation(
        () => client.query('delete from "location" where id = $1', [locationId]),
        FOREIGN_KEY_VIOLATION,
        "stock_movement_location_id_fkey",
      );
    });

    describe("append-only trigger", () => {
      it("rejects a direct UPDATE of any column", async () => {
        const variantId = await createVariant();
        const userId = await createUser();
        const movementId = await insertId(
          "stock_movement",
          movementRow(variantId, await defaultLocationId(), { actor_id: userId }),
        );
        for (const assignment of [
          "delta = 6",
          "reason = 'edited'",
          "on_hand_after = 99",
          "kind = 'sale'",
          "actor_id = NULL",
          "created_at = now()",
        ]) {
          await expectViolation(
            () =>
              client.query(`update "stock_movement" set ${assignment} where id = $1`, [movementId]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        const result = await client.query(
          'select delta, actor_id from "stock_movement" where id = $1',
          [movementId],
        );
        expect(result.rows[0]).toEqual({ delta: 5, actor_id: userId });
      });

      it("rejects a direct DELETE, also of every row at once", async () => {
        const variantId = await createVariant();
        const locationId = await defaultLocationId();
        const movementId = await insertId("stock_movement", movementRow(variantId, locationId));
        await expectViolation(
          () => client.query('delete from "stock_movement" where id = $1', [movementId]),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => client.query('delete from "stock_movement"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await count("stock_movement")).toBe(1);
      });

      it("allows the cascade from the variant: the journal goes with a deleted variant, other variants keep theirs", async () => {
        const variantId = await createVariant();
        const keptId = await createVariant();
        const locationId = await defaultLocationId();
        await insert("stock_movement", movementRow(variantId, locationId));
        await insert(
          "stock_movement",
          movementRow(variantId, locationId, { delta: -1, kind: "sale", on_hand_after: 4 }),
        );
        await insert("stock_movement", movementRow(keptId, locationId));

        await client.query('delete from "variant" where id = $1', [variantId]);

        expect(await count("stock_movement", `variant_id = '${variantId}'`)).toBe(0);
        expect(await count("stock_movement", `variant_id = '${keptId}'`)).toBe(1);
      });

      it("allows the cascade when the whole product is deleted", async () => {
        const variantId = await createVariant();
        await insert("stock_movement", movementRow(variantId, await defaultLocationId()));
        await client.query(
          'delete from "product" where id = (select product_id from "variant" where id = $1)',
          [variantId],
        );
        expect(await count("stock_movement")).toBe(0);
      });

      it("allows SET NULL of actor_id when the admin user is deleted, and nothing else changes", async () => {
        const variantId = await createVariant();
        const userId = await createUser();
        const locationId = await defaultLocationId();
        const movementId = await insertId(
          "stock_movement",
          movementRow(variantId, locationId, {
            actor_id: userId,
            reason: "recount",
            reference: "ref-1",
          }),
        );
        const before = await client.query('select * from "stock_movement" where id = $1', [
          movementId,
        ]);

        await client.query('delete from "admin_user" where id = $1', [userId]);

        const after = await client.query('select * from "stock_movement" where id = $1', [
          movementId,
        ]);
        expect(after.rows[0]).toEqual({ ...before.rows[0], actor_id: null });
      });

      describe("changes at trigger depth above 1 (what only a referential action may do)", () => {
        /**
         * A helper function and a trigger on a temporary table, created inside the test transaction (the rollback
         * of `afterEach` drops them): inserting into the probe table runs `assignments` as an UPDATE of the movement
         * from a trigger body, so the append-only trigger sees `pg_trigger_depth()` of 2, like a foreign key action.
         */
        async function updateAtDepthTwo(movementId: string, assignments: string): Promise<void> {
          await client.query(
            `create function pg_temp.tamper_with_movement() returns trigger language plpgsql as $$
             begin
               update "stock_movement" set ${assignments} where id = '${movementId}';
               return new;
             end;
             $$`,
          );
          await client.query("create temp table tamper_probe (id int)");
          await client.query(
            `create trigger tamper_probe_insert after insert on tamper_probe
               for each row execute function pg_temp.tamper_with_movement()`,
          );
          await client.query("insert into tamper_probe (id) values (1)");
        }

        it("rejects an UPDATE that nulls actor_id and changes another column (R4)", async () => {
          const variantId = await createVariant();
          const userId = await createUser();
          const movementId = await insertId(
            "stock_movement",
            movementRow(variantId, await defaultLocationId(), { actor_id: userId, delta: 5 }),
          );
          await expectViolation(
            () => updateAtDepthTwo(movementId, "actor_id = NULL, delta = 6"),
            RESTRICT_VIOLATION,
            undefined,
          );
          await expectViolation(
            () => updateAtDepthTwo(movementId, "actor_id = NULL, reason = 'edited'"),
            RESTRICT_VIOLATION,
            undefined,
          );
          const result = await client.query(
            'select delta, reason, actor_id from "stock_movement" where id = $1',
            [movementId],
          );
          expect(result.rows[0]).toEqual({ delta: 5, reason: null, actor_id: userId });
        });

        it("accepts an UPDATE that only nulls actor_id", async () => {
          const variantId = await createVariant();
          const userId = await createUser();
          const movementId = await insertId(
            "stock_movement",
            movementRow(variantId, await defaultLocationId(), { actor_id: userId }),
          );
          await updateAtDepthTwo(movementId, "actor_id = NULL");
          const result = await client.query(
            'select delta, actor_id from "stock_movement" where id = $1',
            [movementId],
          );
          expect(result.rows[0]).toEqual({ delta: 5, actor_id: null });
        });

        it("rejects an UPDATE of another column alone and one that sets actor_id to a value", async () => {
          const variantId = await createVariant();
          const userId = await createUser();
          const movementId = await insertId(
            "stock_movement",
            movementRow(variantId, await defaultLocationId()),
          );
          await expectViolation(
            () => updateAtDepthTwo(movementId, "reason = 'edited'"),
            RESTRICT_VIOLATION,
            undefined,
          );
          await expectViolation(
            () => updateAtDepthTwo(movementId, `actor_id = '${userId}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
        });
      });

      it("still rejects a direct UPDATE that sets actor_id to a value", async () => {
        const variantId = await createVariant();
        const userId = await createUser();
        const movementId = await insertId(
          "stock_movement",
          movementRow(variantId, await defaultLocationId()),
        );
        await expectViolation(
          () =>
            client.query('update "stock_movement" set actor_id = $1 where id = $2', [
              userId,
              movementId,
            ]),
          RESTRICT_VIOLATION,
          undefined,
        );
      });
    });

    it("lists a variant's movements newest first from the index", async () => {
      const variantId = await createVariant();
      const locationId = await defaultLocationId();
      await insert(
        "stock_movement",
        movementRow(variantId, locationId, { reason: "first", created_at: "2030-01-01T00:00:00Z" }),
      );
      await insert(
        "stock_movement",
        movementRow(variantId, locationId, {
          reason: "second",
          created_at: "2030-01-02T00:00:00Z",
        }),
      );
      const result = await client.query(
        'select reason from "stock_movement" where variant_id = $1 order by created_at desc, id desc',
        [variantId],
      );
      expect(result.rows.map((row: { reason: string }) => row.reason)).toEqual(["second", "first"]);
    });
  });

  describe("drizzle schema", () => {
    it("keeps every constraint, index and table name within 63 characters", () => {
      const tables: PgTable[] = [
        pricingInventorySchema.price,
        pricingInventorySchema.location,
        pricingInventorySchema.inventoryLevel,
        pricingInventorySchema.stockMovement,
        pricingInventorySchema.reservation,
        catalogSchema.variant,
      ];
      for (const table of tables) {
        const config = getTableConfig(table);
        const names = [
          config.name,
          ...config.checks.map((item) => item.name),
          ...config.indexes.map((item) => item.config.name ?? ""),
          ...config.uniqueConstraints.map((item) => item.name ?? ""),
          ...config.foreignKeys.map((item) => item.getName()),
          ...config.primaryKeys.map((item) => item.getName() ?? ""),
        ];
        for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
      }
    });
  });
});
