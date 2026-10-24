import { randomBytes, randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import pg from "pg";
import { formatOrderNumber } from "@fluxkit/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orderShipping, salesOrder, shippingMethod } from "../../database/schema/index.js";
import { testShippingProviders } from "../../test/test-shipping-provider.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SOME_ID } from "../../test/routes.js";

/** Codes of this file all start with this, so a cleanup never touches the rows of another spec file. */
const PREFIX = "m5spec_";

type Json = Record<string, unknown>;
interface Page {
  items: Json[];
  total: number;
  limit: number;
  offset: number;
}

const flat = (amount: number) => ({ type: "flat", amount });

function validBody(code: string, extra: Json = {}): Json {
  return {
    code: `${PREFIX}${code}`,
    title: { uk: "Курʼєр", en: "Courier" },
    kind: "address",
    pricing: flat(8000),
    countryCodes: ["UA"],
    ...extra,
  };
}

describe("admin shipping methods", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let owner: RunningApp;
  let db: Database;

  const create = (body: Json) =>
    http<Json & ProblemBody>(owner.baseUrl, "POST", "/admin/shipping/methods", { body });
  const errorsOf = (body: ProblemBody) => (body.errors ?? []).map((e) => `${e.path}:${e.code}`);

  async function made(code: string, extra: Json = {}): Promise<Json> {
    const result = await create(validBody(code, extra));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  async function placeOrderWith(methodId: string): Promise<string> {
    const [row] = await db
      .insert(salesOrder)
      .values({
        number: formatOrderNumber(randomBytes(5)),
        status: "awaiting_payment",
        email: "buyer@example.test",
        phone: "+380501234567",
        firstName: "Ann",
        lastName: "Buyer",
        locale: "uk",
        currency: "UAH",
        subtotalAmount: 2000,
        shippingTotal: 8000,
        discountTotal: 0,
        taxTotal: 0,
        totalAmount: 10000,
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      })
      .returning({ id: salesOrder.id });
    if (row === undefined) {
      throw new Error("order not inserted");
    }
    await db.insert(orderShipping).values({
      orderId: row.id,
      methodId,
      methodCode: "courier",
      kind: "address",
      title: { uk: "Курʼєр" },
      amount: 8000,
      currency: "UAH",
      payer: "shop_charge",
    });
    return row.id;
  }

  beforeAll(async () => {
    await ensureMigrated();
    owner = await startApp({ extraShippingProviders: testShippingProviders() });
    db = owner.app.get<Database>(DRIZZLE);
  });

  afterEach(async () => {
    // Orders first: their snapshots link the methods (and a snapshot can only go with its order).
    await pool.query(
      `delete from sales_order where id in (select order_id from order_shipping where method_code = 'courier' and method_id in (select id from shipping_method where code like $1))`,
      [`${PREFIX}%`],
    );
    await db.delete(shippingMethod).where(like(shippingMethod.code, `${PREFIX}%`));
  });

  afterAll(async () => {
    await owner.app.close();
    await pool.end();
  });

  describe("create and read", () => {
    it("creates an INACTIVE method in the shop currency and points Location at it", async () => {
      const result = await create(
        validBody("basic", { description: { uk: "Доставка додому" }, providerCode: null }),
      );
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({
        code: `${PREFIX}basic`,
        title: { uk: "Курʼєр", en: "Courier" },
        description: { uk: "Доставка додому" },
        kind: "address",
        providerCode: null,
        providerService: null,
        pricing: { type: "flat", amount: 8000 },
        currency: "UAH",
        countryCodes: ["UA"],
        isActive: false,
        position: 0,
      });
      expect(result.headers.get("location")).toBe(
        `/admin/shipping/methods/${String(result.body.id)}`,
      );
      const [row] = await db
        .select()
        .from(shippingMethod)
        .where(eq(shippingMethod.id, String(result.body.id)));
      expect(row).toMatchObject({
        isActive: false,
        currency: "UAH",
        pricing: { type: "flat", amount: 8000 },
      });
    });

    it("can create an active method when the admin says so, with an enabled provider and a service", async () => {
      const result = await create(
        validBody("pickup", {
          kind: "pickup_point",
          providerCode: "fake",
          providerService: "warehouse",
          isActive: true,
          position: 3,
          pricing: { type: "carrier_on_delivery" },
        }),
      );
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({
        kind: "pickup_point",
        providerCode: "fake",
        providerService: "warehouse",
        isActive: true,
        position: 3,
        pricing: { type: "carrier_on_delivery" },
      });
    });

    it("creates a store pickup method whose text is the description, with no provider", async () => {
      const result = await create(
        validBody("store", {
          kind: "store_pickup",
          description: { uk: "Забрати у магазині" },
          pricing: flat(0),
        }),
      );
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({
        kind: "store_pickup",
        providerCode: null,
        description: { uk: "Забрати у магазині" },
      });
    });

    it("normalizes the stored pricing (core output), and stores all four shapes", async () => {
      const shapes: Json[] = [
        flat(0),
        { type: "free_over", amount: 8000, freeFrom: 200000 },
        {
          type: "tiers",
          tiers: [
            { fromSubtotal: 0, amount: 12000 },
            { fromSubtotal: 100000, amount: 6000 },
          ],
        },
        { type: "carrier_on_delivery" },
      ];
      for (const [index, pricing] of shapes.entries()) {
        const result = await create(validBody(`shape${String(index)}`, { pricing }));
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        expect(result.body.pricing).toEqual(pricing);
      }
    });

    it("gets one method, 404 for an unknown id, 400 for a malformed id", async () => {
      const created = await made("get");
      const got = await http<Json>(
        owner.baseUrl,
        "GET",
        `/admin/shipping/methods/${String(created.id)}`,
      );
      expect(got.status).toBe(200);
      expect(got.body).toEqual(created);
      const missing = await http<ProblemBody>(
        owner.baseUrl,
        "GET",
        `/admin/shipping/methods/${SOME_ID}`,
      );
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ code: "not_found" });
      const bad = await http<ProblemBody>(
        owner.baseUrl,
        "GET",
        "/admin/shipping/methods/not-a-uuid",
      );
      expect(bad.status).toBe(400);
      expect(errorsOf(bad.body)).toEqual(["id:invalid_format"]);
    });

    it("lists a page ordered by position then code, with total, limit and offset", async () => {
      await made("c", { position: 2 });
      await made("a", { position: 2 });
      await made("b", { position: 1 });
      const all = await http<Page>(owner.baseUrl, "GET", "/admin/shipping/methods?limit=100");
      expect(all.status).toBe(200);
      const mine = all.body.items.filter((item) => String(item.code).startsWith(PREFIX));
      expect(mine.map((item) => item.code)).toEqual([`${PREFIX}b`, `${PREFIX}a`, `${PREFIX}c`]);
      expect(all.body).toMatchObject({ limit: 100, offset: 0 });
      expect(all.body.total).toBeGreaterThanOrEqual(3);

      const firstOfMine = all.body.items.findIndex((item) => item.code === `${PREFIX}b`);
      const page = await http<Page>(
        owner.baseUrl,
        "GET",
        `/admin/shipping/methods?limit=2&offset=${String(firstOfMine)}`,
      );
      expect(page.body.items.map((item) => item.code)).toEqual([`${PREFIX}b`, `${PREFIX}a`]);
      expect(page.body).toMatchObject({ limit: 2, offset: firstOfMine });

      const bad = await http<ProblemBody>(owner.baseUrl, "GET", "/admin/shipping/methods?limit=0");
      expect(bad.status).toBe(400);
    });
  });

  describe("create validation", () => {
    it("refuses an unknown or extra field, among them currency and id (the server decides both)", async () => {
      const result = await create(validBody("extra", { currency: "USD", id: SOME_ID }));
      expect(result.status).toBe(400);
      expect(errorsOf(result.body).sort()).toEqual(["currency:unknown_field", "id:unknown_field"]);
    });

    it("refuses a bad code, kind, country list and position", async () => {
      const result = await create({
        code: "Bad Code",
        title: { uk: "x" },
        kind: "teleport",
        pricing: flat(1),
        countryCodes: ["ua", "UA", "UKR"],
        position: -1,
      });
      expect(result.status).toBe(400);
      expect(errorsOf(result.body)).toEqual(
        expect.arrayContaining([
          "code:invalid_code",
          "kind:invalid_value",
          "countryCodes.0:invalid_format",
          "countryCodes.2:invalid_format",
          "position:too_small",
        ]),
      );
      const empty = await create(validBody("nocountry", { countryCodes: [] }));
      expect(errorsOf(empty.body)).toEqual(["countryCodes:too_small"]);
      const duplicate = await create(validBody("dup", { countryCodes: ["UA", "PL", "UA"] }));
      expect(errorsOf(duplicate.body)).toEqual(["countryCodes.2:duplicate_country"]);
    });

    it("answers the core reason of every pricing fault, at pricing.<field>", async () => {
      const cases: [Json, string[]][] = [
        [{ type: "teleport" }, ["pricing.type:unknown_type"]],
        [{ amount: 1 }, ["pricing.type:required"]],
        [{ type: "flat" }, ["pricing.amount:required"]],
        [{ type: "flat", amount: 12.5 }, ["pricing.amount:not_an_integer"]],
        [{ type: "flat", amount: -1 }, ["pricing.amount:out_of_range"]],
        [{ type: "flat", amount: 1e15 }, ["pricing.amount:out_of_range"]],
        [{ type: "flat", amount: 100, currency: "UAH" }, ["pricing.currency:unknown_field"]],
        [{ type: "free_over", amount: 1 }, ["pricing.freeFrom:required"]],
        [{ type: "tiers", tiers: [] }, ["pricing.tiers:no_tiers"]],
        [
          { type: "tiers", tiers: [{ fromSubtotal: 100, amount: 1 }] },
          ["pricing.tiers.0.fromSubtotal:first_tier_not_zero"],
        ],
        [
          {
            type: "tiers",
            tiers: [
              { fromSubtotal: 0, amount: 1 },
              { fromSubtotal: 500, amount: 1 },
              { fromSubtotal: 100, amount: 1 },
            ],
          },
          ["pricing.tiers.2.fromSubtotal:tiers_not_sorted"],
        ],
        [
          {
            type: "tiers",
            tiers: [
              { fromSubtotal: 0, amount: 1 },
              { fromSubtotal: 0, amount: 2 },
            ],
          },
          ["pricing.tiers.1.fromSubtotal:duplicate_tier"],
        ],
      ];
      for (const [pricing, expected] of cases) {
        const result = await create(validBody("bad", { pricing }));
        expect(result.status, JSON.stringify(pricing)).toBe(400);
        expect(errorsOf(result.body), JSON.stringify(pricing)).toEqual(expected);
      }
      const hostile = await http<ProblemBody>(owner.baseUrl, "POST", "/admin/shipping/methods", {
        rawBody: JSON.stringify(validBody("bad")).replace(
          '"pricing":{"type":"flat","amount":8000}',
          '"pricing":{"type":"flat","amount":8000,"__proto__":{"amount":1}}',
        ),
      });
      expect(hostile.status).toBe(400);
      expect(errorsOf(hostile.body)).toEqual(["pricing.__proto__:unknown_field"]);
      const notObject = await create(validBody("bad", { pricing: [] }));
      expect(notObject.status).toBe(400);
      expect(errorsOf(notObject.body)).toEqual(["pricing:invalid_type"]);
      const none = await db.$count(shippingMethod, like(shippingMethod.code, `${PREFIX}bad`));
      expect(none).toBe(0);
    });

    it("applies the locale rules to the title and the description", async () => {
      const result = await create(
        validBody("text", { title: { en: "only english" }, description: { fr: "x" } }),
      );
      expect(result.status).toBe(400);
      expect(errorsOf(result.body).sort()).toEqual([
        "description.fr:locale_not_allowed",
        "description.uk:default_locale_missing",
        "title.uk:default_locale_missing",
      ]);
    });

    it("needs an enabled provider for a pickup point and for any provider a method names", async () => {
      const noProvider = await create(validBody("p1", { kind: "pickup_point" }));
      expect(errorsOf(noProvider.body)).toEqual(["providerCode:provider_required"]);
      const unknown = await create(
        validBody("p2", { kind: "pickup_point", providerCode: "nova_poshta" }),
      );
      expect(errorsOf(unknown.body)).toEqual(["providerCode:provider_not_enabled"]);
      const unknownOnAddress = await create(validBody("p3", { providerCode: "nova_poshta" }));
      expect(errorsOf(unknownOnAddress.body)).toEqual(["providerCode:provider_not_enabled"]);
      const serviceAlone = await create(validBody("p4", { providerService: "doors" }));
      expect(errorsOf(serviceAlone.body)).toEqual(["providerService:provider_required"]);
      expect(await db.$count(shippingMethod, like(shippingMethod.code, `${PREFIX}p_`))).toBe(0);
    });

    it("answers 409 conflict naming the code when it is taken", async () => {
      await made("taken");
      const again = await create(validBody("taken"));
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: "conflict", field: "code" });
    });
  });

  describe("update", () => {
    it("changes only the named fields and refreshes updatedAt", async () => {
      const created = await made("patch", { description: { uk: "Опис" } });
      const result = await http<Json>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        {
          body: { title: { uk: "Нова назва" }, position: 5, isActive: true, description: null },
        },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        code: created.code,
        title: { uk: "Нова назва" },
        description: null,
        position: 5,
        isActive: true,
        pricing: { type: "flat", amount: 8000 },
        countryCodes: ["UA"],
      });
      expect(String(result.body.updatedAt) > String(created.updatedAt)).toBe(true);
    });

    it("replaces the whole pricing, validated by core, and stamps the shop currency", async () => {
      const created = await made("repr");
      await pool.query("update shipping_method set currency = 'USD' where id = $1", [created.id]);
      const bad = await http<ProblemBody>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        {
          body: { pricing: { type: "flat", amount: 1.5 } },
        },
      );
      expect(bad.status).toBe(400);
      expect(errorsOf(bad.body)).toEqual(["pricing.amount:not_an_integer"]);
      const ok = await http<Json>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        {
          body: { pricing: { type: "free_over", amount: 5000, freeFrom: 100000 } },
        },
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        pricing: { type: "free_over", amount: 5000, freeFrom: 100000 },
        currency: "UAH",
      });
    });

    it("never changes the code, and an empty patch changes nothing", async () => {
      const created = await made("fixed");
      const rename = await http<ProblemBody>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        {
          body: { code: "renamed" },
        },
      );
      expect(rename.status).toBe(400);
      expect(errorsOf(rename.body)).toEqual(["code:unknown_field"]);
      const empty = await http<Json>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        { body: {} },
      );
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual(created);
      const missing = await http<ProblemBody>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${SOME_ID}`,
        {
          body: { position: 1 },
        },
      );
      expect(missing.status).toBe(404);
    });

    it("validates the merged kind and provider, not only the patch", async () => {
      const created = await made("merge");
      const toPickup = await http<ProblemBody>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        {
          body: { kind: "pickup_point" },
        },
      );
      expect(toPickup.status).toBe(400);
      expect(errorsOf(toPickup.body)).toEqual(["providerCode:provider_required"]);
      const withProvider = await http<Json>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        {
          body: { kind: "pickup_point", providerCode: "fake" },
        },
      );
      expect(withProvider.status).toBe(200);
      const dropProvider = await http<ProblemBody>(
        owner.baseUrl,
        "PATCH",
        `/admin/shipping/methods/${String(created.id)}`,
        {
          body: { providerCode: null },
        },
      );
      expect(errorsOf(dropProvider.body)).toEqual(["providerCode:provider_required"]);
    });

    it("lets an admin deactivate or reprice a method whose provider is no longer enabled, but not activate it", async () => {
      const created = await made("gone");
      await pool.query(
        "update shipping_method set provider_code = 'retired', is_active = true where id = $1",
        [created.id],
      );
      const path = `/admin/shipping/methods/${String(created.id)}`;
      const reprice = await http<Json>(owner.baseUrl, "PATCH", path, {
        body: { pricing: flat(100), position: 4 },
      });
      expect(reprice.status).toBe(200);
      const off = await http<Json>(owner.baseUrl, "PATCH", path, { body: { isActive: false } });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ isActive: false, providerCode: "retired" });
      const on = await http<ProblemBody>(owner.baseUrl, "PATCH", path, {
        body: { isActive: true },
      });
      expect(on.status).toBe(400);
      expect(errorsOf(on.body)).toEqual(["providerCode:provider_not_enabled"]);
    });
  });

  describe("delete", () => {
    it("deletes a method no order used, then answers 404", async () => {
      const created = await made("del");
      const path = `/admin/shipping/methods/${String(created.id)}`;
      const deleted = await http(owner.baseUrl, "DELETE", path);
      expect(deleted.status).toBe(204);
      expect(deleted.body).toBeUndefined();
      expect((await http(owner.baseUrl, "GET", path)).status).toBe(404);
      expect((await http(owner.baseUrl, "DELETE", path)).status).toBe(404);
    });

    it("refuses to delete a method an order used (409 rule_violation method_in_use), but lets it be deactivated", async () => {
      const created = await made("used", { isActive: true });
      const id = String(created.id);
      await placeOrderWith(id);
      const refused = await http<ProblemBody>(
        owner.baseUrl,
        "DELETE",
        `/admin/shipping/methods/${id}`,
      );
      expect(refused.status).toBe(409);
      expect(refused.headers.get("content-type")).toContain("application/problem+json");
      expect(refused.body).toMatchObject({
        code: "rule_violation",
        rule: "method_in_use",
        status: 409,
      });
      expect(await db.$count(shippingMethod, eq(shippingMethod.id, id))).toBe(1);
      expect(await db.$count(orderShipping, eq(orderShipping.methodId, id))).toBe(1);

      const off = await http<Json>(owner.baseUrl, "PATCH", `/admin/shipping/methods/${id}`, {
        body: { isActive: false },
      });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ isActive: false });
      const still = await http<ProblemBody>(
        owner.baseUrl,
        "DELETE",
        `/admin/shipping/methods/${id}`,
      );
      expect(still.status).toBe(409);
    });

    it("cannot lose a race with an order being placed: a delete waits for the open order and then refuses", async () => {
      const created = await made("race", { isActive: true });
      const id = String(created.id);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const order = await client.query<{ id: string }>(
          `insert into sales_order (number, status, email, phone, first_name, last_name, locale, currency,
             subtotal_amount, shipping_total, discount_total, tax_total, total_amount, idempotency_key, request_fingerprint, expires_at)
           values ($1, 'awaiting_payment', 'race@example.test', '+380501234567', 'Ann', 'Buyer', 'uk', 'UAH',
             2000, 8000, 0, 0, 10000, $2, $3, '2099-01-01T00:00:00Z') returning id`,
          [formatOrderNumber(randomBytes(5)), randomUUID(), "b".repeat(64)],
        );
        await client.query(
          `insert into order_shipping (order_id, method_id, method_code, kind, title, amount, currency, payer)
           values ($1, $2, 'courier', 'address', '{"uk":"Курʼєр"}', 8000, 'UAH', 'shop_charge')`,
          [order.rows[0]?.id, id],
        );
        // The order is not committed yet: a plain "is it used?" read would still say no.
        const pending = http<ProblemBody>(owner.baseUrl, "DELETE", `/admin/shipping/methods/${id}`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await client.query("commit");
        const result = await pending;
        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({ code: "rule_violation", rule: "method_in_use" });
        expect(await db.$count(shippingMethod, eq(shippingMethod.id, id))).toBe(1);
      } finally {
        client.release();
      }
    });
  });
});
