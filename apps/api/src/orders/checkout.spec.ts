import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { customer as customerTable } from "../database/schema/index.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { itemsOfCart, cartRowsOfToken, deepKeys, type CartResult } from "../test/cart-helpers.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  ADDRESS,
  changesOf,
  checkoutAs,
  checkoutBody,
  eventsOf,
  itemsOf,
  orderRow,
  orderTableCounts,
  reservationsOfOrder,
  type CheckoutResult,
} from "../test/order-http.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { Shopper, setCookieOf } from "../test/shopper.js";
import { CheckoutService } from "./checkout.service.js";
import { OrdersRepository } from "./orders.repository.js";

const START = new Date("2034-03-01T08:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PASSWORD = "correct horse battery staple";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const NUMBER = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("checkout: POST /store/checkout (real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  const customers: string[] = [];
  let running: RunningApp;
  let db: Database;
  let shopper: Shopper;

  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const cartOf = async (who: Shopper) => (await who.get<CartResult>("/store/cart")).body;

  /** A physical, tracked variant with stock. */
  const stocked = (onHand = 5, price = 2_500, extra: Record<string, unknown> = {}) =>
    catalog.simple({ trackInventory: true, onHand, price, ...extra });

  const levelOfVariant = async (variantId: string) =>
    (
      await pool.query<{ on_hand: number; reserved: number }>(
        "select on_hand, reserved from inventory_level where variant_id = $1",
        [variantId],
      )
    ).rows[0];

  async function place(
    who: Shopper,
    total: number,
    overrides: Record<string, unknown> = {},
    key: string | null = randomUUID(),
  ) {
    const result = await checkoutAs(who, checkoutBody(total, overrides), key);
    if (result.status === 201 || result.status === 200) {
      placedOrders.track(result.body.order?.number ?? "");
    }
    return result;
  }

  async function newCustomer(): Promise<TestCustomer> {
    const made = await createTestCustomer(db, { password: PASSWORD });
    customers.push(made.id);
    return made;
  }

  async function signedIn(who: Shopper, account: TestCustomer): Promise<void> {
    const result = await who.post("/store/account/login", {
      email: account.email,
      password: PASSWORD,
    });
    expect(result.status).toBe(200);
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: { checkout: { maxAttempts: 1000, windowMinutes: 10 } },
    });
    db = running.app.get<Database>(DRIZZLE);
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
    shopper = new Shopper(running.baseUrl);
  });

  afterEach(async () => {
    await placedOrders.cleanup();
    await deleteTestCustomers(db, customers.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  describe("a guest places an order", () => {
    it("answers 201 with the order and the access token, and stores the whole order in one go", async () => {
      const { variantId, productId } = await catalog.simple({
        trackInventory: true,
        onHand: 5,
        price: 2_500,
        compareAt: 3_000,
        productTitle: { uk: "Футболка", en: "Tee" },
      });
      await catalog.media(productId, "https://cdn.example.test/tee.jpg", 0);
      await add(shopper, variantId, 2);
      const cartToken = shopper.cookie("fluxkit_cart") ?? "";
      const key = randomUUID();
      const placedAt = clock.now();

      const result = await checkoutAs(shopper, checkoutBody(5_000), key);

      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.headers.get("cache-control")).toBe("no-store");
      const { order, accessToken } = result.body;
      placedOrders.track(order?.number ?? "");
      expect(accessToken).toMatch(TOKEN);
      expect(order).toEqual({
        number: expect.stringMatching(NUMBER),
        status: "awaiting_payment",
        placedAt: placedAt.toISOString(),
        expiresAt: new Date(placedAt.getTime() + 30 * MINUTE).toISOString(),
        currency: "UAH",
        items: [
          {
            sku: expect.any(String),
            productTitle: "Футболка",
            variantTitle: null,
            optionValues: [],
            imageUrl: "https://cdn.example.test/tee.jpg",
            unitPrice: { amount: 2_500, currency: "UAH" },
            compareAtAmount: 3_000,
            quantity: 2,
            lineTotal: { amount: 5_000, currency: "UAH" },
          },
        ],
        subtotal: { amount: 5_000, currency: "UAH" },
        shippingTotal: { amount: 0, currency: "UAH" },
        discountTotal: { amount: 0, currency: "UAH" },
        taxTotal: { amount: 0, currency: "UAH" },
        total: { amount: 5_000, currency: "UAH" },
        adjustments: [],
        contact: {
          email: "buyer@example.test",
          phone: "+380501234567",
          firstName: "Іван",
          lastName: "Петренко",
        },
        shippingAddress: ADDRESS,
        billingAddress: null,
        history: [{ status: "awaiting_payment", at: expect.any(String) }],
      });

      const row = await orderRow(pool, order?.number ?? "");
      expect(row).toMatchObject({
        status: "awaiting_payment",
        customer_id: null,
        email: "buyer@example.test",
        phone: "+380501234567",
        first_name: "Іван",
        last_name: "Петренко",
        locale: "uk",
        currency: "UAH",
        subtotal_amount: "5000",
        shipping_total: "0",
        discount_total: "0",
        tax_total: "0",
        total_amount: "5000",
        idempotency_key: key,
        access_token_hash: sha256(accessToken ?? ""),
        paid_at: null,
        cancelled_at: null,
        expired_at: null,
      });
      expect(row.placed_at).toEqual(placedAt);
      expect(row.expires_at).toEqual(new Date(placedAt.getTime() + 30 * MINUTE));
      expect(row.access_expires_at).toEqual(new Date(placedAt.getTime() + 90 * DAY));
      expect(row.request_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.shipping_address).toEqual(ADDRESS);

      const [item] = await itemsOf(pool, row.id);
      expect(item).toMatchObject({
        position: 0,
        product_id: productId,
        variant_id: variantId,
        product_title: { uk: "Футболка", en: "Tee" },
        variant_title: null,
        option_values: [],
        image_url: "https://cdn.example.test/tee.jpg",
        unit_amount: "2500",
        compare_at_amount: "3000",
        quantity: 2,
        line_total: "5000",
        currency: "UAH",
        requires_shipping: true,
      });

      // The stock is held: one reservation per line, named by the order number, ten minutes longer than the order.
      const [held] = await reservationsOfOrder(pool, row.id);
      expect(held).toMatchObject({
        variant_id: variantId,
        quantity: 2,
        status: "active",
        reference: row.number,
        order_item_id: item?.id,
      });
      expect(held?.expires_at).toEqual(new Date(placedAt.getTime() + 40 * MINUTE));
      const level = await pool.query(
        "select on_hand, reserved from inventory_level where variant_id = $1",
        [variantId],
      );
      expect(level.rows).toEqual([{ on_hand: 5, reserved: 2 }]);

      // The journal and the outbox, in the same transaction, without personal data.
      expect(await changesOf(pool, row.id)).toEqual([
        {
          from_status: null,
          to_status: "awaiting_payment",
          actor_type: "guest",
          actor_admin_id: null,
          reason: null,
        },
      ]);
      const events = await eventsOf(pool, row.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "order.placed",
        aggregate_id: row.id,
        payload: { orderId: row.id, orderNumber: row.number, status: "awaiting_payment" },
        dispatched_at: null,
      });
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual([
        "orderId",
        "orderNumber",
        "status",
      ]);

      // The cart is emptied in the same transaction; the row and the cookie stay.
      expect(await cartOf(shopper)).toMatchObject({ lines: [], itemCount: 0 });
      const [cartRow] = await cartRowsOfToken(pool, cartToken);
      expect(cartRow).toBeDefined();
      expect(await itemsOfCart(pool, cartRow?.id ?? "")).toEqual([]);
      expect(setCookieOf(result, "fluxkit_cart")).toContain(cartToken);
    });

    it("stores the option values and the full translated texts of a variant of a product with options", async () => {
      const product = await catalog.product({
        withColors: true,
        title: { uk: "Худі", en: "Hoodie" },
      });
      const variantId = await catalog.variant(product.id, {
        color: "red",
        price: 4_000,
        title: { uk: "Червоне", en: "Red one" },
      });
      await catalog.media(product.id, "https://cdn.example.test/red.jpg", 1, { color: "red" });
      await catalog.media(product.id, "https://cdn.example.test/gallery.jpg", 0);
      await add(shopper, variantId, 1);

      const result = await checkoutAs(shopper, checkoutBody(4_000, { locale: "en" }));
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      placedOrders.track(result.body.order?.number ?? "");
      // Resolved to the requested locale in the response ...
      expect(result.body.order?.items?.[0]).toMatchObject({
        productTitle: "Hoodie",
        variantTitle: "Red one",
        optionValues: [{ option: "Color", value: "Red" }],
        imageUrl: "https://cdn.example.test/red.jpg",
      });
      // ... but stored in every locale, so the history renders in any locale.
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect(row.locale).toBe("en");
      const [item] = await itemsOf(pool, row.id);
      expect(item?.product_title).toEqual({ uk: "Худі", en: "Hoodie" });
      expect(item?.variant_title).toEqual({ uk: "Червоне", en: "Red one" });
      expect(item?.option_values).toEqual([
        { option: { uk: "Колір", en: "Color" }, value: { uk: "Червоний", en: "Red" } },
      ]);
    });

    it("sums several lines exactly and keeps them in cart order", async () => {
      const a = await stocked(10, 1_999);
      const b = await stocked(10, 333);
      const c = await catalog.simple({ price: 10, digital: true });
      await add(shopper, a.variantId, 3);
      await add(shopper, b.variantId, 7);
      await add(shopper, c.variantId, 999);
      const expected = 3 * 1_999 + 7 * 333 + 999 * 10;

      const result = await place(shopper, expected);
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.order?.total).toEqual({ amount: expected, currency: "UAH" });
      expect(result.body.order?.items?.map((item) => item.quantity)).toEqual([3, 7, 999]);
      expect(result.body.order?.items?.map((item) => item.lineTotal.amount)).toEqual([
        5_997, 2_331, 9_990,
      ]);
      // The two tracked lines hold stock; the untracked one holds none.
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect(await reservationsOfOrder(pool, row.id)).toHaveLength(2);
    });
  });

  describe("a signed-in customer places an order", () => {
    it("201 without an access token, the account email by default, owned by the customer", async () => {
      const account = await newCustomer();
      await signedIn(shopper, account);
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 1);
      const body = checkoutBody(1_000);
      delete body["email"];

      const result = await checkoutAs(shopper, body);
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      placedOrders.track(result.body.order?.number ?? "");
      expect(result.body).not.toHaveProperty("accessToken");
      expect(result.body.order?.contact.email).toBe(account.email);

      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect(row.customer_id).toBe(account.id);
      expect(row.access_token_hash).toBeNull();
      expect(row.access_expires_at).toBeNull();
      expect((await changesOf(pool, row.id))[0]).toMatchObject({ actor_type: "customer" });
    });

    it("keeps an email the customer sends explicitly, and takes the cart of the account, not a guest cookie", async () => {
      const account = await newCustomer();
      await signedIn(shopper, account);
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 2);
      const result = await place(shopper, 2_000, { email: "Other@Example.Test" });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.order?.contact.email).toBe("other@example.test");
      expect(await cartOf(shopper)).toMatchObject({ lines: [] });
    });

    it("a customer session that is not valid any more is a guest again (the guest cart is used)", async () => {
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 1);
      shopper.setCookie("fluxkit_customer_session", "A".repeat(43));
      const result = await place(shopper, 1_000);
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.accessToken).toMatch(TOKEN);
    });
  });

  describe("shipping address", () => {
    it("an order of digital goods only needs none, and holds no stock", async () => {
      const { variantId } = await catalog.simple({ price: 700, digital: true });
      await add(shopper, variantId, 2);
      const body = checkoutBody(1_400);
      delete body["shippingAddress"];
      const result = await checkoutAs(shopper, body);
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      placedOrders.track(result.body.order?.number ?? "");
      expect(result.body.order?.shippingAddress).toBeNull();
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect(row.shipping_address).toBeNull();
      expect(await reservationsOfOrder(pool, row.id)).toEqual([]);
      expect((await itemsOf(pool, row.id))[0]?.requires_shipping).toBe(false);
    });

    it("a digital order accepts and stores an address and a billing address when they are sent", async () => {
      const { variantId } = await catalog.simple({ price: 700, digital: true });
      await add(shopper, variantId, 1);
      const billing = { countryCode: "PL", city: "Kraków", line1: "Rynek 1" };
      const result = await place(shopper, 700, { billingAddress: billing });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.order?.shippingAddress).toEqual(ADDRESS);
      expect(result.body.order?.billingAddress).toEqual(billing);
    });

    it("one physical line is enough to require it: 400 shipping_address_required, nothing reserved, cart intact", async () => {
      const digital = await catalog.simple({ price: 100, digital: true });
      const physical = await stocked(5, 200);
      await add(shopper, digital.variantId, 1);
      await add(shopper, physical.variantId, 1);
      const before = await orderTableCounts(pool, [physical.variantId]);
      const body = checkoutBody(300);
      delete body["shippingAddress"];
      const result = await checkoutAs(shopper, body);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({
        code: "validation_failed",
        errors: [{ path: "shippingAddress", code: "shipping_address_required" }],
      });
      expect(await orderTableCounts(pool, [physical.variantId])).toEqual(before);
      expect((await cartOf(shopper)).lines).toHaveLength(2);
    });
  });

  describe("validation", () => {
    async function expectRefusedWithoutTrace(
      body: Record<string, unknown>,
      key: string | null,
      expected: { path: string; code: string }[],
    ) {
      const who = new Shopper(running.baseUrl);
      const { variantId } = await stocked(5, 1_000);
      await add(who, variantId, 1);
      const before = await orderTableCounts(pool, [variantId]);
      const result = await checkoutAs(who, body, key);
      expect(result.status, JSON.stringify(result.body)).toBe(400);
      expect(result.body).toMatchObject({ code: "validation_failed" });
      const errors = (result.body.errors ?? []).map(({ path, code }) => ({ path, code }));
      expect(errors).toEqual(expect.arrayContaining(expected));
      expect(await orderTableCounts(pool, [variantId])).toEqual(before);
      expect((await cartOf(who)).lines).toHaveLength(1);
    }

    it("requires the Idempotency-Key header", async () => {
      await expectRefusedWithoutTrace(checkoutBody(1_000), null, [
        { path: "Idempotency-Key", code: "idempotency_key_required" },
      ]);
    });

    it.each([
      "",
      "abc",
      "123e4567-e89b-12d3-a456",
      `${randomUUID()}x`,
      `${randomUUID()}, ${randomUUID()}`,
    ])("refuses the malformed Idempotency-Key %j", async (key) => {
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 1);
      const result = await shopper.request<CheckoutResult>("POST", "/store/checkout", {
        body: checkoutBody(1_000),
        headers: { "idempotency-key": key },
      });
      expect(result.status, JSON.stringify(result.body)).toBe(400);
      expect(result.body.errors?.[0]).toMatchObject({ path: "Idempotency-Key" });
    });

    it("reports every bad field at once with its path", async () => {
      await expectRefusedWithoutTrace(
        checkoutBody(1_000, {
          email: "nope",
          phone: "12",
          firstName: " ",
          lastName: "x".repeat(101),
          shippingAddress: { countryCode: "ukr", city: "", line1: "a" },
          billingAddress: { city: "Київ" },
          expectedTotal: { amount: 1.5, currency: "XXX" },
        }),
        randomUUID(),
        [
          { path: "email", code: "invalid_format" },
          { path: "phone", code: "too_short" },
          { path: "firstName", code: "empty" },
          { path: "lastName", code: "too_long" },
          { path: "shippingAddress.countryCode", code: "invalid_format" },
          { path: "shippingAddress.city", code: "empty" },
          { path: "billingAddress.countryCode", code: "required" },
          { path: "billingAddress.line1", code: "required" },
          { path: "expectedTotal.amount", code: "not_an_integer" },
        ],
      );
    });

    it("refuses unknown fields, a missing expectedTotal and a locale that is not configured", async () => {
      await expectRefusedWithoutTrace(
        checkoutBody(1_000, { total: 1, customerId: randomUUID(), unitPrice: 1 }),
        randomUUID(),
        [
          { path: "total", code: "unknown_field" },
          { path: "customerId", code: "unknown_field" },
          { path: "unitPrice", code: "unknown_field" },
        ],
      );
      const body = checkoutBody(1_000);
      delete body["expectedTotal"];
      await expectRefusedWithoutTrace(body, randomUUID(), [
        { path: "expectedTotal", code: "required" },
      ]);
      await expectRefusedWithoutTrace(checkoutBody(1_000, { locale: "xx" }), randomUUID(), [
        { path: "locale", code: "invalid_value" },
      ]);
    });

    it("a guest must send an email", async () => {
      const body = checkoutBody(1_000);
      delete body["email"];
      await expectRefusedWithoutTrace(body, randomUUID(), [{ path: "email", code: "required" }]);
    });
  });

  describe("the cart", () => {
    it("409 cart_empty for a shopper without a cart, with an empty cart and with an expired cart", async () => {
      const none = await checkoutAs(shopper, checkoutBody(1));
      expect(none.status).toBe(409);
      expect(none.body).toMatchObject({ code: "cart_empty" });

      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 1);
      await shopper.delete(`/store/cart/items/${variantId}`);
      const emptied = await checkoutAs(shopper, checkoutBody(1_000));
      expect(emptied.status).toBe(409);
      expect(emptied.body).toMatchObject({ code: "cart_empty" });

      await add(shopper, variantId, 1);
      clock.advanceMinutes(31 * 24 * 60);
      const expired = await checkoutAs(shopper, checkoutBody(1_000));
      expect(expired.status).toBe(409);
      expect(expired.body).toMatchObject({ code: "cart_empty" });
    });

    it("409 cart_changed with the fresh cart when a price moved, and nothing is reserved; the new total then works", async () => {
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 2);
      const before = await orderTableCounts(pool, [variantId]);
      await catalog.setPrice(variantId, 1_200);

      const stale = await checkoutAs(shopper, checkoutBody(2_000));
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: "cart_changed" });
      const fresh = stale.body as unknown as { cart: CartResult };
      expect(fresh.cart.total).toEqual({ amount: 2_400, currency: "UAH" });
      expect(fresh.cart.lines[0]?.notices).toEqual([
        { code: "price_changed", previousAmount: { amount: 1_000, currency: "UAH" } },
      ]);
      expect(await orderTableCounts(pool, [variantId])).toEqual(before);
      expect((await cartOf(shopper)).lines).toHaveLength(1);

      const agreed = await place(shopper, 2_400);
      expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
      expect(agreed.body.order?.total.amount).toBe(2_400);
    });

    it("the expected total is a consent check only: a lower one never becomes the price", async () => {
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 3);
      const before = await orderTableCounts(pool, [variantId]);
      for (const lie of [1, 0, 2_999, 3_001]) {
        const result = await checkoutAs(shopper, checkoutBody(lie));
        expect(result.status, String(lie)).toBe(409);
        expect(result.body).toMatchObject({ code: "cart_changed" });
      }
      expect(await orderTableCounts(pool, [variantId])).toEqual(before);
      const honest = await place(shopper, 3_000);
      expect(honest.body.order?.total.amount).toBe(3_000);
    });

    it("409 cart_changed with an unavailable notice when a line cannot be bought any more", async () => {
      const kept = await stocked(5, 1_000);
      const gone = await stocked(5, 500);
      await add(shopper, kept.variantId, 1);
      await add(shopper, gone.variantId, 1);
      await catalog.setActive(gone.variantId, false);
      const result = await checkoutAs(shopper, checkoutBody(1_000));
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "cart_changed" });
      const fresh = (result.body as unknown as { cart: CartResult }).cart;
      expect(fresh.purchasable).toBe(false);
      expect(fresh.lines[1]?.notices).toEqual([{ code: "unavailable" }]);
      expect((await cartOf(shopper)).lines).toHaveLength(2);
    });

    it("an unpublished product is unavailable too, and so is a variant that lost its shop price", async () => {
      const a = await stocked(5, 1_000);
      const b = await stocked(5, 1_000);
      await add(shopper, a.variantId, 1);
      await catalog.setProductStatus(a.productId, "draft");
      expect((await checkoutAs(shopper, checkoutBody(1_000))).body).toMatchObject({
        code: "cart_changed",
      });
      await catalog.setProductStatus(a.productId, "active");
      await shopper.delete(`/store/cart/items/${a.variantId}`);
      await add(shopper, b.variantId, 1);
      await catalog.deletePrice(b.variantId);
      expect((await checkoutAs(shopper, checkoutBody(1_000))).body).toMatchObject({
        code: "cart_changed",
      });
    });
  });

  describe("stock refusals are all or nothing and name every line", () => {
    it("409 checkout_refused lists each short line by its position in the cart; nothing is reserved or changed", async () => {
      const fine = await stocked(5, 1_000);
      const shortOne = await stocked(1, 1_000);
      const shortTwo = await stocked(2, 1_000);
      await add(shopper, fine.variantId, 2);
      await add(shopper, shortOne.variantId, 2);
      await add(shopper, shortTwo.variantId, 3);
      const variants = [fine.variantId, shortOne.variantId, shortTwo.variantId];
      const before = await orderTableCounts(pool, variants);

      const result = await checkoutAs(shopper, checkoutBody(7_000));
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body).toMatchObject({
        code: "checkout_refused",
        errors: [
          { path: "lines.1", code: "insufficient_stock" },
          { path: "lines.2", code: "insufficient_stock" },
        ],
      });
      // Not even the line that fit holds anything, and not even an empty level row appeared.
      expect(await orderTableCounts(pool, variants)).toEqual(before);
      expect((await cartOf(shopper)).lines.map((line) => line.quantity)).toEqual([2, 2, 3]);
      // The body tells nothing about the stock that is left.
      expect(JSON.stringify(result.body)).not.toMatch(/on_?hand|available|"reserved"/i);
    });

    it("a tracked variant that never had stock is refused, and a backorder variant is accepted", async () => {
      const nothing = await catalog.simple({ trackInventory: true, price: 500 });
      await add(shopper, nothing.variantId, 1);
      const refused = await checkoutAs(shopper, checkoutBody(500));
      expect(refused.body).toMatchObject({
        code: "checkout_refused",
        errors: [{ path: "lines.0", code: "insufficient_stock" }],
      });
      await shopper.delete(`/store/cart/items/${nothing.variantId}`);

      const backorder = await catalog.simple({
        trackInventory: true,
        allowBackorder: true,
        price: 500,
      });
      await add(shopper, backorder.variantId, 4);
      const accepted = await place(shopper, 2_000);
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
      const level = await pool.query(
        "select on_hand, reserved from inventory_level where variant_id = $1",
        [backorder.variantId],
      );
      expect(level.rows).toEqual([{ on_hand: 0, reserved: 4 }]);
    });

    it("409 checkout_refused line_total_out_of_range when a price rose past what a line can hold", async () => {
      const { variantId } = await stocked(5, 1_000_000_000);
      await add(shopper, variantId, 999);
      await catalog.setPrice(variantId, 1_000_000_000_000);
      // The shopper can still read the cart (the line is marked, not a 409), and the checkout still refuses it.
      const read = await shopper.get<CartResult>("/store/cart");
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(read.body.lines[0]?.notices).toEqual([{ code: "line_total_out_of_range" }]);
      expect(read.body.purchasable).toBe(false);
      const result = await checkoutAs(shopper, checkoutBody(1));
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body).toMatchObject({
        code: "checkout_refused",
        errors: [{ path: "lines.0", code: "line_total_out_of_range" }],
      });
    });
  });

  describe("totals are exact, also at the limit", () => {
    it("999 units at the largest unit price that fits is exactly 999 x price", async () => {
      const { variantId } = await catalog.simple({ price: 1_001_001_001, digital: true });
      await add(shopper, variantId, 999);
      const expected = 999 * 1_001_001_001;
      expect(expected).toBe(999_999_999_999);
      const result = await place(shopper, expected);
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.order?.total.amount).toBe(999_999_999_999);
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect(row.total_amount).toBe("999999999999");
      expect((await itemsOf(pool, row.id))[0]?.line_total).toBe("999999999999");
    });

    it("two lines that add up to exactly the money limit are accepted, one unit more is refused", async () => {
      const a = await catalog.simple({ price: 400_000_000_000, digital: true });
      const b = await catalog.simple({ price: 500_000_000_000, digital: true });
      const c = await catalog.simple({ price: 1, digital: true });
      await add(shopper, a.variantId, 1);
      await add(shopper, b.variantId, 1);
      await add(shopper, c.variantId, 1);
      // A price rose after the lines were added: 10^12 + 1 does not fit, and the checkout refuses it as the cart does.
      await catalog.setPrice(a.variantId, 500_000_000_000);
      const over = await checkoutAs(shopper, checkoutBody(1));
      expect(over.status, JSON.stringify(over.body)).toBe(409);
      expect(over.body).toMatchObject({ code: "rule_violation", rule: "subtotal_out_of_range" });

      await shopper.delete(`/store/cart/items/${c.variantId}`);
      const exact = await place(shopper, 1_000_000_000_000);
      expect(exact.status, JSON.stringify(exact.body)).toBe(201);
      expect(exact.body.order?.total.amount).toBe(1_000_000_000_000);
    });

    it("matches an independent BigInt sum over a mixed cart", async () => {
      const prices = [1, 7, 99, 12_345, 987_654_321];
      const quantities = [999, 3, 250, 17, 1];
      const lines = await Promise.all(
        prices.map((price) => catalog.simple({ price, digital: true })),
      );
      for (const [index, line] of lines.entries()) {
        await add(shopper, line.variantId, quantities[index] ?? 1);
      }
      const expected = prices.reduce(
        (sum, price, index) => sum + BigInt(price) * BigInt(quantities[index] ?? 0),
        0n,
      );
      const result = await place(shopper, Number(expected));
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(BigInt(result.body.order?.total.amount ?? -1)).toBe(expected);
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect(BigInt(row.subtotal_amount)).toBe(expected);
    });
  });

  describe("the order is a snapshot", () => {
    it("does not change when the catalog changes, and survives the deletion of its variant and product", async () => {
      const { variantId, productId } = await catalog.simple({
        price: 900,
        digital: true,
        productTitle: { uk: "Курс", en: "Course" },
      });
      await catalog.media(productId, "https://cdn.example.test/course.jpg", 0);
      await add(shopper, variantId, 2);
      const result = await place(shopper, 1_800);
      const number = result.body.order?.number ?? "";
      const token = result.body.accessToken ?? "";
      const row = await orderRow(pool, number);
      const before = (await itemsOf(pool, row.id))[0];

      await catalog.setPrice(variantId, 5_000);
      await pool.query("update product set title = $2::jsonb where id = $1", [
        productId,
        JSON.stringify({ uk: "Інша назва", en: "Another title" }),
      ]);
      await pool.query("delete from media where product_id = $1", [productId]);
      const afterChange = await shopper.post<CheckoutResult>("/store/orders/lookup", {
        number,
        accessToken: token,
      });
      expect(afterChange.status).toBe(200);
      expect(afterChange.body).toEqual(result.body.order);

      // A sold digital variant has no stock rows, so the database lets it go: the line keeps its snapshot.
      await pool.query("delete from product where id = $1", [productId]);
      const [after] = await itemsOf(pool, row.id);
      expect(after).toMatchObject({ ...before, product_id: null, variant_id: null });
      const lookup = await shopper.post<CheckoutResult>("/store/orders/lookup", {
        number,
        accessToken: token,
      });
      expect(lookup.status).toBe(200);
      expect(lookup.body).toEqual(result.body.order);
    });
  });

  describe("retries", () => {
    const FIXED_BYTES = Uint8Array.from([1, 2, 3, 4, 5]);
    const OTHER_BYTES = Uint8Array.from([9, 8, 7, 6, 5]);

    it("a collision of the order number retries with a new number (at most 5 attempts) without losing the cart locks", async () => {
      const service = running.app.get(CheckoutService);
      const spy = vi.spyOn(service, "nextOrderNumberBytes");
      try {
        const { variantId } = await stocked(10, 1_000);
        const first = new Shopper(running.baseUrl);
        await add(first, variantId, 1);
        spy.mockReturnValue(FIXED_BYTES);
        const one = await place(first, 1_000);
        expect(one.status, JSON.stringify(one.body)).toBe(201);
        const taken = one.body.order?.number ?? "";

        // The next order draws the taken number twice, then a free one: it still succeeds, with the third number.
        const second = new Shopper(running.baseUrl);
        await add(second, variantId, 1);
        spy.mockReset();
        spy
          .mockReturnValueOnce(FIXED_BYTES)
          .mockReturnValueOnce(FIXED_BYTES)
          .mockReturnValue(OTHER_BYTES);
        const two = await place(second, 1_000);
        expect(two.status, JSON.stringify(two.body)).toBe(201);
        expect(two.body.order?.number).not.toBe(taken);
        expect(spy).toHaveBeenCalledTimes(3);
        expect(await levelOfVariant(variantId)).toEqual({ on_hand: 10, reserved: 2 });
      } finally {
        spy.mockRestore();
      }
    });

    it("five collisions in a row fail loudly (500), and leave no order, no hold and the cart intact", async () => {
      const service = running.app.get(CheckoutService);
      const spy = vi.spyOn(service, "nextOrderNumberBytes");
      try {
        const { variantId } = await stocked(10, 1_000);
        const taken = new Shopper(running.baseUrl);
        await add(taken, variantId, 1);
        spy.mockReturnValue(FIXED_BYTES);
        expect((await place(taken, 1_000)).status).toBe(201);

        const who = new Shopper(running.baseUrl);
        await add(who, variantId, 1);
        const before = await orderTableCounts(pool, [variantId]);
        spy.mockClear();
        const failed = await checkoutAs(who, checkoutBody(1_000));
        expect(failed.status).toBe(500);
        expect(failed.body).toMatchObject({ code: "internal_error" });
        expect(spy).toHaveBeenCalledTimes(5);
        expect(await orderTableCounts(pool, [variantId])).toEqual(before);
        expect((await cartOf(who)).lines).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    function deadlock(): Error {
      const error = new pg.DatabaseError("deadlock detected buyer@example.test", 0, "error");
      error.code = "40P01";
      return error;
    }

    it("a deadlock is retried once and the checkout then succeeds; the retry is logged without personal data", async () => {
      const repository = running.app.get(OrdersRepository);
      const original = repository.insertOrder.bind(repository);
      const warnings: string[] = [];
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
      const spy = vi
        .spyOn(repository, "insertOrder")
        .mockImplementationOnce(() => Promise.reject(deadlock()))
        .mockImplementation(original);
      try {
        const { variantId } = await stocked(5, 1_000);
        await add(shopper, variantId, 2);
        const result = await place(shopper, 2_000);
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        expect(spy).toHaveBeenCalledTimes(2);
        expect(warnings.some((message) => message.includes("Deadlock"))).toBe(true);
        expect(warnings.join("")).not.toContain("buyer@example.test");
        expect(await levelOfVariant(variantId)).toEqual({ on_hand: 5, reserved: 2 });
      } finally {
        spy.mockRestore();
        warn.mockRestore();
      }
    });

    it("two deadlocks in a row answer 503 service_unavailable with Retry-After and leave nothing behind", async () => {
      const repository = running.app.get(OrdersRepository);
      const spy = vi
        .spyOn(repository, "insertOrder")
        .mockImplementation(() => Promise.reject(deadlock()));
      try {
        const { variantId } = await stocked(5, 1_000);
        await add(shopper, variantId, 2);
        const before = await orderTableCounts(pool, [variantId]);
        const result = await checkoutAs(shopper, checkoutBody(2_000));
        expect(result.status).toBe(503);
        expect(result.body).toMatchObject({ code: "service_unavailable", status: 503 });
        expect(result.headers.get("retry-after")).toMatch(/^\d+$/);
        expect(result.headers.get("cache-control")).toBe("no-store");
        expect(spy).toHaveBeenCalledTimes(2);
        expect(await orderTableCounts(pool, [variantId])).toEqual(before);
        expect((await cartOf(shopper)).lines).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("access, CSRF and limits", () => {
    it("needs the CSRF header and a JSON body (403 before anything else)", async () => {
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 1);
      const without = await shopper.request<CheckoutResult>("POST", "/store/checkout", {
        body: checkoutBody(1_000),
        csrf: false,
        headers: { "idempotency-key": randomUUID() },
      });
      expect(without.status).toBe(403);
      const wrongType = await shopper.request<CheckoutResult>("POST", "/store/checkout", {
        rawBody: JSON.stringify(checkoutBody(1_000)),
        contentType: "text/plain",
        headers: { "idempotency-key": randomUUID() },
      });
      expect(wrongType.status).toBe(403);
      expect((await cartOf(shopper)).lines).toHaveLength(1);
    });

    it("never accepts a cart, customer or price from the request", async () => {
      const mine = await stocked(5, 1_000);
      const theirs = await stocked(5, 1_000);
      const other = new Shopper(running.baseUrl);
      await add(other, theirs.variantId, 4);
      await add(shopper, mine.variantId, 1);
      const result = await place(shopper, 1_000, { cartId: "x" });
      expect(result.status).toBe(400);
      const ok = await place(shopper, 1_000);
      expect(ok.status).toBe(201);
      expect((await cartOf(other)).lines).toHaveLength(1);
      expect(
        await pool.query("select count(*)::int as n from order_item where variant_id = $1", [
          theirs.variantId,
        ]),
      ).toMatchObject({ rows: [{ n: 0 }] });
    });

    it("answers 429 with Retry-After after the limit of the address, counting refused calls too", async () => {
      const limited = await startApp({
        adminAuthenticator: "production-default",
        clock,
        rateLimits: { checkout: { maxAttempts: 3, windowMinutes: 10 } },
      });
      try {
        const who = new Shopper(limited.baseUrl);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          expect((await checkoutAs(who, checkoutBody(1))).status).toBe(409);
        }
        const blocked = await checkoutAs(who, checkoutBody(1));
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
        expect(blocked.body).toMatchObject({ code: "too_many_requests" });
        expect(blocked.headers.get("cache-control")).toBe("no-store");
        clock.advanceMinutes(11);
        expect((await checkoutAs(who, checkoutBody(1))).status).toBe(409);
      } finally {
        await limited.app.close();
      }
    });
  });

  describe("secrecy", () => {
    it("a response never carries internal ids of other rows, hashes, keys, fingerprints or stock numbers", async () => {
      const { variantId } = await stocked(5, 1_000);
      await add(shopper, variantId, 1);
      const key = randomUUID();
      const result = await checkoutAs(shopper, checkoutBody(1_000), key);
      placedOrders.track(result.body.order?.number ?? "");
      const row = await orderRow(pool, result.body.order?.number ?? "");
      const text = JSON.stringify(result.body);
      for (const secret of [
        row.id,
        row.access_token_hash ?? "",
        row.request_fingerprint,
        key,
        variantId,
      ]) {
        expect(text, secret).not.toContain(secret);
      }
      const keys = deepKeys(result.body);
      for (const forbidden of [
        "id",
        "orderId",
        "variantId",
        "productId",
        "reservation",
        "reservations",
        "accessTokenHash",
        "idempotencyKey",
        "requestFingerprint",
        "onHand",
        "reserved",
        "customerId",
        "actorAdminId",
      ]) {
        expect(keys.has(forbidden), forbidden).toBe(false);
      }
    });

    it("logs carry no email, phone, address, name, token or idempotency key, on success and on failure", async () => {
      const lines: string[] = [];
      const capture = (chunk: unknown): boolean => {
        lines.push(String(chunk));
        return true;
      };
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(capture);
      const key = randomUUID();
      const secretBody = checkoutBody(1_000, {
        email: "secret.person@example.test",
        phone: "+380509998877",
        firstName: "Секретний",
        lastName: "Покупець",
        shippingAddress: { countryCode: "UA", city: "Секретне місто", line1: "Таємна вулиця 7" },
      });
      const tokens: string[] = [];
      try {
        const { variantId } = await stocked(1, 1_000);
        await add(shopper, variantId, 1);
        // A refused checkout (stock) and a placed one.
        await shopper.patch(`/store/cart/items/${variantId}`, { quantity: 1 });
        await catalog.setStock(variantId, 0, 0);
        const refused = await checkoutAs(shopper, secretBody, key);
        expect(refused.status).toBe(409);
        await catalog.setStock(variantId, 1, 0);
        const placed = await checkoutAs(shopper, secretBody, key);
        expect(placed.status, JSON.stringify(placed.body)).toBe(201);
        placedOrders.track(placed.body.order?.number ?? "");
        tokens.push(placed.body.accessToken ?? "");
        // And one that fails with a validation error and one that is an unexpected error path (unknown field).
        await checkoutAs(shopper, { ...secretBody, phone: "1" }, randomUUID());
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
      }
      const logged = lines.join("");
      for (const secret of [
        "secret.person@example.test",
        "380509998877",
        "Секретний",
        "Покупець",
        "Секретне місто",
        "Таємна вулиця",
        key,
        ...tokens,
      ]) {
        expect(secret.length).toBeGreaterThan(5);
        expect(logged, secret).not.toContain(secret);
      }
    });
  });

  it("the customer row is not needed to exist for the guest path: a deleted customer's orders keep their contact data", async () => {
    const account = await newCustomer();
    await signedIn(shopper, account);
    const { variantId } = await stocked(5, 1_000);
    await add(shopper, variantId, 1);
    const result = await place(shopper, 1_000);
    expect(result.status).toBe(201);
    const number = result.body.order?.number ?? "";
    await db.delete(customerTable).where(eq(customerTable.id, account.id));
    const row = await orderRow(pool, number);
    expect(row.customer_id).toBeNull();
    expect(row.email).toBe("buyer@example.test");
    expect(row.access_token_hash).toBeNull();
  });
});
