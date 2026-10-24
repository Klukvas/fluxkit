import { randomUUID } from "node:crypto";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CARRIER_CODE_PATTERN,
  CARRIER_REFERENCE_PATTERN,
  CODE_PATTERN,
  COUNTRY_CODE_PATTERN,
  INACTIVE_SHIPMENT_STATUSES,
  MAX_AMOUNT,
  ORDER_NUMBER_PATTERN,
  SHIPMENT_ACTORS,
  SHIPMENT_PAYERS,
  SHIPMENT_STATUSES,
  SHIPPING_LIMITS,
  SHIPPING_METHOD_KINDS,
  SHIPPING_PAYERS,
  SHIPPING_PRICING_TYPES,
  TEXT_LIMITS,
  isTerminalShipmentStatus,
} from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import * as shippingSchema from "./schema/shipping.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
const RESTRICT_VIOLATION = "23001";

type Value = string | number | boolean | null | Value[];
type Row = Record<string, Value>;

const i18n = (value: string) => JSON.stringify({ uk: value, en: `${value} (en)` });
const sorted = (values: readonly string[]) => [...values].sort();

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("shipping schema (migration 0006, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  // Every test runs in its own transaction that is rolled back, so tests never see each other's rows.
  let client: pg.PoolClient;

  beforeAll(async () => {
    await ensureMigrated();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
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

  async function selectWhere(table: string, where: string): Promise<Record<string, unknown>> {
    const result = await client.query(`select * from "${table}" where ${where}`);
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} row ${where}`);
  }

  /** Runs one statement that must fail; asserts SQLSTATE and constraint name, then undoes the failed statement. */
  async function expectViolation(
    run: () => Promise<unknown>,
    code: string,
    constraint: string | undefined,
  ): Promise<void> {
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

  async function constraintDefinition(table: string, constraint: string): Promise<string> {
    const result = await client.query(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = $1::regclass and conname = $2`,
      [`public.${table}`, constraint],
    );
    return must(
      (result.rows[0] as { definition: string } | undefined)?.definition,
      `${constraint} definition`,
    );
  }

  /** The string literals of a CHECK, sorted: to compare a database list with the list in packages/core. */
  async function constraintLiterals(table: string, constraint: string): Promise<string[]> {
    const definition = await constraintDefinition(table, constraint);
    return [...definition.matchAll(/'([^']+)'/g)].map((match) => must(match[1], "literal")).sort();
  }

  async function indexDefinition(name: string): Promise<string> {
    const result = await client.query(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = $1`,
      [name],
    );
    return must((result.rows[0] as { indexdef: string } | undefined)?.indexdef, `index ${name}`);
  }

  let probeSequence = 0;
  /**
   * Runs `statement` from the body of a trigger on a temporary table, created inside the test transaction (its rollback
   * drops it): the trigger under test then sees `pg_trigger_depth()` of 2, like a foreign key action does (the technique
   * of cart-orders-schema.spec.ts).
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

  let sequence = 0;

  async function createAdmin(): Promise<string> {
    sequence += 1;
    return insertId("admin_user", {
      email: `shipping-schema-${sequence}@example.com`,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      role: "owner",
    });
  }

  /** A valid order number per call (digits only, which the Crockford alphabet contains). */
  function nextOrderNumber(): string {
    sequence += 1;
    const digits = String(sequence).padStart(8, "0");
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  async function createOrder(): Promise<{ id: string; number: string }> {
    const number = nextOrderNumber();
    const id = await insertId("sales_order", {
      number,
      status: "paid",
      email: "buyer@example.com",
      phone: "+380501234567",
      first_name: "Ann",
      last_name: "Buyer",
      locale: "uk",
      currency: "UAH",
      subtotal_amount: 2000,
      shipping_total: 500,
      discount_total: 0,
      tax_total: 0,
      total_amount: 2500,
      access_token_hash: randomUUID().replaceAll("-", "").repeat(2),
      access_expires_at: "2099-01-01T00:00:00Z",
      idempotency_key: randomUUID(),
      request_fingerprint: "a".repeat(64),
      expires_at: "2099-01-01T00:00:00Z",
    });
    return { id, number };
  }

  const methodRow = (extra: Row = {}): Row => {
    sequence += 1;
    return {
      code: `method_${sequence}`,
      title: i18n("Courier"),
      kind: "address",
      pricing: JSON.stringify({ type: "flat", amount: 500 }),
      currency: "UAH",
      country_codes: ["UA"],
      ...extra,
    };
  };
  const createMethod = (extra: Row = {}) => insertId("shipping_method", methodRow(extra));

  const orderShippingRow = (orderId: string, extra: Row = {}): Row => ({
    order_id: orderId,
    method_code: "courier",
    kind: "address",
    title: i18n("Courier"),
    amount: 500,
    currency: "UAH",
    payer: "shop_charge",
    ...extra,
  });

  const DESTINATION = JSON.stringify({
    providerRef: "0d545f8e-e1c2-11e3-8c4a-0050568002cf",
    number: "1",
    kind: "branch",
    cityRef: "8d5a980d-391c-11dd-90d9-001a92567626",
    cityName: "Kyiv",
    description: "Branch 1",
  });

  const shipmentRow = (orderId: string, orderNumber: string, extra: Row = {}): Row => ({
    order_id: orderId,
    provider_code: "fake",
    status: "pending",
    client_reference: orderNumber,
    declared_value_amount: 2000,
    currency: "UAH",
    payer: "recipient",
    weight_grams: 500,
    length_mm: 300,
    width_mm: 200,
    height_mm: 100,
    ...extra,
  });

  async function createShipment(extra: Row = {}): Promise<{ id: string; orderId: string }> {
    const order = await createOrder();
    const id = await insertId("shipment", shipmentRow(order.id, order.number, extra));
    return { id, orderId: order.id };
  }

  const changeRow = (shipmentId: string, extra: Row = {}): Row => ({
    shipment_id: shipmentId,
    from_status: null,
    to_status: "pending",
    actor_type: "admin",
    ...extra,
  });

  describe("lists and patterns equal packages/core", () => {
    it("has the kinds, payers, pricing types, statuses and actors of core", async () => {
      expect(await constraintLiterals("shipping_method", "shipping_method_kind_check")).toEqual(
        sorted(SHIPPING_METHOD_KINDS),
      );
      expect(await constraintLiterals("order_shipping", "order_shipping_kind_check")).toEqual(
        sorted(SHIPPING_METHOD_KINDS),
      );
      expect(await constraintLiterals("order_shipping", "order_shipping_payer_check")).toEqual(
        sorted(SHIPPING_PAYERS),
      );
      // 'object' and the JSON key 'type' (twice: IS NOT NULL and IN) are not pricing types; the rest are.
      expect(await constraintLiterals("shipping_method", "shipping_method_pricing_check")).toEqual(
        sorted(["object", "type", "type", ...SHIPPING_PRICING_TYPES]),
      );
      expect(await constraintLiterals("shipment", "shipment_status_check")).toEqual(
        sorted(SHIPMENT_STATUSES),
      );
      expect(await constraintLiterals("shipment", "shipment_payer_check")).toEqual(
        sorted(SHIPMENT_PAYERS),
      );
      expect(
        await constraintLiterals(
          "shipment_status_change",
          "shipment_status_change_to_status_check",
        ),
      ).toEqual(sorted(SHIPMENT_STATUSES));
      expect(
        await constraintLiterals(
          "shipment_status_change",
          "shipment_status_change_from_status_check",
        ),
      ).toEqual(sorted(SHIPMENT_STATUSES));
      expect(
        await constraintLiterals(
          "shipment_status_change",
          "shipment_status_change_actor_type_check",
        ),
      ).toEqual(sorted(SHIPMENT_ACTORS));
    });

    it("uses the code, carrier code, carrier reference, country and order number patterns of core", async () => {
      const quoted = (pattern: RegExp) => `'${pattern.source}'`;
      for (const [table, constraint] of [
        ["shipping_method", "shipping_method_code_check"],
        ["shipping_method", "shipping_method_provider_code_check"],
        ["shipping_provider_setting", "shipping_provider_setting_provider_code_check"],
        ["order_shipping", "order_shipping_method_code_check"],
        ["order_shipping", "order_shipping_provider_code_check"],
        ["shipment", "shipment_provider_code_check"],
      ] as const) {
        expect(await constraintDefinition(table, constraint), constraint).toContain(
          quoted(CODE_PATTERN),
        );
      }
      expect(
        await constraintDefinition("shipment", "shipment_carrier_status_code_check"),
      ).toContain(quoted(CARRIER_CODE_PATTERN));
      expect(
        await constraintDefinition(
          "shipment_status_change",
          "shipment_status_change_carrier_status_code_check",
        ),
      ).toContain(quoted(CARRIER_CODE_PATTERN));
      expect(await constraintDefinition("shipment", "shipment_tracking_number_check")).toContain(
        quoted(CARRIER_REFERENCE_PATTERN),
      );
      expect(await constraintDefinition("shipment", "shipment_provider_ref_check")).toContain(
        quoted(CARRIER_REFERENCE_PATTERN),
      );
      expect(await constraintDefinition("shipment", "shipment_client_reference_check")).toContain(
        quoted(ORDER_NUMBER_PATTERN),
      );
      // COUNTRY_CODE_PATTERN for every element of the comma-joined list.
      const element = COUNTRY_CODE_PATTERN.source.replace(/^\^/, "").replace(/\$$/, "");
      expect(
        await constraintDefinition("shipping_method", "shipping_method_country_codes_check"),
      ).toContain(`'^${element}(,${element})*$'`);
    });

    it("has the partial indexes over the inactive and the terminal statuses of core", async () => {
      const active = await indexDefinition("shipment_order_id_active_key");
      expect(active).toContain("CREATE UNIQUE INDEX");
      expect(active).toContain("(order_id)");
      expect([...active.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()).toEqual(
        sorted(INACTIVE_SHIPMENT_STATUSES),
      );

      const due = await indexDefinition("shipment_next_track_at_idx");
      expect(due).toContain("(next_track_at)");
      expect([...due.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()).toEqual(
        sorted(SHIPMENT_STATUSES.filter((status) => isTerminalShipmentStatus(status))),
      );
    });
  });

  describe("shipping_method", () => {
    it("accepts a method and applies the defaults: inactive, position 0", async () => {
      const created = await insert("shipping_method", methodRow({ code: "courier" }));
      expect(created).toMatchObject({
        code: "courier",
        description: null,
        provider_code: null,
        provider_service: null,
        currency: "UAH",
        country_codes: ["UA"],
        is_active: false,
        position: 0,
      });
      expect(created.pricing).toEqual({ type: "flat", amount: 500 });
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
    });

    it("keeps codes unique and in the code pattern", async () => {
      await createMethod({ code: "courier" });
      await expectViolation(
        () => createMethod({ code: "courier" }),
        UNIQUE_VIOLATION,
        "shipping_method_code_key",
      );
      await expectBoundaries(
        (code) => createMethod({ code }),
        "shipping_method_code_check",
        ["a", `a${"b".repeat(TEXT_LIMITS.code - 1)}`],
        ["", "Courier", "1courier", "courier-x", `a${"b".repeat(TEXT_LIMITS.code)}`],
      );
    });

    it("requires a non-empty title map and takes an optional description map", async () => {
      await expectBoundaries(
        (title) => createMethod({ title }),
        "shipping_method_title_check",
        [i18n("x")],
        ["{}", "[]", '"text"'],
      );
      await expectViolation(() => createMethod({ title: null }), NOT_NULL_VIOLATION, undefined);
      await expectBoundaries(
        (description) => createMethod({ description }),
        "shipping_method_description_check",
        [null, "{}", i18n("Pick it up at the shop")],
        ["[]", '"text"'],
      );
    });

    it("accepts every kind and rejects others", async () => {
      await expectBoundaries(
        (kind) => createMethod({ kind, provider_code: "fake" }),
        "shipping_method_kind_check",
        [...SHIPPING_METHOD_KINDS],
        ["courier", "", "Address"],
      );
    });

    it("needs a provider for a pickup point and for a provider service", async () => {
      await expectAccepted(() => createMethod({ kind: "pickup_point", provider_code: "fake" }));
      await expectViolation(
        () => createMethod({ kind: "pickup_point", provider_code: null }),
        CHECK_VIOLATION,
        "shipping_method_pickup_point_provider_check",
      );
      await expectAccepted(() =>
        createMethod({ kind: "store_pickup", provider_code: null, provider_service: null }),
      );
      await expectBoundaries(
        (providerService) =>
          createMethod({ provider_code: "fake", provider_service: providerService }),
        "shipping_method_provider_service_check",
        [null, "warehouse", "WarehouseWarehouse", "x".repeat(TEXT_LIMITS.code)],
        ["", "x".repeat(TEXT_LIMITS.code + 1)],
      );
      await expectViolation(
        () => createMethod({ provider_code: null, provider_service: "warehouse" }),
        CHECK_VIOLATION,
        "shipping_method_provider_service_check",
      );
      await expectBoundaries(
        (providerCode) => createMethod({ provider_code: providerCode }),
        "shipping_method_provider_code_check",
        [null, "nova_poshta"],
        ["", "Nova", "nova-poshta"],
      );
    });

    it("requires a pricing object with a known type (the rest is validated by core)", async () => {
      await expectBoundaries(
        (pricing) => createMethod({ pricing }),
        "shipping_method_pricing_check",
        [
          ...SHIPPING_PRICING_TYPES.map((type) => JSON.stringify({ type })),
          JSON.stringify({ type: "tiers", tiers: [{ fromSubtotal: 0, amount: 100 }] }),
        ],
        [
          "{}",
          JSON.stringify({ amount: 500 }),
          JSON.stringify({ type: null }),
          JSON.stringify({ type: "weight" }),
          JSON.stringify({ type: 1 }),
          "[]",
          '"flat"',
          "null",
        ],
      );
    });

    it("accepts a currency of three capital letters", async () => {
      await expectBoundaries(
        (currency) => createMethod({ currency }),
        "shipping_method_currency_check",
        ["UAH", "EUR"],
        ["uah", "UA", "UAHH", ""],
      );
    });

    it("needs 1 to the limit of distinct-format country codes, one dimension, no NULL element", async () => {
      const many = (size: number) =>
        Array.from({ length: size }, (_, index) => {
          const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          return `${letters.charAt(Math.floor(index / 26) % 26)}${letters.charAt(index % 26)}`;
        });
      await expectBoundaries(
        (countryCodes) => createMethod({ country_codes: countryCodes }),
        "shipping_method_country_codes_check",
        [["UA"], ["UA", "PL", "DE"], many(SHIPPING_LIMITS.maxCountriesPerMethod)],
        [
          [],
          many(SHIPPING_LIMITS.maxCountriesPerMethod + 1),
          ["ua"],
          ["UKR"],
          ["U"],
          ["UA", ""],
          ["UA", null],
          [null],
          ["UA,PL"],
          [
            ["UA", "PL"],
            ["DE", "FR"],
          ],
        ],
      );
      await expectViolation(
        () => createMethod({ country_codes: null }),
        NOT_NULL_VIOLATION,
        undefined,
      );
    });

    it("rejects a negative position", async () => {
      await expectBoundaries(
        (position) => createMethod({ position }),
        "shipping_method_position_check",
        [0, 10],
        [-1],
      );
    });
  });

  describe("shipping_provider_setting", () => {
    it("holds one settings object per provider code", async () => {
      const created = await insert("shipping_provider_setting", {
        provider_code: "nova_poshta",
        settings: JSON.stringify({ senderCityRef: "x" }),
      });
      expect(created).toMatchObject({ provider_code: "nova_poshta", updated_by: null });
      expect(created.updated_at).toBeInstanceOf(Date);
      await expectViolation(
        () => insert("shipping_provider_setting", { provider_code: "nova_poshta", settings: "{}" }),
        UNIQUE_VIOLATION,
        "shipping_provider_setting_pkey",
      );
    });

    it("requires a provider code and a JSON object", async () => {
      await expectBoundaries(
        (providerCode) =>
          insert("shipping_provider_setting", { provider_code: providerCode, settings: "{}" }),
        "shipping_provider_setting_provider_code_check",
        ["fake"],
        ["", "Fake", "fake-provider"],
      );
      await expectBoundaries(
        (settings) => insert("shipping_provider_setting", { provider_code: "fake", settings }),
        "shipping_provider_setting_settings_check",
        ["{}"],
        ["[]", '"x"', "1"],
      );
    });

    it("keeps the row and nulls updated_by when the admin user is deleted; rejects an unknown admin", async () => {
      const adminId = await createAdmin();
      await insert("shipping_provider_setting", {
        provider_code: "fake",
        settings: "{}",
        updated_by: adminId,
      });
      await client.query('delete from "admin_user" where id = $1', [adminId]);
      expect(
        await selectWhere("shipping_provider_setting", "provider_code = 'fake'"),
      ).toMatchObject({ updated_by: null });
      await expectViolation(
        () =>
          insert("shipping_provider_setting", {
            provider_code: "other",
            settings: "{}",
            updated_by: randomUUID(),
          }),
        FOREIGN_KEY_VIOLATION,
        "shipping_provider_setting_updated_by_fkey",
      );
    });
  });

  describe("order_shipping", () => {
    it("accepts a snapshot, one per order, and rejects an unknown order or method", async () => {
      const { id: orderId } = await createOrder();
      const methodId = await createMethod();
      const created = await insert(
        "order_shipping",
        orderShippingRow(orderId, { method_id: methodId, estimated_carrier_amount: 700 }),
      );
      expect(created).toMatchObject({
        order_id: orderId,
        method_id: methodId,
        provider_code: null,
        destination: null,
        payer: "shop_charge",
      });
      expect(Number(created.amount)).toBe(500);
      expect(Number(created.estimated_carrier_amount)).toBe(700);
      await expectViolation(
        () => insert("order_shipping", orderShippingRow(orderId)),
        UNIQUE_VIOLATION,
        "order_shipping_pkey",
      );
      await expectViolation(
        () => insert("order_shipping", orderShippingRow(randomUUID())),
        FOREIGN_KEY_VIOLATION,
        "order_shipping_order_id_fkey",
      );
      const other = await createOrder();
      await expectViolation(
        () => insert("order_shipping", orderShippingRow(other.id, { method_id: randomUUID() })),
        FOREIGN_KEY_VIOLATION,
        "order_shipping_method_id_fkey",
      );
    });

    it("accepts amounts 0 to the maximum, rejects -1 and the maximum plus one", async () => {
      await expectBoundaries(
        async (amount) =>
          insert("order_shipping", orderShippingRow((await createOrder()).id, { amount })),
        "order_shipping_amount_check",
        [0, MAX_AMOUNT],
        [-1, MAX_AMOUNT + 1],
      );
      await expectBoundaries(
        async (estimated) =>
          insert(
            "order_shipping",
            orderShippingRow((await createOrder()).id, { estimated_carrier_amount: estimated }),
          ),
        "order_shipping_estimated_carrier_amount_check",
        [null, 0, MAX_AMOUNT],
        [-1, MAX_AMOUNT + 1],
      );
    });

    it("accepts every payer of core; the recipient paying the carrier means the shop charges 0", async () => {
      await expectBoundaries(
        async (payer) =>
          insert(
            "order_shipping",
            orderShippingRow((await createOrder()).id, { payer, amount: 0 }),
          ),
        "order_shipping_payer_check",
        [...SHIPPING_PAYERS],
        ["sender", "", "shop"],
      );
      await expectViolation(
        async () =>
          insert(
            "order_shipping",
            orderShippingRow((await createOrder()).id, {
              payer: "recipient_on_delivery",
              amount: 1,
            }),
          ),
        CHECK_VIOLATION,
        "order_shipping_payer_amount_check",
      );
    });

    it("has a destination object exactly for a pickup point", async () => {
      const pickup = (destination: Value) => async () =>
        insert(
          "order_shipping",
          orderShippingRow((await createOrder()).id, {
            kind: "pickup_point",
            provider_code: "fake",
            destination,
          }),
        );
      await expectAccepted(pickup(DESTINATION));
      for (const destination of [null, "[]", '"Branch 1"', "null"]) {
        await expectViolation(
          pickup(destination),
          CHECK_VIOLATION,
          "order_shipping_destination_check",
        );
      }
      for (const kind of ["address", "store_pickup"]) {
        await expectAccepted(async () =>
          insert("order_shipping", orderShippingRow((await createOrder()).id, { kind })),
        );
        await expectViolation(
          async () =>
            insert(
              "order_shipping",
              orderShippingRow((await createOrder()).id, { kind, destination: DESTINATION }),
            ),
          CHECK_VIOLATION,
          "order_shipping_destination_check",
        );
      }
    });

    it("checks codes, kind, title, currency and the provider service", async () => {
      const make = (extra: Row) => async () =>
        insert("order_shipping", orderShippingRow((await createOrder()).id, extra));
      await expectViolation(
        make({ method_code: "Courier" }),
        CHECK_VIOLATION,
        "order_shipping_method_code_check",
      );
      await expectViolation(
        make({ kind: "courier" }),
        CHECK_VIOLATION,
        "order_shipping_kind_check",
      );
      await expectViolation(
        make({ provider_code: "Fake" }),
        CHECK_VIOLATION,
        "order_shipping_provider_code_check",
      );
      await expectViolation(
        make({ provider_service: "warehouse" }),
        CHECK_VIOLATION,
        "order_shipping_provider_service_check",
      );
      await expectViolation(make({ title: "{}" }), CHECK_VIOLATION, "order_shipping_title_check");
      await expectViolation(
        make({ currency: "uah" }),
        CHECK_VIOLATION,
        "order_shipping_currency_check",
      );
      await expectAccepted(make({ provider_code: "fake", provider_service: "warehouse" }));
    });

    describe("immutability trigger", () => {
      async function createSnapshot(): Promise<{ orderId: string; methodId: string }> {
        const { id: orderId } = await createOrder();
        const methodId = await createMethod();
        await insert(
          "order_shipping",
          orderShippingRow(orderId, {
            method_id: methodId,
            kind: "pickup_point",
            provider_code: "fake",
            provider_service: "warehouse",
            destination: DESTINATION,
            estimated_carrier_amount: 700,
          }),
        );
        return { orderId, methodId };
      }
      const snapshot = (orderId: string) =>
        selectWhere("order_shipping", `order_id = '${orderId}'`);
      const updateAtDepthTwo = (orderId: string, assignments: string) =>
        runAtDepthTwo(`update "order_shipping" set ${assignments} where order_id = '${orderId}'`);

      it("rejects a direct UPDATE of any column, also a no-op and the SET NULL of the method", async () => {
        const { orderId } = await createSnapshot();
        const before = await snapshot(orderId);
        for (const assignment of [
          "method_code = 'other'",
          "kind = 'address', destination = NULL",
          "provider_code = 'other'",
          "provider_service = 'doors'",
          'title = \'{"uk":"x"}\'::jsonb',
          "amount = 0",
          "currency = 'USD'",
          "payer = 'recipient_on_delivery', amount = 0",
          "estimated_carrier_amount = NULL",
          "destination = '{}'::jsonb",
          "created_at = now()",
          "order_id = order_id",
          "method_id = NULL",
          "amount = amount",
        ]) {
          await expectViolation(
            () =>
              client.query(`update "order_shipping" set ${assignment} where order_id = $1`, [
                orderId,
              ]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        expect(await snapshot(orderId)).toEqual(before);
      });

      it("rejects a direct DELETE, also of every row at once", async () => {
        const { orderId } = await createSnapshot();
        await expectViolation(
          () => client.query('delete from "order_shipping" where order_id = $1', [orderId]),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => client.query('delete from "order_shipping"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await count("order_shipping", `order_id = '${orderId}'`)).toBe(1);
      });

      describe("changes at trigger depth above 1 (what only a referential action may do)", () => {
        it("accepts the SET NULL of method_id alone", async () => {
          const { orderId } = await createSnapshot();
          const before = await snapshot(orderId);
          await updateAtDepthTwo(orderId, "method_id = NULL");
          expect(await snapshot(orderId)).toEqual({ ...before, method_id: null });
        });

        it("rejects the SET NULL of method_id together with a change of any other column", async () => {
          const { orderId } = await createSnapshot();
          const before = await snapshot(orderId);
          for (const assignment of [
            "method_id = NULL, amount = 1",
            "method_id = NULL, method_code = 'other'",
            'method_id = NULL, title = \'{"uk":"x"}\'::jsonb',
            "method_id = NULL, destination = '{}'::jsonb",
            "method_id = NULL, estimated_carrier_amount = NULL",
          ]) {
            await expectViolation(
              () => updateAtDepthTwo(orderId, assignment),
              RESTRICT_VIOLATION,
              undefined,
            );
          }
          expect(await snapshot(orderId)).toEqual(before);
        });

        it("rejects a change of another column alone, and pointing method_id at a method again", async () => {
          const { orderId } = await createSnapshot();
          const otherMethodId = await createMethod();
          for (const assignment of [
            "amount = 1",
            "currency = 'USD'",
            `method_id = '${otherMethodId}'`,
          ]) {
            await expectViolation(
              () => updateAtDepthTwo(orderId, assignment),
              RESTRICT_VIOLATION,
              undefined,
            );
          }
          await updateAtDepthTwo(orderId, "method_id = NULL");
          await expectViolation(
            () => updateAtDepthTwo(orderId, `method_id = '${otherMethodId}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
        });

        it("accepts a DELETE", async () => {
          const { orderId } = await createSnapshot();
          await runAtDepthTwo(`delete from "order_shipping" where order_id = '${orderId}'`);
          expect(await count("order_shipping", `order_id = '${orderId}'`)).toBe(0);
        });
      });

      it("lets the delete of the method null method_id only, and the snapshot stays whole", async () => {
        const { orderId, methodId } = await createSnapshot();
        const before = await snapshot(orderId);
        await client.query('delete from "shipping_method" where id = $1', [methodId]);
        expect(await snapshot(orderId)).toEqual({ ...before, method_id: null });
      });

      it("is deleted with its order through the cascade", async () => {
        const { orderId } = await createSnapshot();
        await client.query('delete from "sales_order" where id = $1', [orderId]);
        expect(await count("order_shipping", `order_id = '${orderId}'`)).toBe(0);
      });
    });
  });

  describe("shipment", () => {
    it("accepts a pending shipment and applies the defaults", async () => {
      const order = await createOrder();
      const created = await insert("shipment", shipmentRow(order.id, order.number));
      expect(created).toMatchObject({
        status: "pending",
        provider_service: null,
        tracking_number: null,
        provider_ref: null,
        carrier_status_code: null,
        carrier_status_at: null,
        carrier_cost_amount: null,
        seats: SHIPPING_LIMITS.seatsPerShipment,
        tracking_attempts: 0,
        created_by: null,
        cancelled_at: null,
        delivered_at: null,
        next_track_at: null,
      });
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
    });

    it("accepts every status of core and rejects others", async () => {
      await expectBoundaries(
        async (status) => {
          const order = await createOrder();
          return insert("shipment", shipmentRow(order.id, order.number, { status }));
        },
        "shipment_status_check",
        [...SHIPMENT_STATUSES],
        ["shipped", "", "Pending"],
      );
    });

    it("allows one active shipment per order; a cancelled or failed one does not count", async () => {
      const order = await createOrder();
      const firstId = await insertId("shipment", shipmentRow(order.id, order.number));
      await expectViolation(
        () => insert("shipment", shipmentRow(order.id, order.number)),
        UNIQUE_VIOLATION,
        "shipment_order_id_active_key",
      );
      await expectViolation(
        () => insert("shipment", shipmentRow(order.id, order.number, { status: "delivered" })),
        UNIQUE_VIOLATION,
        "shipment_order_id_active_key",
      );
      await expectAccepted(() =>
        insert("shipment", shipmentRow(order.id, order.number, { status: "failed" })),
      );
      await client.query(`update "shipment" set status = 'cancelled' where id = $1`, [firstId]);
      await insert("shipment", shipmentRow(order.id, order.number, { status: "failed" }));
      await insert("shipment", shipmentRow(order.id, order.number));
      expect(await count("shipment", `order_id = '${order.id}'`)).toBe(3);
    });

    it("keeps tracking numbers unique per provider; many shipments may have none yet", async () => {
      await createShipment({ tracking_number: "20450000000001" });
      await expectViolation(
        () => createShipment({ tracking_number: "20450000000001" }),
        UNIQUE_VIOLATION,
        "shipment_provider_code_tracking_number_key",
      );
      await expectAccepted(() =>
        createShipment({ tracking_number: "20450000000001", provider_code: "other" }),
      );
      await createShipment();
      await createShipment();
      expect(await count("shipment", "tracking_number is null")).toBeGreaterThanOrEqual(2);
    });

    it("checks the carrier patterns, the order number reference and the codes", async () => {
      await expectBoundaries(
        (code) => createShipment({ carrier_status_code: code }),
        "shipment_carrier_status_code_check",
        [null, "1", "102", "Status.9-x_y", "x".repeat(32)],
        ["", "x".repeat(33), "has space", "Посилка"],
      );
      await expectBoundaries(
        (trackingNumber) => createShipment({ tracking_number: trackingNumber }),
        "shipment_tracking_number_check",
        [null, "20450000000001", "x".repeat(64)],
        ["", "x".repeat(65), "2045 0000", "a.b"],
      );
      await expectBoundaries(
        (providerRef) => createShipment({ provider_ref: providerRef }),
        "shipment_provider_ref_check",
        [null, randomUUID()],
        ["", "x".repeat(65), "a/b"],
      );
      await expectBoundaries(
        async (reference) => {
          const order = await createOrder();
          return insert(
            "shipment",
            shipmentRow(order.id, order.number, { client_reference: reference }),
          );
        },
        "shipment_client_reference_check",
        ["0000-0001", "ABCD-EFGH"],
        ["", "0000-000I", "abcd-efgh", "00000001"],
      );
      await expectBoundaries(
        (providerCode) => createShipment({ provider_code: providerCode }),
        "shipment_provider_code_check",
        ["nova_poshta"],
        ["", "Nova"],
      );
      await expectBoundaries(
        (service) => createShipment({ provider_service: service }),
        "shipment_provider_service_check",
        [null, "warehouse", "x".repeat(TEXT_LIMITS.code)],
        ["", "x".repeat(TEXT_LIMITS.code + 1)],
      );
      await expectBoundaries(
        (payer) => createShipment({ payer }),
        "shipment_payer_check",
        [...SHIPMENT_PAYERS],
        ["shop_charge", ""],
      );
      await expectBoundaries(
        (currency) => createShipment({ currency }),
        "shipment_currency_check",
        ["UAH"],
        ["uah", ""],
      );
    });

    it("keeps amounts within 0 and the maximum", async () => {
      await expectBoundaries(
        (amount) => createShipment({ declared_value_amount: amount }),
        "shipment_declared_value_amount_check",
        [0, MAX_AMOUNT],
        [-1, MAX_AMOUNT + 1],
      );
      await expectBoundaries(
        (amount) => createShipment({ carrier_cost_amount: amount }),
        "shipment_carrier_cost_amount_check",
        [null, 0, MAX_AMOUNT],
        [-1, MAX_AMOUNT + 1],
      );
    });

    it("needs a positive weight and size, one seat and non-negative tracking attempts", async () => {
      for (const column of ["weight_grams", "length_mm", "width_mm", "height_mm"]) {
        await expectBoundaries(
          (value) => createShipment({ [column]: value }),
          `shipment_${column}_check`,
          [1],
          [0, -1],
        );
      }
      await expectBoundaries(
        (seats) => createShipment({ seats }),
        "shipment_seats_check",
        [SHIPPING_LIMITS.seatsPerShipment],
        [0, SHIPPING_LIMITS.seatsPerShipment + 1],
      );
      await expectBoundaries(
        (attempts) => createShipment({ tracking_attempts: attempts }),
        "shipment_tracking_attempts_check",
        [0, 30],
        [-1],
      );
    });

    it("keeps an order with a shipment from being deleted, and rejects an unknown order", async () => {
      const { orderId } = await createShipment();
      await expectViolation(
        () => client.query('delete from "sales_order" where id = $1', [orderId]),
        FOREIGN_KEY_VIOLATION,
        "shipment_order_id_fkey",
      );
      await expectViolation(
        () => insert("shipment", shipmentRow(randomUUID(), "0000-0001")),
        FOREIGN_KEY_VIOLATION,
        "shipment_order_id_fkey",
      );
    });

    it("nulls created_by when the admin user is deleted", async () => {
      const adminId = await createAdmin();
      const { id } = await createShipment({ created_by: adminId });
      await client.query('delete from "admin_user" where id = $1', [adminId]);
      expect(await selectWhere("shipment", `id = '${id}'`)).toMatchObject({ created_by: null });
    });
  });

  describe("shipment_status_change", () => {
    it("accepts a change, applies the defaults and takes the time of the statement", async () => {
      const { id } = await createShipment();
      const created = await insert("shipment_status_change", changeRow(id));
      expect(created).toMatchObject({ carrier_status_code: null, actor_admin_id: null });
      await insert(
        "shipment_status_change",
        changeRow(id, { from_status: "pending", to_status: "created", carrier_status_code: "1" }),
      );
      // now() is constant inside the test transaction; clock_timestamp() is not (compared in microseconds, in SQL).
      const times = await client.query(
        `select count(distinct created_at)::int as count from "shipment_status_change" where shipment_id = $1`,
        [id],
      );
      expect(times.rows[0]).toEqual({ count: 2 });
    });

    it("checks statuses, the actor and the carrier code; rejects an unknown shipment or admin", async () => {
      const { id } = await createShipment();
      await expectViolation(
        () => insert("shipment_status_change", changeRow(id, { to_status: "shipped" })),
        CHECK_VIOLATION,
        "shipment_status_change_to_status_check",
      );
      await expectViolation(
        () => insert("shipment_status_change", changeRow(id, { from_status: "shipped" })),
        CHECK_VIOLATION,
        "shipment_status_change_from_status_check",
      );
      await expectViolation(
        () => insert("shipment_status_change", changeRow(id, { actor_type: "guest" })),
        CHECK_VIOLATION,
        "shipment_status_change_actor_type_check",
      );
      await expectViolation(
        () => insert("shipment_status_change", changeRow(id, { carrier_status_code: "a b" })),
        CHECK_VIOLATION,
        "shipment_status_change_carrier_status_code_check",
      );
      await expectViolation(
        () => insert("shipment_status_change", changeRow(randomUUID())),
        FOREIGN_KEY_VIOLATION,
        "shipment_status_change_shipment_id_fkey",
      );
      await expectViolation(
        () => insert("shipment_status_change", changeRow(id, { actor_admin_id: randomUUID() })),
        FOREIGN_KEY_VIOLATION,
        "shipment_status_change_actor_admin_id_fkey",
      );
    });

    describe("append-only trigger", () => {
      async function createChange(
        extra: Row = {},
      ): Promise<{ changeId: string; shipmentId: string }> {
        const { id: shipmentId } = await createShipment();
        const changeId = await insertId("shipment_status_change", changeRow(shipmentId, extra));
        return { changeId, shipmentId };
      }
      const change = (id: string) => selectWhere("shipment_status_change", `id = '${id}'`);
      const updateAtDepthTwo = (id: string, assignments: string) =>
        runAtDepthTwo(`update "shipment_status_change" set ${assignments} where id = '${id}'`);

      it("rejects a direct UPDATE of any column, also nulling the admin, and a direct DELETE", async () => {
        const adminId = await createAdmin();
        const { changeId } = await createChange({ actor_admin_id: adminId });
        const before = await change(changeId);
        for (const assignment of [
          "to_status = 'created'",
          "from_status = 'unknown'",
          "actor_type = 'system'",
          "carrier_status_code = '1'",
          "actor_admin_id = NULL",
          "created_at = now()",
          "to_status = to_status",
        ]) {
          await expectViolation(
            () =>
              client.query(`update "shipment_status_change" set ${assignment} where id = $1`, [
                changeId,
              ]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        await expectViolation(
          () => client.query('delete from "shipment_status_change" where id = $1', [changeId]),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => client.query('delete from "shipment_status_change"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await change(changeId)).toEqual(before);
      });

      it("allows SET NULL of actor_admin_id when the admin user is deleted, and nothing else changes", async () => {
        const adminId = await createAdmin();
        const { changeId } = await createChange({
          actor_admin_id: adminId,
          from_status: null,
          to_status: "pending",
        });
        const before = await change(changeId);
        await client.query('delete from "admin_user" where id = $1', [adminId]);
        expect(await change(changeId)).toEqual({ ...before, actor_admin_id: null });
      });

      it("is deleted with its shipment through the cascade, and the order stays", async () => {
        const { changeId, shipmentId } = await createChange();
        await client.query('delete from "shipment" where id = $1', [shipmentId]);
        expect(await count("shipment_status_change", `id = '${changeId}'`)).toBe(0);
      });

      describe("changes at trigger depth above 1 (what only a referential action may do)", () => {
        it("accepts an UPDATE that only nulls actor_admin_id", async () => {
          const adminId = await createAdmin();
          const { changeId } = await createChange({ actor_admin_id: adminId });
          const before = await change(changeId);
          await updateAtDepthTwo(changeId, "actor_admin_id = NULL");
          expect(await change(changeId)).toEqual({ ...before, actor_admin_id: null });
        });

        it("rejects an UPDATE that nulls actor_admin_id and changes another column", async () => {
          const adminId = await createAdmin();
          const { changeId } = await createChange({ actor_admin_id: adminId });
          for (const assignment of [
            "actor_admin_id = NULL, to_status = 'created'",
            "actor_admin_id = NULL, actor_type = 'system'",
            "actor_admin_id = NULL, carrier_status_code = '1'",
          ]) {
            await expectViolation(
              () => updateAtDepthTwo(changeId, assignment),
              RESTRICT_VIOLATION,
              undefined,
            );
          }
          expect(await change(changeId)).toMatchObject({ actor_admin_id: adminId });
        });

        it("rejects another column alone and an admin set to a value", async () => {
          const adminId = await createAdmin();
          const { changeId } = await createChange();
          await expectViolation(
            () => updateAtDepthTwo(changeId, "to_status = 'created'"),
            RESTRICT_VIOLATION,
            undefined,
          );
          await expectViolation(
            () => updateAtDepthTwo(changeId, `actor_admin_id = '${adminId}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
        });

        it("accepts a DELETE", async () => {
          const { changeId } = await createChange();
          await runAtDepthTwo(`delete from "shipment_status_change" where id = '${changeId}'`);
          expect(await count("shipment_status_change", `id = '${changeId}'`)).toBe(0);
        });
      });
    });
  });

  describe("triggers and indexes", () => {
    it("has exactly the two triggers of ADR 0029 on the shipping tables", async () => {
      const result = await client.query<{ table: string; name: string; definition: string }>(
        `select c.relname as "table", t.tgname as name, pg_get_triggerdef(t.oid) as definition
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and c.relname = any($1) order by c.relname`,
        [
          [
            "shipping_method",
            "shipping_provider_setting",
            "order_shipping",
            "shipment",
            "shipment_status_change",
          ],
        ],
      );
      expect(result.rows.map((row) => [row.table, row.name])).toEqual([
        ["order_shipping", "order_shipping_immutable"],
        ["shipment_status_change", "shipment_status_change_append_only"],
      ]);
      for (const row of result.rows) {
        expect(row.definition).toContain("BEFORE DELETE OR UPDATE");
        expect(row.definition).toContain("FOR EACH ROW");
      }
    });

    it("covers every foreign key of the new tables with an index that starts with its columns", async () => {
      const result = await client.query(
        `select c.conrelid::regclass::text as table_name, c.conname, a.attname as column_name
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.conrelid::regclass::text = any($1)
           and not exists (
             select 1 from pg_index i
             where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indpred is null
           )`,
        [
          [
            "shipping_method",
            "shipping_provider_setting",
            "order_shipping",
            "shipment",
            "shipment_status_change",
          ],
        ],
      );
      expect(result.rows).toEqual([]);
    });

    it("has the journal index by shipment and time", async () => {
      expect(await indexDefinition("shipment_status_change_shipment_id_created_at_idx")).toContain(
        "(shipment_id, created_at)",
      );
    });
  });

  describe("drizzle schema", () => {
    it("keeps every constraint, index and table name within 63 characters", () => {
      const tables: PgTable[] = [
        shippingSchema.shippingMethod,
        shippingSchema.shippingProviderSetting,
        shippingSchema.orderShipping,
        shippingSchema.shipment,
        shippingSchema.shipmentStatusChange,
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
