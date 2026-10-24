import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CONTACT_LIMITS,
  EMAIL_MAX_LENGTH,
  MAX_AMOUNT,
  MAX_LINE_QUANTITY,
  ORDER_ACTORS,
  ORDER_NUMBER_ALPHABET,
  ORDER_NUMBER_PATTERN,
  ORDER_STATUSES,
  TEXT_LIMITS,
  normalizeEmail,
  normalizePhone,
} from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import * as cartsSchema from "./schema/carts.js";
import * as customersSchema from "./schema/customers.js";
import * as domainEventsSchema from "./schema/domain-events.js";
import * as ordersSchema from "./schema/orders.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Same value in every spec that needs the migrated schema: they run in parallel workers on one database. */
const SCHEMA_LOCK_KEY = 7_426_001;

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
const RESTRICT_VIOLATION = "23001";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("cart, customers and orders schema (real Postgres)", () => {
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
    for (const name of [
      "shipment_status_change_append_only",
      "order_shipping_immutable",
      "order_status_change_append_only",
      "order_adjustment_append_only",
      "order_item_immutable",
      "stock_movement_append_only",
    ]) {
      await pool.query(`drop function if exists "${name}"()`);
    }
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

  async function selectRow(table: string, id: string): Promise<Record<string, unknown>> {
    const result = await client.query(`select * from "${table}" where id = $1`, [id]);
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} row ${id}`);
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

  /** Every value of `accept` is stored, every value of `reject` violates `constraint`. */
  async function expectBoundaries(
    make: (value: Value) => Promise<unknown>,
    constraint: string,
    accept: Value[],
    reject: Value[],
  ): Promise<void> {
    for (const value of accept) await expectAccepted(() => make(value));
    for (const value of reject) {
      await expectViolation(() => make(value), CHECK_VIOLATION, constraint);
    }
  }

  let sequence = 0;
  const i18n = (value: string) => JSON.stringify({ uk: value });

  /** A valid, unique order number: the sequence written in base 32 with the Crockford alphabet. */
  function nextOrderNumber(): string {
    sequence += 1;
    let rest = sequence;
    let symbols = "";
    for (let position = 0; position < 8; position += 1) {
      symbols = `${ORDER_NUMBER_ALPHABET.charAt(rest % 32)}${symbols}`;
      rest = Math.floor(rest / 32);
    }
    return `${symbols.slice(0, 4)}-${symbols.slice(4)}`;
  }

  async function createProductAndVariant(
    variantExtra: Row = {},
  ): Promise<{ productId: string; variantId: string }> {
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
    const variantId = await insertId("variant", {
      product_id: productId,
      sku: `SKU-${sequence}`,
      option_signature: "",
      ...variantExtra,
    });
    return { productId, variantId };
  }

  async function defaultLocationId(): Promise<string> {
    const result = await client.query(`select id from "location" where code = 'main'`);
    return must((result.rows[0] as { id: string } | undefined)?.id, "main location");
  }

  async function createAdmin(email = "owner@example.com"): Promise<string> {
    return insertId("admin_user", {
      email,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      role: "owner",
    });
  }

  const customerRow = (extra: Row = {}): Row => {
    sequence += 1;
    return {
      email: `customer-${sequence}@example.com`,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      first_name: "Ann",
      last_name: "Buyer",
      ...extra,
    };
  };
  const createCustomer = (extra: Row = {}) => insertId("customer", customerRow(extra));

  const guestOrderRow = (extra: Row = {}): Row => ({
    number: nextOrderNumber(),
    status: "awaiting_payment",
    email: "buyer@example.com",
    phone: "+380501234567",
    first_name: "Ann",
    last_name: "Buyer",
    locale: "uk",
    currency: "UAH",
    subtotal_amount: 2000,
    shipping_total: 0,
    discount_total: 0,
    tax_total: 0,
    total_amount: 2000,
    access_token_hash: randomUUID().replaceAll("-", "").repeat(2),
    access_expires_at: "2099-01-01T00:00:00Z",
    idempotency_key: randomUUID(),
    request_fingerprint: HASH_A,
    expires_at: "2099-01-01T00:00:00Z",
    ...extra,
  });
  const customerOrderRow = (customerId: string, extra: Row = {}): Row =>
    guestOrderRow({
      customer_id: customerId,
      access_token_hash: null,
      access_expires_at: null,
      ...extra,
    });
  const createOrder = (extra: Row = {}) => insertId("sales_order", guestOrderRow(extra));

  const itemRow = (orderId: string, extra: Row = {}): Row => {
    sequence += 1;
    return {
      order_id: orderId,
      position: sequence,
      sku: "SKU-1",
      product_title: i18n("Product"),
      option_values: "[]",
      unit_amount: 1000,
      quantity: 2,
      line_total: 2000,
      currency: "UAH",
      requires_shipping: true,
      ...extra,
    };
  };
  const createItem = (orderId: string, extra: Row = {}) =>
    insertId("order_item", itemRow(orderId, extra));

  const adjustmentRow = (orderId: string, extra: Row = {}): Row => ({
    order_id: orderId,
    kind: "shipping",
    code: "flat",
    label: i18n("Shipping"),
    amount: 500,
    included_in_price: false,
    ...extra,
  });

  const changeRow = (orderId: string, extra: Row = {}): Row => ({
    order_id: orderId,
    from_status: null,
    to_status: "awaiting_payment",
    actor_type: "guest",
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

  /** The string literals of a CHECK, sorted: to compare a database list with the list in packages/core. */
  async function constraintLiterals(table: string, constraint: string): Promise<string[]> {
    const result = await client.query(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = $1::regclass and conname = $2`,
      [`public.${table}`, constraint],
    );
    const definition = must(
      (result.rows[0] as { definition: string } | undefined)?.definition,
      `${constraint} definition`,
    );
    return [...definition.matchAll(/'([^']+)'/g)].map((match) => must(match[1], "literal")).sort();
  }

  let probeSequence = 0;
  /**
   * Runs `statement` (an UPDATE or DELETE of one row) from the body of a trigger on a temporary table, created inside the
   * test transaction (its rollback drops it): the probe insert makes the trigger under test see `pg_trigger_depth()` of 2,
   * like a foreign key action does (the technique of pricing-inventory-schema.spec.ts).
   */
  async function runAtDepthTwo(statement: string): Promise<void> {
    probeSequence += 1;
    await client.query(
      `create function pg_temp.tamper_${probeSequence}() returns trigger language plpgsql as $$
       begin
         ${statement};
         return new;
       end;
       $$`,
    );
    await client.query(`create temp table tamper_probe_${probeSequence} (id int)`);
    await client.query(
      `create trigger tamper_probe_${probeSequence}_insert after insert on tamper_probe_${probeSequence}
         for each row execute function pg_temp.tamper_${probeSequence}()`,
    );
    await client.query(`insert into tamper_probe_${probeSequence} (id) values (1)`);
  }
  const updateAtDepthTwo = (table: string, id: string, assignments: string) =>
    runAtDepthTwo(`update "${table}" set ${assignments} where id = '${id}'`);
  const deleteAtDepthTwo = (table: string, id: string) =>
    runAtDepthTwo(`delete from "${table}" where id = '${id}'`);

  describe("customer", () => {
    it("accepts a customer and applies the defaults", async () => {
      const created = await insert("customer", customerRow());
      expect(created).toMatchObject({
        is_active: true,
        email_verified_at: null,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        phone: null,
      });
      expect(created.password_changed_at).toBeInstanceOf(Date);
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("rejects an email that is not normalized (upper case, outer spaces) or out of the length range", async () => {
      const make = (email: Value) => insert("customer", customerRow({ email }));
      await expectBoundaries(
        make,
        "customer_email_check",
        ["a@b", `${"a".repeat(EMAIL_MAX_LENGTH - "@example.com".length)}@example.com`],
        [
          "Buyer@example.com",
          " buyer@example.com",
          "buyer@example.com ",
          "ab",
          "",
          `${"a".repeat(EMAIL_MAX_LENGTH - "@example.com".length + 1)}@example.com`,
        ],
      );
    });

    it("stores what normalizeEmail returns", async () => {
      const email = normalizeEmail("  Buyer.Name@Example.COM ");
      await expectAccepted(() => insert("customer", customerRow({ email })));
    });

    it("keeps emails unique", async () => {
      await insert("customer", customerRow({ email: "same@example.com" }));
      await expectViolation(
        () => insert("customer", customerRow({ email: "same@example.com" })),
        UNIQUE_VIOLATION,
        "customer_email_key",
      );
    });

    it("accepts 1 and the limit of name characters, rejects 0 and one more", async () => {
      for (const [column, constraint] of [
        ["first_name", "customer_first_name_check"],
        ["last_name", "customer_last_name_check"],
      ] as const) {
        await expectBoundaries(
          (value) => insert("customer", customerRow({ [column]: value })),
          constraint,
          ["x", "x".repeat(CONTACT_LIMITS.name), "я".repeat(CONTACT_LIMITS.name)],
          ["", "x".repeat(CONTACT_LIMITS.name + 1)],
        );
      }
    });

    it("accepts a normalized phone or none, rejects anything else", async () => {
      const digits = (length: number) => "1".repeat(length);
      await expectBoundaries(
        (value) => insert("customer", customerRow({ phone: value })),
        "customer_phone_check",
        [
          null,
          digits(CONTACT_LIMITS.phoneMinDigits),
          `+${digits(CONTACT_LIMITS.phoneMaxDigits)}`,
          "+380501234567",
        ],
        [
          digits(CONTACT_LIMITS.phoneMinDigits - 1),
          digits(CONTACT_LIMITS.phoneMaxDigits + 1),
          `+${digits(CONTACT_LIMITS.phoneMaxDigits + 1)}`,
          "++380501234567",
          "380 50 123 45 67",
          "+38050123456a",
          "",
        ],
      );
    });

    it("stores what normalizePhone returns", async () => {
      const result = normalizePhone("+38 (050) 123-45-67");
      if (!result.ok) throw new Error("Test setup bug: the phone is valid");
      await expectAccepted(() => insert("customer", customerRow({ phone: result.phone })));
    });

    it("rejects an empty password hash and a negative failed login count", async () => {
      await expectViolation(
        () => insert("customer", customerRow({ password_hash: "" })),
        CHECK_VIOLATION,
        "customer_password_hash_check",
      );
      await expectViolation(
        () => insert("customer", customerRow({ failed_login_count: -1 })),
        CHECK_VIOLATION,
        "customer_failed_login_count_check",
      );
      await expectAccepted(() => insert("customer", customerRow({ failed_login_count: 0 })));
    });
  });

  describe("customer_session", () => {
    const sessionRow = (customerId: string, extra: Row = {}): Row => ({
      customer_id: customerId,
      token_hash: HASH_A,
      expires_at: "2099-01-01T00:00:00Z",
      ...extra,
    });

    it("accepts a session and applies the defaults", async () => {
      const customerId = await createCustomer();
      const created = await insert("customer_session", sessionRow(customerId));
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.last_seen_at).toBeInstanceOf(Date);
    });

    it("accepts only a SHA-256 hex token hash", async () => {
      const customerId = await createCustomer();
      await expectBoundaries(
        (value) => insert("customer_session", sessionRow(customerId, { token_hash: value })),
        "customer_session_token_hash_check",
        ["0123456789abcdef".repeat(4)],
        ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), ""],
      );
    });

    it("keeps token hashes unique", async () => {
      const customerId = await createCustomer();
      await insert("customer_session", sessionRow(customerId));
      await expectViolation(
        () => insert("customer_session", sessionRow(customerId)),
        UNIQUE_VIOLATION,
        "customer_session_token_hash_key",
      );
      await insert("customer_session", sessionRow(customerId, { token_hash: HASH_B }));
    });

    it("rejects an expiry that is not after the creation", async () => {
      const customerId = await createCustomer();
      await expectViolation(
        () =>
          insert(
            "customer_session",
            sessionRow(customerId, {
              created_at: "2030-01-01T00:00:00Z",
              expires_at: "2030-01-01T00:00:00Z",
            }),
          ),
        CHECK_VIOLATION,
        "customer_session_expires_at_check",
      );
    });

    it("rejects an unknown customer and is deleted with its customer", async () => {
      await expectViolation(
        () => insert("customer_session", sessionRow(MISSING_ID)),
        FOREIGN_KEY_VIOLATION,
        "customer_session_customer_id_fkey",
      );
      const customerId = await createCustomer();
      await insert("customer_session", sessionRow(customerId));
      await client.query('delete from "customer" where id = $1', [customerId]);
      expect(await count("customer_session")).toBe(0);
    });
  });

  describe("cart", () => {
    const guestCart = (extra: Row = {}): Row => ({
      token_hash: HASH_A,
      expires_at: "2099-01-01T00:00:00Z",
      ...extra,
    });

    it("accepts a guest cart and a customer cart and applies the defaults", async () => {
      const guest = await insert("cart", guestCart());
      expect(guest).toMatchObject({ customer_id: null, token_hash: HASH_A });
      expect(guest.created_at).toBeInstanceOf(Date);
      expect(guest.updated_at).toBeInstanceOf(Date);
      const customerId = await createCustomer();
      const owned = await insert("cart", {
        customer_id: customerId,
        expires_at: "2099-01-01T00:00:00Z",
      });
      expect(owned).toMatchObject({ customer_id: customerId, token_hash: null });
    });

    it("needs exactly one owner: rejects no owner and both owners", async () => {
      const customerId = await createCustomer();
      await expectViolation(
        () => insert("cart", { expires_at: "2099-01-01T00:00:00Z" }),
        CHECK_VIOLATION,
        "cart_owner_check",
      );
      await expectViolation(
        () => insert("cart", guestCart({ customer_id: customerId })),
        CHECK_VIOLATION,
        "cart_owner_check",
      );
    });

    it("accepts only a SHA-256 hex token hash", async () => {
      await expectBoundaries(
        (value) => insert("cart", guestCart({ token_hash: value })),
        "cart_token_hash_check",
        ["0123456789abcdef".repeat(4)],
        ["A".repeat(64), "a".repeat(63), "a".repeat(65), ""],
      );
    });

    it("keeps token hashes unique and allows one cart per customer", async () => {
      await insert("cart", guestCart());
      await expectViolation(
        () => insert("cart", guestCart()),
        UNIQUE_VIOLATION,
        "cart_token_hash_key",
      );
      await insert("cart", guestCart({ token_hash: HASH_B }));
      const customerId = await createCustomer();
      const customerCart = { customer_id: customerId, expires_at: "2099-01-01T00:00:00Z" };
      await insert("cart", customerCart);
      await expectViolation(
        () => insert("cart", customerCart),
        UNIQUE_VIOLATION,
        "cart_customer_id_key",
      );
    });

    it("rejects an expiry that is not after the creation", async () => {
      await expectViolation(
        () =>
          insert(
            "cart",
            guestCart({ created_at: "2030-01-01T00:00:00Z", expires_at: "2030-01-01T00:00:00Z" }),
          ),
        CHECK_VIOLATION,
        "cart_expires_at_check",
      );
    });

    it("rejects an unknown customer", async () => {
      await expectViolation(
        () => insert("cart", { customer_id: MISSING_ID, expires_at: "2099-01-01T00:00:00Z" }),
        FOREIGN_KEY_VIOLATION,
        "cart_customer_id_fkey",
      );
    });
  });

  describe("cart_item", () => {
    const cartItemRow = (cartId: string, variantId: string, extra: Row = {}): Row => ({
      cart_id: cartId,
      variant_id: variantId,
      quantity: 1,
      ...extra,
    });
    const createCart = () =>
      insertId("cart", { token_hash: HASH_A, expires_at: "2099-01-01T00:00:00Z" });

    it("accepts a line and applies the defaults", async () => {
      const { variantId } = await createProductAndVariant();
      const created = await insert("cart_item", cartItemRow(await createCart(), variantId));
      expect(created).toMatchObject({ quantity: 1, seen_unit_amount: null, seen_currency: null });
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
    });

    it("accepts quantity 1 and the maximum, rejects 0, -1 and the maximum plus one", async () => {
      const { variantId } = await createProductAndVariant();
      const cartId = await createCart();
      await expectBoundaries(
        (value) => insert("cart_item", cartItemRow(cartId, variantId, { quantity: value })),
        "cart_item_quantity_check",
        [1, MAX_LINE_QUANTITY],
        [0, -1, MAX_LINE_QUANTITY + 1],
      );
    });

    it("accepts a seen price of 0 and the maximum, rejects -1 and the maximum plus one", async () => {
      const { variantId } = await createProductAndVariant();
      const cartId = await createCart();
      await expectBoundaries(
        (value) =>
          insert(
            "cart_item",
            cartItemRow(cartId, variantId, { seen_unit_amount: value, seen_currency: "UAH" }),
          ),
        "cart_item_seen_unit_amount_check",
        [0, MAX_AMOUNT],
        [-1, MAX_AMOUNT + 1],
      );
    });

    it("rejects a seen currency that is not three capital letters", async () => {
      const { variantId } = await createProductAndVariant();
      const cartId = await createCart();
      await expectBoundaries(
        (value) =>
          insert(
            "cart_item",
            cartItemRow(cartId, variantId, { seen_unit_amount: 1, seen_currency: value }),
          ),
        "cart_item_seen_currency_check",
        ["UAH"],
        ["uah", "UA", "UAHH", "U1H", ""],
      );
    });

    it("takes the seen amount and currency together or not at all", async () => {
      const { variantId } = await createProductAndVariant();
      const cartId = await createCart();
      await expectViolation(
        () => insert("cart_item", cartItemRow(cartId, variantId, { seen_unit_amount: 100 })),
        CHECK_VIOLATION,
        "cart_item_seen_price_check",
      );
      await expectViolation(
        () => insert("cart_item", cartItemRow(cartId, variantId, { seen_currency: "UAH" })),
        CHECK_VIOLATION,
        "cart_item_seen_price_check",
      );
      await expectAccepted(() =>
        insert(
          "cart_item",
          cartItemRow(cartId, variantId, { seen_unit_amount: 100, seen_currency: "UAH" }),
        ),
      );
    });

    it("has one line per cart and variant", async () => {
      const { variantId } = await createProductAndVariant();
      const other = await createProductAndVariant();
      const cartId = await createCart();
      await insert("cart_item", cartItemRow(cartId, variantId));
      await expectViolation(
        () => insert("cart_item", cartItemRow(cartId, variantId)),
        UNIQUE_VIOLATION,
        "cart_item_cart_id_variant_id_key",
      );
      await insert("cart_item", cartItemRow(cartId, other.variantId));
      const secondCart = await insertId("cart", {
        token_hash: HASH_B,
        expires_at: "2099-01-01T00:00:00Z",
      });
      await insert("cart_item", cartItemRow(secondCart, variantId));
    });

    it("rejects an unknown cart and an unknown variant", async () => {
      const { variantId } = await createProductAndVariant();
      const cartId = await createCart();
      await expectViolation(
        () => insert("cart_item", cartItemRow(MISSING_ID, variantId)),
        FOREIGN_KEY_VIOLATION,
        "cart_item_cart_id_fkey",
      );
      await expectViolation(
        () => insert("cart_item", cartItemRow(cartId, MISSING_ID)),
        FOREIGN_KEY_VIOLATION,
        "cart_item_variant_id_fkey",
      );
    });

    it("is deleted with its cart and with its variant, and the cart stays", async () => {
      const first = await createProductAndVariant();
      const second = await createProductAndVariant();
      const cartId = await createCart();
      await insert("cart_item", cartItemRow(cartId, first.variantId));
      await insert("cart_item", cartItemRow(cartId, second.variantId));

      await client.query('delete from "variant" where id = $1', [first.variantId]);
      expect(await count("cart_item")).toBe(1);
      expect(await count("cart")).toBe(1);

      await client.query('delete from "cart" where id = $1', [cartId]);
      expect(await count("cart_item")).toBe(0);
    });

    it("leaves the cart when its product is deleted", async () => {
      const { productId, variantId } = await createProductAndVariant();
      await insert("cart_item", cartItemRow(await createCart(), variantId));
      await client.query('delete from "product" where id = $1', [productId]);
      expect(await count("cart_item")).toBe(0);
    });
  });

  describe("sales_order", () => {
    it("accepts an order and applies the defaults", async () => {
      const created = await insert("sales_order", guestOrderRow());
      expect(created).toMatchObject({
        status: "awaiting_payment",
        customer_id: null,
        shipping_address: null,
        billing_address: null,
        paid_at: null,
        fulfilled_at: null,
        cancelled_at: null,
        expired_at: null,
        cancellation_reason: null,
        payment_reference: null,
      });
      expect(created.placed_at).toBeInstanceOf(Date);
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
      expect(created.subtotal_amount).toBe("2000");
    });

    it("accepts the 32 symbols of the order number alphabet and the stored pattern of core", async () => {
      expect(ORDER_NUMBER_ALPHABET).toHaveLength(32);
      for (const symbol of ORDER_NUMBER_ALPHABET) {
        const number = `${symbol}${symbol}${symbol}${symbol}-${symbol}${symbol}${symbol}${symbol}`;
        expect(ORDER_NUMBER_PATTERN.test(number)).toBe(true);
        await expectAccepted(() => insert("sales_order", guestOrderRow({ number })));
      }
    });

    it("rejects a malformed order number (look-alikes I L O U, lower case, wrong shape)", async () => {
      for (const number of [
        "ILOU-ILOU",
        "I000-0000",
        "L000-0000",
        "O000-0000",
        "U000-0000",
        "0000-000I",
        "abcd-efgh",
        "0000-0000-",
        "00000000",
        "000-00000",
        "0000_0000",
        "0000-000",
        "0000-00000",
        " 0000-0000",
        "",
      ]) {
        expect(ORDER_NUMBER_PATTERN.test(number), `core agrees on ${number}`).toBe(false);
        await expectViolation(
          () => insert("sales_order", guestOrderRow({ number })),
          CHECK_VIOLATION,
          "sales_order_number_check",
        );
      }
    });

    it("accepts every status of core and rejects others; the list equals ORDER_STATUSES", async () => {
      for (const status of ORDER_STATUSES) {
        await expectAccepted(() => insert("sales_order", guestOrderRow({ status })));
      }
      for (const status of ["Paid", "pending", "refunded", ""]) {
        await expectViolation(
          () => insert("sales_order", guestOrderRow({ status })),
          CHECK_VIOLATION,
          "sales_order_status_check",
        );
      }
      expect(await constraintLiterals("sales_order", "sales_order_status_check")).toEqual(
        [...ORDER_STATUSES].sort(),
      );
    });

    it("rejects an email that is not normalized or out of the length range", async () => {
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ email: value })),
        "sales_order_email_check",
        ["a@b", `${"a".repeat(EMAIL_MAX_LENGTH - "@example.com".length)}@example.com`],
        [
          "Buyer@example.com",
          " buyer@example.com",
          "buyer@example.com ",
          "ab",
          "",
          `${"a".repeat(EMAIL_MAX_LENGTH - "@example.com".length + 1)}@example.com`,
        ],
      );
    });

    it("requires a phone in the normalized form", async () => {
      const digits = (length: number) => "1".repeat(length);
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ phone: value })),
        "sales_order_phone_check",
        [digits(CONTACT_LIMITS.phoneMinDigits), `+${digits(CONTACT_LIMITS.phoneMaxDigits)}`],
        [
          digits(CONTACT_LIMITS.phoneMinDigits - 1),
          `+${digits(CONTACT_LIMITS.phoneMaxDigits + 1)}`,
          "+38 050 123 45 67",
          "",
        ],
      );
      await expectViolation(
        () => insert("sales_order", guestOrderRow({ phone: null })),
        NOT_NULL_VIOLATION,
        undefined,
      );
    });

    it("accepts 1 and the limit of name characters, rejects 0 and one more", async () => {
      for (const [column, constraint] of [
        ["first_name", "sales_order_first_name_check"],
        ["last_name", "sales_order_last_name_check"],
      ] as const) {
        await expectBoundaries(
          (value) => insert("sales_order", guestOrderRow({ [column]: value })),
          constraint,
          ["x", "x".repeat(CONTACT_LIMITS.name)],
          ["", "x".repeat(CONTACT_LIMITS.name + 1)],
        );
      }
    });

    it("accepts a JSON object or null as an address, rejects other JSON", async () => {
      for (const [column, constraint] of [
        ["shipping_address", "sales_order_shipping_address_check"],
        ["billing_address", "sales_order_billing_address_check"],
      ] as const) {
        await expectBoundaries(
          (value) => insert("sales_order", guestOrderRow({ [column]: value })),
          constraint,
          [null, JSON.stringify({ countryCode: "UA", city: "Kyiv", line1: "Main street 1" })],
          [JSON.stringify([]), JSON.stringify("text"), JSON.stringify(1)],
        );
      }
    });

    it("accepts a locale code and rejects others", async () => {
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ locale: value })),
        "sales_order_locale_check",
        ["uk", "en", "en-us"],
        ["UK", "u", "uk_UA", "uk-", "", "uk "],
      );
    });

    it("accepts a currency of three capital letters", async () => {
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ currency: value })),
        "sales_order_currency_check",
        ["UAH", "USD"],
        ["uah", "UA", "UAHH", "U1H", "", "ГРН"],
      );
    });

    it("accepts 0 and the maximum of each non-negative total, rejects -1 and the maximum plus one", async () => {
      for (const [column, constraint] of [
        ["subtotal_amount", "sales_order_subtotal_amount_check"],
        ["shipping_total", "sales_order_shipping_total_check"],
        ["tax_total", "sales_order_tax_total_check"],
        ["total_amount", "sales_order_total_amount_check"],
      ] as const) {
        await expectBoundaries(
          (value) => insert("sales_order", guestOrderRow({ [column]: value })),
          constraint,
          [0, MAX_AMOUNT],
          [-1, MAX_AMOUNT + 1],
        );
      }
    });

    it("accepts a discount of 0 or less down to minus the maximum, rejects a positive one", async () => {
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ discount_total: value })),
        "sales_order_discount_total_check",
        [0, -1, -MAX_AMOUNT],
        [1, MAX_AMOUNT, -MAX_AMOUNT - 1],
      );
    });

    it("keeps order numbers, access token hashes and idempotency keys unique", async () => {
      const first = guestOrderRow({ access_token_hash: HASH_A });
      await insert("sales_order", first);
      await expectViolation(
        () =>
          insert(
            "sales_order",
            guestOrderRow({ number: must(first.number, "number"), access_token_hash: HASH_B }),
          ),
        UNIQUE_VIOLATION,
        "sales_order_number_key",
      );
      await expectViolation(
        () => insert("sales_order", guestOrderRow({ access_token_hash: HASH_A })),
        UNIQUE_VIOLATION,
        "sales_order_access_token_hash_key",
      );
      await expectViolation(
        () =>
          insert(
            "sales_order",
            guestOrderRow({
              access_token_hash: HASH_B,
              idempotency_key: must(first.idempotency_key, "key"),
            }),
          ),
        UNIQUE_VIOLATION,
        "sales_order_idempotency_key_key",
      );
    });

    it("allows any number of orders without an access token", async () => {
      const customerId = await createCustomer();
      await insert("sales_order", customerOrderRow(customerId));
      await insert("sales_order", customerOrderRow(customerId));
      expect(await count("sales_order", "access_token_hash is null")).toBe(2);
    });

    it("requires an idempotency key and a SHA-256 hex fingerprint", async () => {
      await expectViolation(
        () => insert("sales_order", guestOrderRow({ idempotency_key: null })),
        NOT_NULL_VIOLATION,
        undefined,
      );
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ request_fingerprint: value })),
        "sales_order_request_fingerprint_check",
        [HASH_B],
        ["A".repeat(64), "a".repeat(63), "a".repeat(65), ""],
      );
    });

    it("accepts only a SHA-256 hex access token hash", async () => {
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ access_token_hash: value })),
        "sales_order_access_token_hash_check",
        [HASH_B],
        ["A".repeat(64), "a".repeat(63), ""],
      );
    });

    it("takes the access token and its expiry together or not at all", async () => {
      await expectViolation(
        () => insert("sales_order", guestOrderRow({ access_expires_at: null })),
        CHECK_VIOLATION,
        "sales_order_access_pair_check",
      );
      await expectViolation(
        () => insert("sales_order", guestOrderRow({ access_token_hash: null })),
        CHECK_VIOLATION,
        "sales_order_access_pair_check",
      );
    });

    it("gives an order of a customer no access token, also by a later UPDATE", async () => {
      const customerId = await createCustomer();
      await expectViolation(
        () => insert("sales_order", guestOrderRow({ customer_id: customerId })),
        CHECK_VIOLATION,
        "sales_order_customer_or_token_check",
      );
      const guestOrderId = await createOrder();
      await expectViolation(
        () =>
          client.query('update "sales_order" set customer_id = $1 where id = $2', [
            customerId,
            guestOrderId,
          ]),
        CHECK_VIOLATION,
        "sales_order_customer_or_token_check",
      );
      const customerOrderId = await insertId("sales_order", customerOrderRow(customerId));
      await expectViolation(
        () =>
          client.query(
            `update "sales_order" set access_token_hash = $1, access_expires_at = now() + interval '1 day' where id = $2`,
            [HASH_B, customerOrderId],
          ),
        CHECK_VIOLATION,
        "sales_order_customer_or_token_check",
      );
    });

    it("rejects an expiry that is not after the placement", async () => {
      await expectViolation(
        () =>
          insert(
            "sales_order",
            guestOrderRow({
              placed_at: "2030-01-01T00:00:00Z",
              expires_at: "2030-01-01T00:00:00Z",
            }),
          ),
        CHECK_VIOLATION,
        "sales_order_expires_at_check",
      );
    });

    it("limits the cancellation reason and the payment reference", async () => {
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ cancellation_reason: value })),
        "sales_order_cancellation_reason_check",
        [null, "x", "x".repeat(500)],
        ["", "x".repeat(501)],
      );
      await expectBoundaries(
        (value) => insert("sales_order", guestOrderRow({ payment_reference: value })),
        "sales_order_payment_reference_check",
        [null, "x", "x".repeat(255)],
        ["", "x".repeat(256)],
      );
    });

    it("rejects an unknown customer", async () => {
      await expectViolation(
        () => insert("sales_order", customerOrderRow(MISSING_ID)),
        FOREIGN_KEY_VIOLATION,
        "sales_order_customer_id_fkey",
      );
    });

    describe("when the customer is deleted", () => {
      it("sets customer_id to NULL, keeps the contact data and the order without any token, and removes sessions and the cart", async () => {
        const customerId = await createCustomer({ email: "gone@example.com" });
        const orderId = await insertId(
          "sales_order",
          customerOrderRow(customerId, {
            email: "gone@example.com",
            phone: "+380671112233",
            first_name: "Olena",
            last_name: "Shevchenko",
            shipping_address: JSON.stringify({ countryCode: "UA", city: "Lviv", line1: "x" }),
          }),
        );
        const { variantId } = await createProductAndVariant();
        const itemId = await createItem(orderId, { variant_id: variantId });
        await insert("customer_session", {
          customer_id: customerId,
          token_hash: HASH_A,
          expires_at: "2099-01-01T00:00:00Z",
        });
        const cartId = await insertId("cart", {
          customer_id: customerId,
          expires_at: "2099-01-01T00:00:00Z",
        });
        await insert("cart_item", { cart_id: cartId, variant_id: variantId, quantity: 1 });
        const before = await selectRow("sales_order", orderId);

        await client.query('delete from "customer" where id = $1', [customerId]);

        expect(await count("customer_session")).toBe(0);
        expect(await count("cart")).toBe(0);
        expect(await count("cart_item")).toBe(0);
        const after = await selectRow("sales_order", orderId);
        expect(after).toEqual({ ...before, customer_id: null });
        expect(after).toMatchObject({
          email: "gone@example.com",
          phone: "+380671112233",
          first_name: "Olena",
          last_name: "Shevchenko",
          access_token_hash: null,
          access_expires_at: null,
        });
        // The snapshot is untouched: the delete of the customer is not a change of the order lines.
        expect(await count("order_item", `id = '${itemId}'`)).toBe(1);
      });

      it("leaves an order without customer and without token, which stays unreachable for guests", async () => {
        const customerId = await createCustomer();
        const orderId = await insertId("sales_order", customerOrderRow(customerId));
        await client.query('delete from "customer" where id = $1', [customerId]);
        expect(await selectRow("sales_order", orderId)).toMatchObject({
          customer_id: null,
          access_token_hash: null,
          access_expires_at: null,
        });
      });
    });

    it("has the indexes of the plan", async () => {
      const result = await client.query(
        `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'sales_order'`,
      );
      const definitions = new Map(
        result.rows.map((row: { indexname: string; indexdef: string }) => [
          row.indexname,
          row.indexdef,
        ]),
      );
      expect(definitions.get("sales_order_customer_id_placed_at_idx")).toContain(
        "(customer_id, placed_at DESC NULLS LAST)",
      );
      expect(definitions.get("sales_order_status_expires_at_idx")).toContain(
        "(status, expires_at)",
      );
      expect(definitions.get("sales_order_placed_at_idx")).toContain("(placed_at DESC NULLS LAST)");
      expect(definitions.get("sales_order_email_idx")).toContain("(email)");
    });
  });

  describe("order_item", () => {
    it("accepts a line and applies the defaults", async () => {
      const orderId = await createOrder();
      const created = await insert("order_item", itemRow(orderId));
      expect(created).toMatchObject({
        product_id: null,
        variant_id: null,
        variant_title: null,
        image_url: null,
        compare_at_amount: null,
        requires_shipping: true,
      });
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.unit_amount).toBe("1000");
      expect(created.line_total).toBe("2000");
    });

    it("accepts quantity 1 and the maximum, rejects 0, -1 and the maximum plus one", async () => {
      const orderId = await createOrder();
      // A free line (unit 0, total 0) keeps the total check out of the way, so only the quantity can fail.
      await expectBoundaries(
        (value) =>
          insert(
            "order_item",
            itemRow(orderId, { quantity: value, unit_amount: 0, line_total: 0 }),
          ),
        "order_item_quantity_check",
        [1, MAX_LINE_QUANTITY],
        [0, -1, MAX_LINE_QUANTITY + 1],
      );
    });

    it("accepts unit amount 0 and the maximum, rejects -1 and the maximum plus one", async () => {
      const orderId = await createOrder();
      for (const unitAmount of [0, MAX_AMOUNT]) {
        await expectAccepted(() =>
          insert(
            "order_item",
            itemRow(orderId, { unit_amount: unitAmount, quantity: 1, line_total: unitAmount }),
          ),
        );
      }
      // With a quantity of at least 1 a unit amount outside 0..MAX also puts the line total outside it, and the total
      // check is named first, so that is the constraint Postgres reports (`order_item_unit_amount_check` is the explicit
      // twin that documents the limit).
      for (const unitAmount of [-1, MAX_AMOUNT + 1]) {
        await expectViolation(
          () =>
            insert(
              "order_item",
              itemRow(orderId, { unit_amount: unitAmount, quantity: 1, line_total: unitAmount }),
            ),
          CHECK_VIOLATION,
          "order_item_line_total_check",
        );
      }
    });

    it("keeps the line total within the maximum: 999 x MAX_AMOUNT is refused even when it equals the product", async () => {
      const orderId = await createOrder();
      await expectAccepted(() =>
        insert(
          "order_item",
          itemRow(orderId, { unit_amount: MAX_AMOUNT, quantity: 1, line_total: MAX_AMOUNT }),
        ),
      );
      await expectViolation(
        () =>
          insert(
            "order_item",
            itemRow(orderId, {
              unit_amount: MAX_AMOUNT,
              quantity: MAX_LINE_QUANTITY,
              line_total: MAX_AMOUNT * MAX_LINE_QUANTITY,
            }),
          ),
        CHECK_VIOLATION,
        "order_item_line_total_check",
      );
    });

    it("requires the line total to equal the unit amount times the quantity", async () => {
      const orderId = await createOrder();
      for (const lineTotal of [1999, 2001, 0, 1000]) {
        await expectViolation(
          () => insert("order_item", itemRow(orderId, { line_total: lineTotal })),
          CHECK_VIOLATION,
          "order_item_line_total_sum_check",
        );
      }
      await expectAccepted(() => insert("order_item", itemRow(orderId, { line_total: 2000 })));
    });

    it("lets compare-at be NULL or greater than the unit amount and within the maximum", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) =>
          insert(
            "order_item",
            itemRow(orderId, { compare_at_amount: value, unit_amount: 1000, line_total: 2000 }),
          ),
        "order_item_compare_at_amount_check",
        [null, 1001, MAX_AMOUNT],
        [1000, 999, 0, -1, MAX_AMOUNT + 1],
      );
    });

    it("limits the SKU to the catalog SKU length", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_item", itemRow(orderId, { sku: value })),
        "order_item_sku_check",
        ["x", "x".repeat(TEXT_LIMITS.sku)],
        ["", "x".repeat(TEXT_LIMITS.sku + 1)],
      );
    });

    it("limits the image URL to the catalog URL length", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_item", itemRow(orderId, { image_url: value })),
        "order_item_image_url_check",
        [null, "x", "x".repeat(TEXT_LIMITS.url)],
        ["", "x".repeat(TEXT_LIMITS.url + 1)],
      );
    });

    it("stores texts as locale maps and option values as an array", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_item", itemRow(orderId, { product_title: value })),
        "order_item_product_title_check",
        [JSON.stringify({ uk: "a", en: "b" })],
        [JSON.stringify([]), JSON.stringify("text")],
      );
      await expectBoundaries(
        (value) => insert("order_item", itemRow(orderId, { variant_title: value })),
        "order_item_variant_title_check",
        [null, JSON.stringify({ uk: "a" })],
        [JSON.stringify([]), JSON.stringify("text")],
      );
      await expectBoundaries(
        (value) => insert("order_item", itemRow(orderId, { option_values: value })),
        "order_item_option_values_check",
        [
          JSON.stringify([]),
          JSON.stringify([{ option: { uk: "Колір" }, value: { uk: "Червоний" } }]),
        ],
        [JSON.stringify({}), JSON.stringify("text")],
      );
    });

    it("accepts a currency of three capital letters and a non-negative position", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_item", itemRow(orderId, { currency: value })),
        "order_item_currency_check",
        ["UAH"],
        ["uah", "UA", ""],
      );
      await expectBoundaries(
        (value) => insert("order_item", itemRow(orderId, { position: value })),
        "order_item_position_check",
        [0, 5],
        [-1],
      );
    });

    it("has one line per position of an order", async () => {
      const orderId = await createOrder();
      const otherOrderId = await createOrder();
      await insert("order_item", itemRow(orderId, { position: 0 }));
      await expectViolation(
        () => insert("order_item", itemRow(orderId, { position: 0 })),
        UNIQUE_VIOLATION,
        "order_item_order_id_position_key",
      );
      await insert("order_item", itemRow(orderId, { position: 1 }));
      await insert("order_item", itemRow(otherOrderId, { position: 0 }));
    });

    it("rejects an unknown order, product and variant", async () => {
      const orderId = await createOrder();
      await expectViolation(
        () => insert("order_item", itemRow(MISSING_ID)),
        FOREIGN_KEY_VIOLATION,
        "order_item_order_id_fkey",
      );
      await expectViolation(
        () => insert("order_item", itemRow(orderId, { product_id: MISSING_ID })),
        FOREIGN_KEY_VIOLATION,
        "order_item_product_id_fkey",
      );
      await expectViolation(
        () => insert("order_item", itemRow(orderId, { variant_id: MISSING_ID })),
        FOREIGN_KEY_VIOLATION,
        "order_item_variant_id_fkey",
      );
    });

    describe("immutability trigger", () => {
      async function createLinkedItem() {
        const { productId, variantId } = await createProductAndVariant();
        const orderId = await createOrder();
        const itemId = await createItem(orderId, { product_id: productId, variant_id: variantId });
        return { productId, variantId, orderId, itemId };
      }

      it("rejects a direct UPDATE of any column, also a no-op and the SET NULL of a link", async () => {
        const { itemId } = await createLinkedItem();
        const before = await selectRow("order_item", itemId);
        for (const assignment of [
          "sku = 'OTHER'",
          "product_title = '{}'::jsonb",
          "variant_title = '{}'::jsonb",
          "option_values = '[{}]'::jsonb",
          "image_url = 'https://example.com/x.png'",
          "unit_amount = 1",
          "compare_at_amount = 5000",
          "quantity = 3, line_total = 3000",
          "line_total = 2000",
          "currency = 'USD'",
          "requires_shipping = false",
          "position = 99",
          "created_at = now()",
          "order_id = (select id from sales_order limit 1)",
          "product_id = NULL",
          "variant_id = NULL",
          "product_id = NULL, variant_id = NULL",
          "quantity = quantity",
        ]) {
          await expectViolation(
            () => client.query(`update "order_item" set ${assignment} where id = $1`, [itemId]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        expect(await selectRow("order_item", itemId)).toEqual(before);
      });

      it("rejects a direct DELETE, also of every row at once", async () => {
        const { itemId } = await createLinkedItem();
        await expectViolation(
          () => client.query('delete from "order_item" where id = $1', [itemId]),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => client.query('delete from "order_item"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await count("order_item")).toBe(1);
      });

      describe("changes at trigger depth above 1 (what only a referential action may do)", () => {
        it("accepts the SET NULL of product_id alone, of variant_id alone and of both", async () => {
          const { itemId } = await createLinkedItem();
          const before = await selectRow("order_item", itemId);
          await updateAtDepthTwo("order_item", itemId, "product_id = NULL");
          expect(await selectRow("order_item", itemId)).toEqual({ ...before, product_id: null });
          await updateAtDepthTwo("order_item", itemId, "variant_id = NULL");
          expect(await selectRow("order_item", itemId)).toEqual({
            ...before,
            product_id: null,
            variant_id: null,
          });

          const second = await createLinkedItem();
          const secondBefore = await selectRow("order_item", second.itemId);
          await updateAtDepthTwo(
            "order_item",
            second.itemId,
            "product_id = NULL, variant_id = NULL",
          );
          expect(await selectRow("order_item", second.itemId)).toEqual({
            ...secondBefore,
            product_id: null,
            variant_id: null,
          });
        });

        it("rejects the SET NULL of a link together with a change of any other column", async () => {
          const { itemId } = await createLinkedItem();
          const before = await selectRow("order_item", itemId);
          for (const assignment of [
            "product_id = NULL, sku = 'OTHER'",
            "variant_id = NULL, unit_amount = 1, line_total = 2",
            "product_id = NULL, variant_id = NULL, quantity = 3, line_total = 3000",
            "variant_id = NULL, product_title = '{}'::jsonb",
            "product_id = NULL, requires_shipping = false",
            "variant_id = NULL, currency = 'USD'",
          ]) {
            await expectViolation(
              () => updateAtDepthTwo("order_item", itemId, assignment),
              RESTRICT_VIOLATION,
              undefined,
            );
          }
          expect(await selectRow("order_item", itemId)).toEqual(before);
        });

        it("rejects a change of another column alone, and a link set to a value", async () => {
          const { itemId } = await createLinkedItem();
          const other = await createProductAndVariant();
          for (const assignment of [
            "sku = 'OTHER'",
            "quantity = 3, line_total = 3000",
            `product_id = '${other.productId}'`,
            `variant_id = '${other.variantId}'`,
          ]) {
            await expectViolation(
              () => updateAtDepthTwo("order_item", itemId, assignment),
              RESTRICT_VIOLATION,
              undefined,
            );
          }
        });

        it("rejects pointing a NULL link at a row again", async () => {
          const orderId = await createOrder();
          const itemId = await createItem(orderId);
          const { productId, variantId } = await createProductAndVariant();
          await expectViolation(
            () => updateAtDepthTwo("order_item", itemId, `product_id = '${productId}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
          await expectViolation(
            () => updateAtDepthTwo("order_item", itemId, `variant_id = '${variantId}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
        });

        it("accepts a DELETE", async () => {
          const { itemId } = await createLinkedItem();
          await deleteAtDepthTwo("order_item", itemId);
          expect(await count("order_item")).toBe(0);
        });
      });

      it("lets the delete of a variant null variant_id only, and the line stays whole", async () => {
        const { productId, variantId, itemId } = await createLinkedItem();
        const before = await selectRow("order_item", itemId);
        await client.query('delete from "variant" where id = $1', [variantId]);
        expect(await selectRow("order_item", itemId)).toEqual({ ...before, variant_id: null });
        expect(await count("product", `id = '${productId}'`)).toBe(1);
      });

      it("lets the delete of a product null both links, and the line stays whole", async () => {
        const { productId, itemId } = await createLinkedItem();
        const before = await selectRow("order_item", itemId);
        await client.query('delete from "product" where id = $1', [productId]);
        expect(await selectRow("order_item", itemId)).toEqual({
          ...before,
          product_id: null,
          variant_id: null,
        });
      });

      it("lets the delete of a product null product_id of a line whose variant is already gone", async () => {
        const { productId, variantId, itemId } = await createLinkedItem();
        await client.query('delete from "variant" where id = $1', [variantId]);
        await client.query('delete from "product" where id = $1', [productId]);
        expect(await selectRow("order_item", itemId)).toMatchObject({
          product_id: null,
          variant_id: null,
          sku: "SKU-1",
          quantity: 2,
        });
      });
    });
  });

  describe("order_adjustment", () => {
    it("accepts an adjustment and applies the defaults", async () => {
      const created = await insert("order_adjustment", adjustmentRow(await createOrder()));
      expect(created).toMatchObject({ source: null, kind: "shipping", amount: "500" });
      expect(created.created_at).toBeInstanceOf(Date);
    });

    it("accepts the kind pattern and rejects others", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_adjustment", adjustmentRow(orderId, { kind: value })),
        "order_adjustment_kind_check",
        ["shipping", "discount", "tax", "gift_wrap", "a", "a".repeat(64)],
        ["Shipping", "1tax", "_tax", "gift-wrap", "", "a".repeat(65)],
      );
    });

    it("limits the code, the source and requires an object label", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_adjustment", adjustmentRow(orderId, { code: value })),
        "order_adjustment_code_check",
        ["x", "x".repeat(TEXT_LIMITS.code)],
        ["", "x".repeat(TEXT_LIMITS.code + 1)],
      );
      await expectBoundaries(
        (value) => insert("order_adjustment", adjustmentRow(orderId, { source: value })),
        "order_adjustment_source_check",
        [null, "payments_example", "x".repeat(64)],
        ["", "x".repeat(65)],
      );
      await expectBoundaries(
        (value) => insert("order_adjustment", adjustmentRow(orderId, { label: value })),
        "order_adjustment_label_check",
        [JSON.stringify({ uk: "Доставка" })],
        [JSON.stringify([]), JSON.stringify("text")],
      );
    });

    it("accepts a signed amount within plus and minus the maximum", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_adjustment", adjustmentRow(orderId, { amount: value })),
        "order_adjustment_amount_check",
        [0, -1, MAX_AMOUNT, -MAX_AMOUNT],
        [MAX_AMOUNT + 1, -MAX_AMOUNT - 1],
      );
    });

    it("rejects an unknown order", async () => {
      await expectViolation(
        () => insert("order_adjustment", adjustmentRow(MISSING_ID)),
        FOREIGN_KEY_VIOLATION,
        "order_adjustment_order_id_fkey",
      );
    });

    describe("append-only trigger", () => {
      it("rejects a direct UPDATE of any column and a direct DELETE", async () => {
        const orderId = await createOrder();
        const adjustmentId = await insertId("order_adjustment", adjustmentRow(orderId));
        const before = await selectRow("order_adjustment", adjustmentId);
        for (const assignment of [
          "amount = 1",
          "kind = 'tax'",
          "code = 'other'",
          "label = '{}'::jsonb",
          "included_in_price = true",
          "source = 'x'",
          "created_at = now()",
          "code = code",
        ]) {
          await expectViolation(
            () =>
              client.query(`update "order_adjustment" set ${assignment} where id = $1`, [
                adjustmentId,
              ]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        await expectViolation(
          () => client.query('delete from "order_adjustment" where id = $1', [adjustmentId]),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => client.query('delete from "order_adjustment"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await selectRow("order_adjustment", adjustmentId)).toEqual(before);
      });

      it("rejects every UPDATE at trigger depth above 1, accepts a DELETE there", async () => {
        const orderId = await createOrder();
        const adjustmentId = await insertId("order_adjustment", adjustmentRow(orderId));
        for (const assignment of ["amount = 1", "code = code"]) {
          await expectViolation(
            () => updateAtDepthTwo("order_adjustment", adjustmentId, assignment),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        await deleteAtDepthTwo("order_adjustment", adjustmentId);
        expect(await count("order_adjustment")).toBe(0);
      });
    });
  });

  describe("order_status_change", () => {
    it("accepts a change and applies the defaults", async () => {
      const created = await insert("order_status_change", changeRow(await createOrder()));
      expect(created).toMatchObject({ actor_admin_id: null, reason: null, from_status: null });
      expect(created.created_at).toBeInstanceOf(Date);
    });

    it("takes the time of the statement, not of the transaction", async () => {
      const orderId = await createOrder();
      await client.query("select pg_sleep(0.01)");
      const created = await insert("order_status_change", changeRow(orderId));
      const result = await client.query("select $1::timestamptz > now() as later", [
        created.created_at,
      ]);
      expect(result.rows[0]).toEqual({ later: true });
    });

    it("accepts every status and actor of core and rejects others; the lists equal core", async () => {
      const orderId = await createOrder();
      for (const status of ORDER_STATUSES) {
        await expectAccepted(() =>
          insert(
            "order_status_change",
            changeRow(orderId, { from_status: status, to_status: status }),
          ),
        );
      }
      for (const actor of ORDER_ACTORS) {
        await expectAccepted(() =>
          insert("order_status_change", changeRow(orderId, { actor_type: actor })),
        );
      }
      await expectBoundaries(
        (value) => insert("order_status_change", changeRow(orderId, { from_status: value })),
        "order_status_change_from_status_check",
        [null],
        ["Paid", "pending", ""],
      );
      await expectBoundaries(
        (value) => insert("order_status_change", changeRow(orderId, { to_status: value })),
        "order_status_change_to_status_check",
        [],
        ["Paid", "pending", ""],
      );
      await expectBoundaries(
        (value) => insert("order_status_change", changeRow(orderId, { actor_type: value })),
        "order_status_change_actor_type_check",
        [],
        ["Admin", "bot", ""],
      );
      expect(
        await constraintLiterals("order_status_change", "order_status_change_to_status_check"),
      ).toEqual([...ORDER_STATUSES].sort());
      expect(
        await constraintLiterals("order_status_change", "order_status_change_from_status_check"),
      ).toEqual([...ORDER_STATUSES].sort());
      expect(
        await constraintLiterals("order_status_change", "order_status_change_actor_type_check"),
      ).toEqual([...ORDER_ACTORS].sort());
    });

    it("limits the reason", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (value) => insert("order_status_change", changeRow(orderId, { reason: value })),
        "order_status_change_reason_check",
        [null, "x", "x".repeat(500)],
        ["", "x".repeat(501)],
      );
    });

    it("rejects an unknown order and an unknown admin user", async () => {
      const orderId = await createOrder();
      await expectViolation(
        () => insert("order_status_change", changeRow(MISSING_ID)),
        FOREIGN_KEY_VIOLATION,
        "order_status_change_order_id_fkey",
      );
      await expectViolation(
        () => insert("order_status_change", changeRow(orderId, { actor_admin_id: MISSING_ID })),
        FOREIGN_KEY_VIOLATION,
        "order_status_change_actor_admin_id_fkey",
      );
    });

    describe("append-only trigger", () => {
      it("rejects a direct UPDATE of any column, also nulling the admin, and a direct DELETE", async () => {
        const orderId = await createOrder();
        const adminId = await createAdmin();
        const changeId = await insertId(
          "order_status_change",
          changeRow(orderId, { actor_type: "admin", actor_admin_id: adminId, reason: "x" }),
        );
        const before = await selectRow("order_status_change", changeId);
        for (const assignment of [
          "to_status = 'paid'",
          "from_status = 'paid'",
          "actor_type = 'system'",
          "reason = 'edited'",
          "actor_admin_id = NULL",
          "created_at = now()",
          "reason = reason",
        ]) {
          await expectViolation(
            () =>
              client.query(`update "order_status_change" set ${assignment} where id = $1`, [
                changeId,
              ]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        await expectViolation(
          () => client.query('delete from "order_status_change" where id = $1', [changeId]),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => client.query('delete from "order_status_change"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await selectRow("order_status_change", changeId)).toEqual(before);
      });

      it("allows SET NULL of actor_admin_id when the admin user is deleted, and nothing else changes", async () => {
        const orderId = await createOrder();
        const adminId = await createAdmin();
        const changeId = await insertId(
          "order_status_change",
          changeRow(orderId, {
            actor_type: "admin",
            actor_admin_id: adminId,
            from_status: "awaiting_payment",
            to_status: "cancelled",
            reason: "customer called",
          }),
        );
        const before = await selectRow("order_status_change", changeId);
        await client.query('delete from "admin_user" where id = $1', [adminId]);
        expect(await selectRow("order_status_change", changeId)).toEqual({
          ...before,
          actor_admin_id: null,
        });
      });

      describe("changes at trigger depth above 1 (what only a referential action may do)", () => {
        it("accepts an UPDATE that only nulls actor_admin_id", async () => {
          const adminId = await createAdmin();
          const changeId = await insertId(
            "order_status_change",
            changeRow(await createOrder(), { actor_type: "admin", actor_admin_id: adminId }),
          );
          await updateAtDepthTwo("order_status_change", changeId, "actor_admin_id = NULL");
          expect(await selectRow("order_status_change", changeId)).toMatchObject({
            actor_admin_id: null,
            actor_type: "admin",
          });
        });

        it("rejects an UPDATE that nulls actor_admin_id and changes another column", async () => {
          const adminId = await createAdmin();
          const changeId = await insertId(
            "order_status_change",
            changeRow(await createOrder(), { actor_type: "admin", actor_admin_id: adminId }),
          );
          for (const assignment of [
            "actor_admin_id = NULL, reason = 'edited'",
            "actor_admin_id = NULL, to_status = 'paid'",
            "actor_admin_id = NULL, actor_type = 'system'",
          ]) {
            await expectViolation(
              () => updateAtDepthTwo("order_status_change", changeId, assignment),
              RESTRICT_VIOLATION,
              undefined,
            );
          }
          expect(await selectRow("order_status_change", changeId)).toMatchObject({
            actor_admin_id: adminId,
          });
        });

        it("rejects another column alone and an admin set to a value", async () => {
          const adminId = await createAdmin();
          const changeId = await insertId("order_status_change", changeRow(await createOrder()));
          await expectViolation(
            () => updateAtDepthTwo("order_status_change", changeId, "reason = 'edited'"),
            RESTRICT_VIOLATION,
            undefined,
          );
          await expectViolation(
            () =>
              updateAtDepthTwo("order_status_change", changeId, `actor_admin_id = '${adminId}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
        });

        it("accepts a DELETE", async () => {
          const changeId = await insertId("order_status_change", changeRow(await createOrder()));
          await deleteAtDepthTwo("order_status_change", changeId);
          expect(await count("order_status_change")).toBe(0);
        });
      });
    });
  });

  describe("order_item_reservation", () => {
    async function createReservedLine(extraVariant: Row = {}) {
      const { productId, variantId } = await createProductAndVariant(extraVariant);
      const reservationId = await insertId(
        "reservation",
        reservationRow(variantId, await defaultLocationId()),
      );
      const orderId = await createOrder();
      const itemId = await createItem(orderId, { product_id: productId, variant_id: variantId });
      await client.query(
        'insert into "order_item_reservation" (order_item_id, reservation_id) values ($1, $2)',
        [itemId, reservationId],
      );
      return { productId, variantId, reservationId, orderId, itemId };
    }
    const link = (itemId: string, reservationId: string) =>
      client.query(
        'insert into "order_item_reservation" (order_item_id, reservation_id) values ($1, $2)',
        [itemId, reservationId],
      );

    it("links a line to its reservations: the pair is unique, a reservation belongs to one line, a line may have several", async () => {
      const { itemId, reservationId, variantId, orderId } = await createReservedLine();
      await expectViolation(
        () => link(itemId, reservationId),
        UNIQUE_VIOLATION,
        "order_item_reservation_pkey",
      );
      const otherItemId = await createItem(orderId);
      await expectViolation(
        () => link(otherItemId, reservationId),
        UNIQUE_VIOLATION,
        "order_item_reservation_reservation_id_key",
      );
      const second = await insertId(
        "reservation",
        reservationRow(variantId, await defaultLocationId()),
      );
      await link(itemId, second);
      expect(await count("order_item_reservation")).toBe(2);
    });

    it("rejects an unknown line and an unknown reservation", async () => {
      const { itemId, variantId } = await createReservedLine();
      const freeReservationId = await insertId(
        "reservation",
        reservationRow(variantId, await defaultLocationId()),
      );
      await expectViolation(
        () => link(MISSING_ID, freeReservationId),
        FOREIGN_KEY_VIOLATION,
        "order_item_reservation_order_item_id_fkey",
      );
      await expectViolation(
        () => link(itemId, MISSING_ID),
        FOREIGN_KEY_VIOLATION,
        "order_item_reservation_reservation_id_fkey",
      );
    });

    it("restricts deleting a reservation that an order line holds", async () => {
      const { reservationId } = await createReservedLine();
      await expectViolation(
        () => client.query('delete from "reservation" where id = $1', [reservationId]),
        FOREIGN_KEY_VIOLATION,
        "order_item_reservation_reservation_id_fkey",
      );
      expect(await count("reservation")).toBe(1);
    });

    it("restricts deleting a variant or a product whose reservation an order line holds, and keeps everything", async () => {
      const { variantId, productId, itemId } = await createReservedLine();
      await expectViolation(
        () => client.query('delete from "variant" where id = $1', [variantId]),
        FOREIGN_KEY_VIOLATION,
        "order_item_reservation_reservation_id_fkey",
      );
      await expectViolation(
        () => client.query('delete from "product" where id = $1', [productId]),
        FOREIGN_KEY_VIOLATION,
        "order_item_reservation_reservation_id_fkey",
      );
      expect(await selectRow("order_item", itemId)).toMatchObject({
        variant_id: variantId,
        product_id: productId,
      });
      expect(await count("reservation")).toBe(1);
    });

    it("restricts deleting a location that a held reservation uses", async () => {
      const { variantId } = await createProductAndVariant();
      const locationId = await insertId("location", { code: "annex", name: "Annex" });
      const reservationId = await insertId("reservation", reservationRow(variantId, locationId));
      const itemId = await createItem(await createOrder(), { variant_id: variantId });
      await link(itemId, reservationId);
      await expectViolation(
        () => client.query('delete from "location" where id = $1', [locationId]),
        FOREIGN_KEY_VIOLATION,
        "reservation_location_id_fkey",
      );
    });

    it("is deleted with its order line, and the reservation stays untouched", async () => {
      const { orderId, reservationId } = await createReservedLine();
      const before = await selectRow("reservation", reservationId);
      await client.query('delete from "sales_order" where id = $1', [orderId]);
      expect(await count("order_item_reservation")).toBe(0);
      expect(await selectRow("reservation", reservationId)).toEqual(before);
    });

    it("lets the variant be deleted again once its order is gone", async () => {
      const { orderId, variantId } = await createReservedLine();
      await client.query('delete from "sales_order" where id = $1', [orderId]);
      await client.query('delete from "variant" where id = $1', [variantId]);
      expect(await count("reservation")).toBe(0);
    });
  });

  describe("variants that were sold (ADR 0019)", () => {
    it("can be deleted at database level when they were never reserved (untracked, digital): the order line keeps its snapshot, the cart line goes", async () => {
      // The catalog rule `has_stock_history` (ADR 0013) looks at stock_movement and reservation rows only. An untracked
      // variant has neither, so a sold untracked variant passes that rule; the database must keep the snapshot anyway.
      const { productId, variantId } = await createProductAndVariant({ track_inventory: false });
      expect(await count("stock_movement", `variant_id = '${variantId}'`)).toBe(0);
      expect(await count("reservation", `variant_id = '${variantId}'`)).toBe(0);
      const orderId = await createOrder();
      const itemId = await createItem(orderId, { product_id: productId, variant_id: variantId });
      const cartId = await insertId("cart", {
        token_hash: HASH_A,
        expires_at: "2099-01-01T00:00:00Z",
      });
      await insert("cart_item", { cart_id: cartId, variant_id: variantId, quantity: 1 });
      const before = await selectRow("order_item", itemId);

      await client.query('delete from "variant" where id = $1', [variantId]);

      expect(await selectRow("order_item", itemId)).toEqual({ ...before, variant_id: null });
      expect(await count("cart_item")).toBe(0);
      expect(await count("cart")).toBe(1);
    });
  });

  describe("deleting an order", () => {
    it("removes its lines, adjustments, status changes and reservation links through the allowed cascade path, and nothing else", async () => {
      const { variantId, productId } = await createProductAndVariant();
      const reservationId = await insertId(
        "reservation",
        reservationRow(variantId, await defaultLocationId()),
      );
      const orderId = await createOrder();
      const otherOrderId = await createOrder();
      const itemId = await createItem(orderId, { product_id: productId, variant_id: variantId });
      await createItem(otherOrderId);
      await insert("order_adjustment", adjustmentRow(orderId));
      await insert("order_adjustment", adjustmentRow(otherOrderId));
      await insert("order_status_change", changeRow(orderId));
      await insert("order_status_change", changeRow(otherOrderId));
      await client.query(
        'insert into "order_item_reservation" (order_item_id, reservation_id) values ($1, $2)',
        [itemId, reservationId],
      );

      await client.query('delete from "sales_order" where id = $1', [orderId]);

      expect(await count("order_item", `order_id = '${orderId}'`)).toBe(0);
      expect(await count("order_adjustment", `order_id = '${orderId}'`)).toBe(0);
      expect(await count("order_status_change", `order_id = '${orderId}'`)).toBe(0);
      expect(await count("order_item_reservation")).toBe(0);
      expect(await count("order_item", `order_id = '${otherOrderId}'`)).toBe(1);
      expect(await count("order_adjustment", `order_id = '${otherOrderId}'`)).toBe(1);
      expect(await count("order_status_change", `order_id = '${otherOrderId}'`)).toBe(1);
      expect(await count("variant", `id = '${variantId}'`)).toBe(1);
      expect(await count("reservation")).toBe(1);
    });
  });

  describe("domain_event", () => {
    const eventRow = (extra: Row = {}): Row => ({
      type: "order.placed",
      aggregate_id: randomUUID(),
      payload: JSON.stringify({ orderId: randomUUID() }),
      ...extra,
    });

    it("accepts an event, applies the defaults and has no foreign key on the aggregate", async () => {
      const created = await insert("domain_event", eventRow());
      expect(created).toMatchObject({ attempts: 0, dispatched_at: null, last_error_code: null });
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      const foreignKeys = await client.query(
        `select count(*)::int as count from pg_constraint where conrelid = 'public.domain_event'::regclass and contype = 'f'`,
      );
      expect(foreignKeys.rows[0]).toEqual({ count: 0 });
    });

    it("accepts dotted lower-case type names and rejects others", async () => {
      await expectBoundaries(
        (value) => insert("domain_event", eventRow({ type: value })),
        "domain_event_type_check",
        ["order.placed", "order.paid", "customer.registered", "a.b.c", "payment_x.refund_issued"],
        ["order", "Order.placed", "order.", ".placed", "order placed", "order..placed", "1.a", ""],
      );
    });

    it("requires a JSON object payload", async () => {
      await expectBoundaries(
        (value) => insert("domain_event", eventRow({ payload: value })),
        "domain_event_payload_check",
        [JSON.stringify({}), JSON.stringify({ a: 1 })],
        [JSON.stringify([]), JSON.stringify("text"), JSON.stringify(1)],
      );
    });

    it("rejects negative attempts and an error that is not a short code", async () => {
      await expectViolation(
        () => insert("domain_event", eventRow({ attempts: -1 })),
        CHECK_VIOLATION,
        "domain_event_attempts_check",
      );
      await expectBoundaries(
        (value) => insert("domain_event", eventRow({ last_error_code: value })),
        "domain_event_last_error_code_check",
        [null, "ECONNRESET", "handler_failed", "x".repeat(64)],
        ["", "x".repeat(65), "has space", "Request failed for buyer@example.com"],
      );
    });

    it("has the partial outbox index on undispatched rows", async () => {
      const result = await client.query(
        `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'domain_event_dispatched_at_created_at_idx'`,
      );
      const definition = must(
        (result.rows[0] as { indexdef: string } | undefined)?.indexdef,
        "outbox index",
      );
      expect(definition).toContain("(dispatched_at, created_at)");
      expect(definition).toContain("WHERE (dispatched_at IS NULL)");
    });
  });

  describe("foreign keys have an index on the referencing column", () => {
    it("covers every foreign key of the new tables with an index that starts with its columns (or a unique constraint)", async () => {
      const result = await client.query(
        `select c.conrelid::regclass::text as table_name, c.conname, a.attname as column_name
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.conrelid::regclass::text = any($1)
           and not exists (
             select 1 from pg_index i
             where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
           )`,
        [
          [
            "customer_session",
            "cart",
            "cart_item",
            "sales_order",
            "order_item",
            "order_adjustment",
            "order_status_change",
            "order_item_reservation",
          ],
        ],
      );
      expect(result.rows).toEqual([]);
    });
  });

  describe("drizzle schema", () => {
    it("keeps every constraint, index and table name within 63 characters", () => {
      const tables: PgTable[] = [
        customersSchema.customer,
        customersSchema.customerSession,
        cartsSchema.cart,
        cartsSchema.cartItem,
        ordersSchema.salesOrder,
        ordersSchema.orderItem,
        ordersSchema.orderAdjustment,
        ordersSchema.orderStatusChange,
        ordersSchema.orderItemReservation,
        domainEventsSchema.domainEvent,
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
