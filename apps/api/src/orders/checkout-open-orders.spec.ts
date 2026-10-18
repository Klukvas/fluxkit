import { randomUUID } from "node:crypto";
import pg from "pg";
import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { type CartResult } from "../test/cart-helpers.js";
import { createTestCustomer, deleteTestCustomers } from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { insertAdminUserRow } from "../test/inventory-fixtures.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { checkoutAs, checkoutBody, orderRow, type CheckoutResult } from "../test/order-http.js";
import type { HttpResult } from "../test/http.js";
import { Shopper } from "../test/shopper.js";
import { OrdersService } from "./orders.service.js";

const START = new Date("2039-03-01T08:00:00.000Z");
const PASSWORD = "correct horse battery staple";
const LIMIT = 3;
const ROUNDS = 10;
const PRICE = 1_000;

describe("open orders per guest email and per customer (real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  const customers: string[] = [];
  let running: RunningApp;
  let db: Database;
  let orders: OrdersService;
  let adminId = "";

  const emailAddress = () => `open-orders-${randomUUID()}@example.test`;
  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const stocked = () => catalog.simple({ trackInventory: true, onHand: 10_000, price: PRICE });

  function track(...results: HttpResult<CheckoutResult>[]): void {
    for (const result of results) {
      if (result.body.order?.number !== undefined) {
        placedOrders.track(result.body.order.number);
      }
    }
  }

  /** A new browser with one line in its cart. */
  async function shopperWithCart(variantId?: string): Promise<Shopper> {
    const who = new Shopper(running.baseUrl);
    const line = variantId ?? (await stocked()).variantId;
    expect((await add(who, line)).status).toBe(200);
    return who;
  }

  /** A new guest browser places one order for `email`. */
  async function guestOrder(email: string, key?: string): Promise<HttpResult<CheckoutResult>> {
    const who = await shopperWithCart();
    const result = await checkoutAs(who, checkoutBody(PRICE, { email }), key);
    track(result);
    return result;
  }

  async function signedIn(): Promise<{ id: string; email: string; browser: Shopper }> {
    const account = await createTestCustomer(db, { password: PASSWORD });
    customers.push(account.id);
    const browser = new Shopper(running.baseUrl);
    const login = await browser.post("/store/account/login", {
      email: account.email,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    return { id: account.id, email: account.email, browser };
  }

  /** One order for a signed-in customer: a line goes into the (kept) cart, then checkout. */
  async function customerOrder(browser: Shopper): Promise<HttpResult<CheckoutResult>> {
    expect((await add(browser, (await stocked()).variantId)).status).toBe(200);
    // A refused earlier checkout keeps its line in the cart, so the total is read, not assumed.
    const seen = (await browser.get<CartResult>("/store/cart")).body.total;
    const result = await checkoutAs(browser, checkoutBody(seen.amount, { email: undefined }));
    track(result);
    return result;
  }

  const openOrdersOfEmail = async (email: string): Promise<number> =>
    (
      await pool.query<{ n: number }>(
        "select count(*)::int as n from sales_order where email = $1 and customer_id is null and status = 'awaiting_payment'",
        [email],
      )
    ).rows[0]?.n ?? -1;
  const openOrdersOfCustomer = async (id: string): Promise<number> =>
    (
      await pool.query<{ n: number }>(
        "select count(*)::int as n from sales_order where customer_id = $1 and status = 'awaiting_payment'",
        [id],
      )
    ).rows[0]?.n ?? -1;
  const reservedOf = async (variantId: string): Promise<number> =>
    (
      await pool.query<{ n: number }>(
        "select coalesce(sum(reserved), 0)::int as n from inventory_level where variant_id = $1",
        [variantId],
      )
    ).rows[0]?.n ?? -1;

  let captured: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      maxOpenOrders: LIMIT,
      rateLimits: {
        checkout: { maxAttempts: 1_000_000, windowMinutes: 10 },
        login: { maxAttempts: 1_000_000, windowMinutes: 10 },
        cartWrite: { maxAttempts: 1_000_000, windowMinutes: 1 },
      },
    });
    db = running.app.get<Database>(DRIZZLE);
    orders = running.app.get(OrdersService);
    adminId = await insertAdminUserRow(pool);
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
    captured = [];
    // Every log level, so a leaked address cannot hide in a level this spec forgot.
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        captured.push(String(message));
      });
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    expect(
      captured.filter((message) => message.includes("Deadlock")),
      "a deadlock happened (and was retried)",
    ).toEqual([]);
    await placedOrders.cleanup();
    await deleteTestCustomers(db, customers.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  describe("a guest email", () => {
    it("may hold 3 unpaid orders; the 4th is refused with too_many_open_orders and leaves nothing behind", async () => {
      const email = emailAddress();
      for (let placed = 1; placed <= LIMIT; placed += 1) {
        expect((await guestOrder(email)).status, `order ${String(placed)}`).toBe(201);
      }
      const { variantId } = await stocked();
      const who = await shopperWithCart(variantId);
      const refused = await checkoutAs(who, checkoutBody(PRICE, { email }));
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "too_many_open_orders", status: 409 });
      expect(refused.headers.get("content-type")).toContain("application/problem+json");
      expect(await openOrdersOfEmail(email)).toBe(LIMIT);
      // Nothing was reserved and the cart keeps its line: the shopper can pay or wait, then try again.
      expect(await reservedOf(variantId)).toBe(0);
      expect((await who.get<CartResult>("/store/cart")).body.lines).toHaveLength(1);
    });

    it("is counted case- and space-insensitively (the checkout normalizes the address)", async () => {
      const email = emailAddress();
      for (let placed = 1; placed <= LIMIT; placed += 1) {
        expect(
          (await guestOrder(placed % 2 === 0 ? ` ${email.toUpperCase()} ` : email)).status,
        ).toBe(201);
      }
      expect((await guestOrder(email.toUpperCase())).status).toBe(409);
    });

    it("does not count paid, cancelled, expired or fulfilled orders", async () => {
      const email = emailAddress();
      const placed = [await guestOrder(email), await guestOrder(email), await guestOrder(email)];
      const ids = await Promise.all(
        placed.map(async (result) => (await orderRow(pool, result.body.order?.number ?? "")).id),
      );
      expect((await guestOrder(email)).status).toBe(409);

      const [first = "", second = "", third = ""] = ids;
      const paid = await orders.markPaid(first, {
        amount: { amount: PRICE, currency: "UAH" },
        providerReference: "PAY-OPEN-1",
        source: "test",
      });
      expect(paid.ok).toBe(true);
      // A paid order is no longer unpaid: one place is free again.
      const afterPaid = await guestOrder(email);
      expect(afterPaid.status).toBe(201);
      expect((await guestOrder(email)).status).toBe(409);

      await orders.cancelAsAdmin(second, adminId, "test cancel");
      const expiring = await orderRow(pool, placed[2]?.body.order?.number ?? "");
      await orders.expireOne(third, new Date(expiring.expires_at.getTime() + 1));
      expect(await openOrdersOfEmail(email)).toBe(1);
      expect((await guestOrder(email)).status).toBe(201);
      expect((await guestOrder(email)).status).toBe(201);
      expect((await guestOrder(email)).status).toBe(409);
    });

    it("does not touch other emails, nor a signed-in customer who happens to use the same address", async () => {
      const email = emailAddress();
      for (let placed = 1; placed <= LIMIT; placed += 1) await guestOrder(email);
      expect((await guestOrder(email)).status).toBe(409);
      expect((await guestOrder(emailAddress())).status).toBe(201);
      const customer = await signedIn();
      const own = await checkoutAs(
        await (async () => {
          await add(customer.browser, (await stocked()).variantId);
          return customer.browser;
        })(),
        checkoutBody(PRICE, { email }),
      );
      track(own);
      expect(own.status).toBe(201);
    });

    it("ignores the orders of a signed-in customer who used the same address", async () => {
      const customer = await signedIn();
      for (let placed = 1; placed <= LIMIT; placed += 1) {
        expect((await customerOrder(customer.browser)).status).toBe(201);
      }
      expect(await openOrdersOfCustomer(customer.id)).toBe(LIMIT);
      // Three customer orders carry this address, yet a guest with it is not at the guest limit.
      expect((await guestOrder(customer.email)).status).toBe(201);
    });

    it("answers a replay of an existing checkout with that order even at the limit", async () => {
      const email = emailAddress();
      await guestOrder(email);
      await guestOrder(email);
      const key = randomUUID();
      const who = await shopperWithCart();
      const body = checkoutBody(PRICE, { email });
      const third = await checkoutAs(who, body, key);
      track(third);
      expect(third.status).toBe(201);
      expect((await guestOrder(email)).status).toBe(409);

      const replay = await checkoutAs(who, body, key);
      expect(replay.status).toBe(200);
      expect(replay.body.order?.number).toBe(third.body.order?.number);
      expect(await openOrdersOfEmail(email)).toBe(LIMIT);
    });

    it("never lets 3 parallel-placing guests exceed the limit: 6 parallel checkouts leave exactly 3 orders (many rounds)", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const email = emailAddress();
        const shoppers = await Promise.all(Array.from({ length: 6 }, () => shopperWithCart()));
        const results = await Promise.all(
          shoppers.map((who) => checkoutAs(who, checkoutBody(PRICE, { email }))),
        );
        track(...results);
        expect(
          results.map((result) => result.status).sort(),
          `round ${String(round)}: ${JSON.stringify(results.map((r) => r.body.code))}`,
        ).toEqual([201, 201, 201, 409, 409, 409]);
        for (const refused of results.filter((result) => result.status === 409)) {
          expect(refused.body.code).toBe("too_many_open_orders");
        }
        expect(await openOrdersOfEmail(email)).toBe(LIMIT);
        await placedOrders.cleanup();
      }
    });

    it("keeps the limit per email when emails race together: 3 each, never more (many rounds)", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const emails = [emailAddress(), emailAddress()];
        const shoppers = await Promise.all(Array.from({ length: 10 }, () => shopperWithCart()));
        const results = await Promise.all(
          shoppers.map((who, index) =>
            checkoutAs(who, checkoutBody(PRICE, { email: emails[index % 2] })),
          ),
        );
        track(...results);
        for (const email of emails) {
          expect(await openOrdersOfEmail(email), `round ${String(round)}`).toBe(LIMIT);
        }
        expect(results.filter((result) => result.status === 201)).toHaveLength(2 * LIMIT);
        expect(
          results.filter((result) => result.status !== 201 && result.status !== 409),
        ).toHaveLength(0);
        await placedOrders.cleanup();
      }
    });

    it("the lock does not create a deadlock: carts with crossing variants for one email, with the limit active (many rounds)", async () => {
      const a = await stocked();
      const b = await stocked();
      for (let round = 0; round < ROUNDS; round += 1) {
        const email = emailAddress();
        const first = new Shopper(running.baseUrl);
        const second = new Shopper(running.baseUrl);
        for (const variant of [a, b]) await add(first, variant.variantId);
        for (const variant of [b, a]) await add(second, variant.variantId);
        const results = await Promise.all([
          checkoutAs(first, checkoutBody(2 * PRICE, { email })),
          checkoutAs(second, checkoutBody(2 * PRICE, { email })),
        ]);
        track(...results);
        expect(results.map((result) => result.status)).toEqual([201, 201]);
        await placedOrders.cleanup();
      }
    });
  });

  describe("a customer", () => {
    it("may hold 3 unpaid orders; the 4th is refused", async () => {
      const customer = await signedIn();
      for (let placed = 1; placed <= LIMIT; placed += 1) {
        expect((await customerOrder(customer.browser)).status, `order ${String(placed)}`).toBe(201);
      }
      const { variantId } = await stocked();
      expect((await add(customer.browser, variantId)).status).toBe(200);
      const refused = await checkoutAs(customer.browser, checkoutBody(PRICE, { email: undefined }));
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "too_many_open_orders", status: 409 });
      expect(await openOrdersOfCustomer(customer.id)).toBe(LIMIT);
      expect(await reservedOf(variantId)).toBe(0);
    });

    it("counts only that customer's unpaid orders: another customer and a finished order do not count", async () => {
      const first = await signedIn();
      const second = await signedIn();
      const placed: HttpResult<CheckoutResult>[] = [];
      for (let order = 1; order <= LIMIT; order += 1) {
        placed.push(await customerOrder(first.browser));
      }
      expect((await customerOrder(first.browser)).status).toBe(409);
      expect((await customerOrder(second.browser)).status).toBe(201);
      const firstId = (await orderRow(pool, placed[0]?.body.order?.number ?? "")).id;
      await orders.cancelAsAdmin(firstId, adminId, "test cancel");
      expect((await customerOrder(first.browser)).status).toBe(201);
      expect((await customerOrder(first.browser)).status).toBe(409);
    });

    it("answers a replay of an existing checkout with that order even at the limit", async () => {
      const customer = await signedIn();
      await customerOrder(customer.browser);
      await customerOrder(customer.browser);
      const key = randomUUID();
      expect((await add(customer.browser, (await stocked()).variantId)).status).toBe(200);
      const body = checkoutBody(PRICE, { email: undefined });
      const third = await checkoutAs(customer.browser, body, key);
      track(third);
      expect(third.status).toBe(201);
      const replay = await checkoutAs(customer.browser, body, key);
      expect(replay.status).toBe(200);
      expect(replay.body.order?.number).toBe(third.body.order?.number);
    });

    it("never passes the limit when several checkouts of its one cart race (many rounds)", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const customer = await signedIn();
        for (let placed = 1; placed < LIMIT; placed += 1) {
          expect((await customerOrder(customer.browser)).status).toBe(201);
        }
        // The cart holds one line; six checkouts with different keys race for it: one order, the others find it empty.
        expect((await add(customer.browser, (await stocked()).variantId)).status).toBe(200);
        const racing = await Promise.all(
          Array.from({ length: 6 }, () =>
            checkoutAs(customer.browser, checkoutBody(PRICE, { email: undefined })),
          ),
        );
        track(...racing);
        expect(
          racing.filter((result) => result.status === 201),
          `round ${String(round)}: ${JSON.stringify(racing.map((r) => r.body.code))}`,
        ).toHaveLength(1);
        expect(await openOrdersOfCustomer(customer.id)).toBe(LIMIT);
        // Now at the limit: every parallel checkout of a refilled cart is refused and nothing is placed.
        expect((await add(customer.browser, (await stocked()).variantId)).status).toBe(200);
        const refused = await Promise.all(
          Array.from({ length: 6 }, () =>
            checkoutAs(customer.browser, checkoutBody(PRICE, { email: undefined })),
          ),
        );
        track(...refused);
        expect(refused.map((result) => result.body.code)).toEqual(
          Array(6).fill("too_many_open_orders"),
        );
        expect(await openOrdersOfCustomer(customer.id)).toBe(LIMIT);
        await placedOrders.cleanup();
      }
    });
  });

  describe("the refusal", () => {
    it("shows nothing about other orders or the address, and nothing is logged about them", async () => {
      const email = emailAddress();
      const placed: string[] = [];
      for (let order = 1; order <= LIMIT; order += 1) {
        placed.push((await guestOrder(email)).body.order?.number ?? "");
      }
      captured = [];
      const refused = await guestOrder(email);
      expect(refused.status).toBe(409);
      const text = JSON.stringify({ body: refused.body, headers: [...refused.headers.entries()] });
      expect(text).not.toContain(email);
      expect(text).not.toContain("example.test");
      for (const number of placed) {
        expect(text).not.toContain(number);
      }
      expect(Object.keys(refused.body).sort()).toEqual([
        "code",
        "detail",
        "status",
        "title",
        "type",
      ]);
      for (const line of captured) {
        expect(line).not.toContain(email);
        for (const number of placed) {
          expect(line).not.toContain(number);
        }
      }
    });
  });
});

describe("MAX_OPEN_ORDERS is configurable", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      maxOpenOrders: 1,
      rateLimits: { checkout: { maxAttempts: 1_000_000, windowMinutes: 10 } },
    });
    await catalog.init();
  });

  afterAll(async () => {
    await placedOrders.cleanup();
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  it("a limit of 1 refuses the second unpaid order of an email", async () => {
    const email = `open-orders-${randomUUID()}@example.test`;
    const outcomes: number[] = [];
    for (let order = 0; order < 2; order += 1) {
      const who = new Shopper(running.baseUrl);
      const { variantId } = await catalog.simple({
        trackInventory: true,
        onHand: 10,
        price: PRICE,
      });
      await who.post("/store/cart/items", { variantId, quantity: 1 });
      const result = await checkoutAs(who, checkoutBody(PRICE, { email }));
      if (result.body.order?.number !== undefined) placedOrders.track(result.body.order.number);
      outcomes.push(result.status);
    }
    expect(outcomes).toEqual([201, 409]);
  });
});
