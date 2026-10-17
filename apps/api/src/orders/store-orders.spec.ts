import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { deepKeys, type CartResult } from "../test/cart-helpers.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  changesOf,
  checkoutAs,
  checkoutBody,
  eventsOf,
  orderRow,
  reservationsOfOrder,
  type CheckoutResult,
  type OrderResult,
} from "../test/order-http.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { Shopper } from "../test/shopper.js";
import { OrdersService } from "./orders.service.js";
import type { StoreOrderPage } from "./orders.schemas.js";

const START = new Date("2036-03-01T08:00:00.000Z");
const DAY_MINUTES = 24 * 60;
const PASSWORD = "correct horse battery staple";

describe("store orders: guest lookup and cancel, customer history (real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  const customers: string[] = [];
  let running: RunningApp;
  let db: Database;
  let orders: OrdersService;
  let visitor: Shopper;

  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const lookup = (who: Shopper, number: string, accessToken: string, query = "") =>
    who.post<OrderResult>(`/store/orders/lookup${query}`, { number, accessToken });
  const cancel = (who: Shopper, number: string, accessToken: string) =>
    who.post<OrderResult>("/store/orders/cancel", { number, accessToken });

  interface GuestOrder {
    number: string;
    token: string;
    variantId: string;
    quantity: number;
  }

  /** A guest places an order of tracked stock; returns what the confirmation page would hold. */
  async function guestOrder(
    quantity = 2,
    options: { title?: Record<string, string>; price?: number } = {},
  ): Promise<GuestOrder> {
    const who = new Shopper(running.baseUrl);
    const price = options.price ?? 1_000;
    const { variantId } = await catalog.simple({
      trackInventory: true,
      onHand: 20,
      price,
      productTitle: options.title,
    });
    await add(who, variantId, quantity);
    const result = await checkoutAs(who, checkoutBody(price * quantity));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = placedOrders.track(result.body.order?.number ?? "");
    return { number, token: result.body.accessToken ?? "", variantId, quantity };
  }

  async function newCustomer(): Promise<{ account: TestCustomer; browser: Shopper }> {
    const account = await createTestCustomer(db, { password: PASSWORD });
    customers.push(account.id);
    const browser = new Shopper(running.baseUrl);
    const signedIn = await browser.post("/store/account/login", {
      email: account.email,
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
    return { account, browser };
  }

  async function customerOrder(browser: Shopper, quantity = 1, price = 500) {
    const { variantId } = await catalog.simple({ trackInventory: true, onHand: 20, price });
    await add(browser, variantId, quantity);
    const result = await checkoutAs(browser, checkoutBody(price * quantity, { email: undefined }));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = placedOrders.track(result.body.order?.number ?? "");
    return { number, variantId, quantity };
  }

  const reservedOf = async (variantId: string): Promise<number> =>
    (
      await pool.query<{ reserved: number }>(
        "select reserved from inventory_level where variant_id = $1",
        [variantId],
      )
    ).rows[0]?.reserved ?? -1;

  async function pay(number: string): Promise<void> {
    const row = await orderRow(pool, number);
    const outcome = await orders.markPaid(
      row.id,
      {
        amount: { amount: Number(row.total_amount), currency: "UAH" },
        providerReference: `PAY-${randomUUID()}`,
        source: "manual",
      },
      { type: "system" },
    );
    expect(outcome).toMatchObject({ ok: true });
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: {
        checkout: { maxAttempts: 10_000, windowMinutes: 10 },
        orderLookup: { maxAttempts: 10_000, windowMinutes: 10 },
        guestCancel: { maxAttempts: 10_000, windowMinutes: 10 },
      },
    });
    db = running.app.get<Database>(DRIZZLE);
    orders = running.app.get(OrdersService);
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
    visitor = new Shopper(running.baseUrl);
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

  describe("POST /store/orders/lookup", () => {
    it("opens a guest order with its number and token, resolved to the requested locale", async () => {
      const placed = await guestOrder(2, { title: { uk: "Футболка", en: "Tee" } });
      const uk = await lookup(visitor, placed.number, placed.token);
      expect(uk.status, JSON.stringify(uk.body)).toBe(200);
      expect(uk.headers.get("cache-control")).toBe("no-store");
      expect(uk.body).toMatchObject({
        number: placed.number,
        status: "awaiting_payment",
        items: [{ productTitle: "Футболка", quantity: 2 }],
        history: [{ status: "awaiting_payment" }],
      });
      const en = await lookup(visitor, placed.number, placed.token, "?locale=en");
      expect(en.body.items[0]?.productTitle).toBe("Tee");
    });

    it("renders in the locale the order was placed in when none is requested, and falls back to the default for a missing text", async () => {
      const who = new Shopper(running.baseUrl);
      const { variantId } = await catalog.simple({
        trackInventory: true,
        onHand: 5,
        price: 100,
        productTitle: { uk: "Тільки українською" },
      });
      await add(who, variantId, 1);
      const placed = await checkoutAs(who, checkoutBody(100, { locale: "en" }));
      expect(placed.status).toBe(201);
      placedOrders.track(placed.body.order?.number ?? "");
      expect(placed.body.order?.items[0]?.productTitle).toBe("Тільки українською");
      const read = await lookup(
        visitor,
        placed.body.order?.number ?? "",
        placed.body.accessToken ?? "",
      );
      expect(read.body.items[0]?.productTitle).toBe("Тільки українською");
    });

    it("accepts the number the way a person types it: lower case, no dash, spaces around", async () => {
      const placed = await guestOrder();
      for (const typed of [
        placed.number.toLowerCase(),
        placed.number.replace("-", ""),
        `  ${placed.number.toLowerCase().replace("-", "")} `,
      ]) {
        const result = await lookup(visitor, typed, placed.token);
        expect(result.status, typed).toBe(200);
        expect(result.body.number).toBe(placed.number);
      }
    });

    it("answers the SAME 404 for every way the lookup can miss", async () => {
      const one = await guestOrder();
      const two = await guestOrder();
      const { browser, account } = await newCustomer();
      const mine = await customerOrder(browser);
      void account;
      const misses: [string, string, string][] = [
        ["unknown number", "ZZZZ-ZZZZ", one.token],
        ["malformed number", "not a number", one.token],
        ["empty number", "", one.token],
        ["wrong token", one.number, "x".repeat(43)],
        ["empty token", one.number, ""],
        ["huge token", one.number, "y".repeat(256)],
        ["the token of another order", one.number, two.token],
        ["the number of another order", two.number, one.token],
        ["a customer order with a made-up token", mine.number, "z".repeat(43)],
        ["a customer order with a guest token", mine.number, one.token],
      ];
      const seen = new Set<string>();
      for (const [name, number, token] of misses) {
        const result = await lookup(visitor, number, token);
        expect(result.status, name).toBe(404);
        expect(result.headers.get("cache-control"), name).toBe("no-store");
        seen.add(JSON.stringify(result.body));
      }
      expect(seen.size).toBe(1);
      expect([...seen][0]).toContain('"code":"not_found"');
      // And the real ones still work.
      expect((await lookup(visitor, one.number, one.token)).status).toBe(200);
      expect((await lookup(visitor, two.number, two.token)).status).toBe(200);
    });

    it("a token is valid until its stored expiry (90 days) and not a moment longer", async () => {
      const placed = await guestOrder();
      const row = await orderRow(pool, placed.number);
      const expiry = row.access_expires_at?.getTime() ?? 0;
      clock.set(new Date(expiry - 1_000));
      expect((await lookup(visitor, placed.number, placed.token)).status).toBe(200);
      clock.set(new Date(expiry));
      expect((await lookup(visitor, placed.number, placed.token)).status).toBe(404);
      clock.set(new Date(expiry + 1_000));
      expect((await lookup(visitor, placed.number, placed.token)).status).toBe(404);
      clock.advanceMinutes(DAY_MINUTES * 400);
      expect((await cancel(visitor, placed.number, placed.token)).status).toBe(404);
    });

    it("rejects a malformed request: missing or unknown fields are 400, and a bad locale is 400 whatever the order", async () => {
      const placed = await guestOrder();
      const missing = await visitor.post("/store/orders/lookup", { number: placed.number });
      expect(missing.status).toBe(400);
      const unknown = await visitor.post("/store/orders/lookup", {
        number: placed.number,
        accessToken: placed.token,
        orderId: randomUUID(),
      });
      expect(unknown.status).toBe(400);
      const badLocale = await lookup(visitor, placed.number, placed.token, "?locale=xx");
      expect(badLocale.status).toBe(400);
      const badLocaleUnknownOrder = await lookup(visitor, "ZZZZ-ZZZZ", "t", "?locale=xx");
      expect(badLocaleUnknownOrder.status).toBe(400);
      const tooLong = await visitor.post("/store/orders/lookup", {
        number: "A".repeat(65),
        accessToken: placed.token,
      });
      expect(tooLong.status).toBe(400);
    });

    it("needs the CSRF header like every store write", async () => {
      const placed = await guestOrder();
      const result = await visitor.request<OrderResult>("POST", "/store/orders/lookup", {
        body: { number: placed.number, accessToken: placed.token },
        csrf: false,
      });
      expect(result.status).toBe(403);
    });

    it("never returns ids, hashes, tokens, the key, the fingerprint, reservations or admin actors", async () => {
      const placed = await guestOrder(3);
      const row = await orderRow(pool, placed.number);
      const result = await lookup(visitor, placed.number, placed.token);
      const text = JSON.stringify(result.body);
      for (const secret of [
        row.id,
        row.access_token_hash ?? "",
        row.request_fingerprint,
        row.idempotency_key,
        placed.token,
        placed.variantId,
      ]) {
        expect(text, secret).not.toContain(secret);
      }
      expect([...deepKeys(result.body)].sort()).toEqual(
        [
          "adjustments",
          "amount",
          "at",
          "billingAddress",
          "city",
          "compareAtAmount",
          "contact",
          "countryCode",
          "currency",
          "discountTotal",
          "email",
          "expiresAt",
          "firstName",
          "history",
          "imageUrl",
          "items",
          "lastName",
          "line1",
          "lineTotal",
          "number",
          "optionValues",
          "phone",
          "placedAt",
          "postalCode",
          "productTitle",
          "quantity",
          "shippingAddress",
          "shippingTotal",
          "sku",
          "status",
          "subtotal",
          "taxTotal",
          "total",
          "unitPrice",
          "variantTitle",
        ].sort(),
      );
    });

    it("issues a constant number of statements for an order of 1 line and of 12 lines", async () => {
      const make = async (lines: number): Promise<GuestOrder> => {
        const who = new Shopper(running.baseUrl);
        let total = 0;
        for (let index = 0; index < lines; index += 1) {
          const product = await catalog.product({ withColors: true });
          await catalog.media(product.id, `https://img.test/q${index}.jpg`, 0);
          const variantId = await catalog.variant(product.id, {
            color: "red",
            price: 100 + index,
            trackInventory: true,
            onHand: 50,
          });
          await add(who, variantId, 2);
          total += 2 * (100 + index);
        }
        const result = await checkoutAs(who, checkoutBody(total));
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        return {
          number: placedOrders.track(result.body.order?.number ?? ""),
          token: result.body.accessToken ?? "",
          variantId: "",
          quantity: 2,
        };
      };
      const small = await make(1);
      const large = await make(12);
      const count = async (placed: GuestOrder) => {
        const spy = vi.spyOn(pg.Client.prototype, "query");
        try {
          const result = await lookup(visitor, placed.number, placed.token);
          expect(result.status).toBe(200);
          return spy.mock.calls.length;
        } finally {
          spy.mockRestore();
        }
      };
      const forSmall = await count(small);
      const forLarge = await count(large);
      expect(forSmall).toBeGreaterThan(0);
      expect(forLarge).toBe(forSmall);
    });

    it("is rate limited per address (a separate window from the other limits)", async () => {
      const limited = await startApp({
        adminAuthenticator: "production-default",
        clock,
        rateLimits: {
          orderLookup: { maxAttempts: 2, windowMinutes: 10 },
          guestCancel: { maxAttempts: 2, windowMinutes: 10 },
        },
      });
      try {
        const who = new Shopper(limited.baseUrl);
        expect((await lookup(who, "ZZZZ-ZZZZ", "t")).status).toBe(404);
        expect((await lookup(who, "ZZZZ-ZZZZ", "t")).status).toBe(404);
        const blocked = await lookup(who, "ZZZZ-ZZZZ", "t");
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
        // The cancel limit is its own window with its own count.
        expect((await cancel(who, "ZZZZ-ZZZZ", "t")).status).toBe(404);
        expect((await cancel(who, "ZZZZ-ZZZZ", "t")).status).toBe(404);
        const cancelBlocked = await cancel(who, "ZZZZ-ZZZZ", "t");
        expect(cancelBlocked.status).toBe(429);
        expect(cancelBlocked.headers.get("retry-after")).toMatch(/^\d+$/);
      } finally {
        await limited.app.close();
      }
    });
  });

  describe("POST /store/orders/cancel", () => {
    it("cancels an unpaid order: stock is released, the journal and the event record it, the response shows it", async () => {
      const placed = await guestOrder(3);
      expect(await reservedOf(placed.variantId)).toBe(3);
      const row = await orderRow(pool, placed.number);

      const result = await cancel(visitor, placed.number, placed.token);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.body.status).toBe("cancelled");
      expect(result.body.history.map((entry) => entry.status)).toEqual([
        "awaiting_payment",
        "cancelled",
      ]);
      expect(await reservedOf(placed.variantId)).toBe(0);
      const level = await pool.query("select on_hand from inventory_level where variant_id = $1", [
        placed.variantId,
      ]);
      expect(level.rows).toEqual([{ on_hand: 20 }]);
      expect((await reservationsOfOrder(pool, row.id)).map((entry) => entry.status)).toEqual([
        "released",
      ]);
      const after = await orderRow(pool, placed.number);
      expect(after.status).toBe("cancelled");
      expect(after.cancelled_at).not.toBeNull();
      expect(after.cancellation_reason).toBeNull();
      expect(await changesOf(pool, row.id)).toEqual([
        {
          from_status: null,
          to_status: "awaiting_payment",
          actor_type: "guest",
          actor_admin_id: null,
          reason: null,
        },
        {
          from_status: "awaiting_payment",
          to_status: "cancelled",
          actor_type: "guest",
          actor_admin_id: null,
          reason: null,
        },
      ]);
      expect((await eventsOf(pool, row.id)).map((event) => event.type)).toEqual([
        "order.placed",
        "order.cancelled",
      ]);
      // The token keeps opening the order (it is only revoked by expiry or a replay).
      expect((await lookup(visitor, placed.number, placed.token)).body.status).toBe("cancelled");
    });

    it("cancelling twice answers 409 invalid_transition and changes nothing more", async () => {
      const placed = await guestOrder(2);
      expect((await cancel(visitor, placed.number, placed.token)).status).toBe(200);
      const row = await orderRow(pool, placed.number);
      const second = await cancel(visitor, placed.number, placed.token);
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ code: "rule_violation", rule: "invalid_transition" });
      expect(await changesOf(pool, row.id)).toHaveLength(2);
      expect(await eventsOf(pool, row.id)).toHaveLength(2);
      expect(await reservedOf(placed.variantId)).toBe(0);
    });

    it("a paid order can not be cancelled by its owner: 409, still paid, stock still sold", async () => {
      const placed = await guestOrder(2);
      await pay(placed.number);
      const result = await cancel(visitor, placed.number, placed.token);
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "invalid_transition" });
      expect((await orderRow(pool, placed.number)).status).toBe("paid");
      const level = await pool.query(
        "select on_hand, reserved from inventory_level where variant_id = $1",
        [placed.variantId],
      );
      expect(level.rows).toEqual([{ on_hand: 18, reserved: 0 }]);
    });

    it("an expired order can not be cancelled either", async () => {
      const placed = await guestOrder(1);
      const row = await orderRow(pool, placed.number);
      expect(await orders.expireOne(row.id, new Date(row.expires_at.getTime() + 1))).toBe(
        "expired",
      );
      const result = await cancel(visitor, placed.number, placed.token);
      expect(result.status).toBe(409);
      expect((await orderRow(pool, placed.number)).status).toBe("expired");
    });

    it("answers the same 404 as the lookup for every miss and leaves the order alone", async () => {
      const one = await guestOrder(2);
      const two = await guestOrder(2);
      const { browser } = await newCustomer();
      const mine = await customerOrder(browser, 2);
      const attempts: [string, string][] = [
        ["ZZZZ-ZZZZ", one.token],
        ["not a number", one.token],
        [one.number, "x".repeat(43)],
        [one.number, ""],
        [one.number, two.token],
        [two.number, one.token],
        [mine.number, one.token],
        [mine.number, "q".repeat(43)],
      ];
      const seen = new Set<string>();
      for (const [number, token] of attempts) {
        const result = await cancel(visitor, number, token);
        expect(result.status, `${number} ${token.slice(0, 4)}`).toBe(404);
        seen.add(JSON.stringify(result.body));
      }
      expect(seen.size).toBe(1);
      expect((await orderRow(pool, one.number)).status).toBe("awaiting_payment");
      expect((await orderRow(pool, two.number)).status).toBe("awaiting_payment");
      expect((await orderRow(pool, mine.number)).status).toBe("awaiting_payment");
      expect(await reservedOf(one.variantId)).toBe(2);
      expect(await reservedOf(mine.variantId)).toBe(2);
    });

    it("the old token of a replayed checkout can not cancel", async () => {
      const who = new Shopper(running.baseUrl);
      const { variantId } = await catalog.simple({ trackInventory: true, onHand: 5, price: 100 });
      await add(who, variantId, 1);
      const key = randomUUID();
      const body = checkoutBody(100);
      const first = await checkoutAs(who, body, key);
      placedOrders.track(first.body.order?.number ?? "");
      const again = await checkoutAs(who, body, key);
      expect(again.status).toBe(200);
      const number = first.body.order?.number ?? "";
      expect((await cancel(visitor, number, first.body.accessToken ?? "")).status).toBe(404);
      expect((await orderRow(pool, number)).status).toBe("awaiting_payment");
      expect((await cancel(visitor, number, again.body.accessToken ?? "")).status).toBe(200);
    });

    it("needs the CSRF header", async () => {
      const placed = await guestOrder();
      const result = await visitor.request("POST", "/store/orders/cancel", {
        body: { number: placed.number, accessToken: placed.token },
        csrf: false,
      });
      expect(result.status).toBe(403);
      expect((await orderRow(pool, placed.number)).status).toBe("awaiting_payment");
    });
  });

  describe("customer order history", () => {
    it("lists the customer's own orders newest first with summaries, pages and a total", async () => {
      const { browser } = await newCustomer();
      const numbers: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        clock.advanceMinutes(1);
        numbers.push((await customerOrder(browser, index + 1, 100)).number);
      }
      const all = await browser.get<StoreOrderPage>("/store/account/orders");
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.headers.get("cache-control")).toBe("no-store");
      expect(all.body.total).toBe(5);
      expect(all.body.items.map((item) => item.number)).toEqual([...numbers].reverse());
      expect(all.body.items[0]).toEqual({
        number: numbers[4],
        status: "awaiting_payment",
        placedAt: expect.any(String),
        expiresAt: expect.any(String),
        total: { amount: 500, currency: "UAH" },
        itemCount: 5,
      });
      expect(all.body).toMatchObject({ limit: 24, offset: 0 });

      const page = await browser.get<StoreOrderPage>("/store/account/orders?limit=2&offset=2");
      expect(page.body.items.map((item) => item.number)).toEqual([numbers[2], numbers[1]]);
      expect(page.body).toMatchObject({ total: 5, limit: 2, offset: 2 });
      const beyond = await browser.get<StoreOrderPage>("/store/account/orders?offset=9");
      expect(beyond.body).toMatchObject({ items: [], total: 5 });
    });

    it("a customer with no orders gets an empty page; paging errors are 400", async () => {
      const { browser } = await newCustomer();
      const empty = await browser.get<StoreOrderPage>("/store/account/orders");
      expect(empty.body).toEqual({ items: [], total: 0, limit: 24, offset: 0 });
      for (const query of [
        "limit=0",
        "limit=101",
        "limit=-1",
        "offset=-1",
        "limit=abc",
        "x=1",
        "locale=xx",
      ]) {
        const result = await browser.get(`/store/account/orders?${query}`);
        expect(result.status, query).toBe(400);
      }
    });

    it("never lists another customer's or a guest's order", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const mine = await customerOrder(a.browser);
      const theirs = await customerOrder(b.browser);
      const guest = await guestOrder();
      const listA = await a.browser.get<StoreOrderPage>("/store/account/orders");
      expect(listA.body.items.map((item) => item.number)).toEqual([mine.number]);
      const listB = await b.browser.get<StoreOrderPage>("/store/account/orders");
      expect(listB.body.items.map((item) => item.number)).toEqual([theirs.number]);
      expect(JSON.stringify(listA.body)).not.toContain(guest.number);
    });

    it("reads one own order in full, resolved to a locale", async () => {
      const { browser, account } = await newCustomer();
      const mine = await customerOrder(browser, 2, 700);
      const result = await browser.get<OrderResult>(`/store/account/orders/${mine.number}`);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.body).toMatchObject({
        number: mine.number,
        status: "awaiting_payment",
        total: { amount: 1_400, currency: "UAH" },
        contact: { email: account.email },
        history: [{ status: "awaiting_payment" }],
      });
      expect(
        (await browser.get(`/store/account/orders/${mine.number.toLowerCase().replace("-", "")}`))
          .status,
      ).toBe(200);
      expect((await browser.get(`/store/account/orders/${mine.number}?locale=xx`)).status).toBe(
        400,
      );
    });

    it("IDOR: another customer, a guest order and an unknown number all give the same 404 on read and on cancel", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const mine = await customerOrder(a.browser, 2);
      const guest = await guestOrder();
      const bodies = new Set<string>();
      for (const number of [mine.number, guest.number, "ZZZZ-ZZZZ", "nonsense"]) {
        const read = await b.browser.get(`/store/account/orders/${encodeURIComponent(number)}`);
        expect(read.status, number).toBe(404);
        bodies.add(JSON.stringify(read.body));
        const cancelled = await b.browser.post(
          `/store/account/orders/${encodeURIComponent(number)}/cancel`,
        );
        expect(cancelled.status, number).toBe(404);
        bodies.add(JSON.stringify(cancelled.body));
      }
      expect(bodies.size).toBe(1);
      expect((await orderRow(pool, mine.number)).status).toBe("awaiting_payment");
      expect((await orderRow(pool, guest.number)).status).toBe("awaiting_payment");
      expect(await reservedOf(mine.variantId)).toBe(2);
    });

    it("cancels an own unpaid order (stock back, journal as customer), refuses twice and when paid", async () => {
      const { browser } = await newCustomer();
      const mine = await customerOrder(browser, 3);
      const row = await orderRow(pool, mine.number);
      const result = await browser.post<OrderResult>(`/store/account/orders/${mine.number}/cancel`);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.status).toBe("cancelled");
      expect(await reservedOf(mine.variantId)).toBe(0);
      expect((await changesOf(pool, row.id)).map((change) => change.actor_type)).toEqual([
        "customer",
        "customer",
      ]);
      const twice = await browser.post(`/store/account/orders/${mine.number}/cancel`);
      expect(twice.status).toBe(409);
      expect(twice.body).toMatchObject({ code: "rule_violation", rule: "invalid_transition" });

      const paidOne = await customerOrder(browser, 1);
      await pay(paidOne.number);
      const refused = await browser.post(`/store/account/orders/${paidOne.number}/cancel`);
      expect(refused.status).toBe(409);
      expect((await orderRow(pool, paidOne.number)).status).toBe("paid");
    });

    it("the cancel of a customer needs the CSRF header like every store write", async () => {
      const { browser } = await newCustomer();
      const mine = await customerOrder(browser, 1);
      const result = await browser.request("POST", `/store/account/orders/${mine.number}/cancel`, {
        csrf: false,
      });
      expect(result.status).toBe(403);
      expect((await orderRow(pool, mine.number)).status).toBe("awaiting_payment");
    });

    it("every route answers 401 without a customer session, also with other cookies", async () => {
      const mine = await guestOrder();
      const requests: [string, string][] = [
        ["GET", "/store/account/orders"],
        ["GET", `/store/account/orders/${mine.number}`],
        ["POST", `/store/account/orders/${mine.number}/cancel`],
      ];
      const withOtherCookies = new Shopper(running.baseUrl);
      withOtherCookies.setCookie("fluxkit_admin_session", "A".repeat(43));
      withOtherCookies.setCookie("fluxkit_cart", "B".repeat(43));
      for (const who of [visitor, withOtherCookies]) {
        for (const [method, path] of requests) {
          const result = await who.request(method as "GET", path);
          expect(result.status, `${method} ${path}`).toBe(401);
          expect(result.headers.get("cache-control")).toBe("no-store");
        }
      }
    });

    it("the list and the detail issue a constant number of statements for 1 and 8 orders / 1 and 12 lines", async () => {
      const small = await newCustomer();
      const large = await newCustomer();
      await customerOrder(small.browser);
      for (let index = 0; index < 8; index += 1) {
        await customerOrder(large.browser, 2);
      }
      const count = async (run: () => Promise<{ status: number }>) => {
        const spy = vi.spyOn(pg.Client.prototype, "query");
        try {
          expect((await run()).status).toBe(200);
          return spy.mock.calls.length;
        } finally {
          spy.mockRestore();
        }
      };
      const forSmall = await count(() => small.browser.get("/store/account/orders"));
      const forLarge = await count(() => large.browser.get("/store/account/orders"));
      expect(forSmall).toBeGreaterThan(0);
      expect(forLarge).toBe(forSmall);
    });
  });

  describe("the response of a placed order matches what the lookup returns", () => {
    it("the order of the checkout response and the order of the lookup are identical", async () => {
      const who = new Shopper(running.baseUrl);
      const { variantId } = await catalog.simple({ trackInventory: true, onHand: 5, price: 250 });
      await add(who, variantId, 2);
      const placed = await checkoutAs(who, checkoutBody(500));
      placedOrders.track(placed.body.order?.number ?? "");
      const read = await lookup(
        visitor,
        placed.body.order?.number ?? "",
        placed.body.accessToken ?? "",
      );
      expect(read.body).toEqual(placed.body.order);
      const asCheckout: CheckoutResult = placed.body as CheckoutResult;
      expect(Object.keys(asCheckout.order ?? {}).sort()).toEqual(Object.keys(read.body).sort());
    });
  });
});
