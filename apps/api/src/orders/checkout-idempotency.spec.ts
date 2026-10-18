import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { hashSessionToken } from "../auth/session-token.js";
import { startApp, TEST_ORDER_TOKEN_SECRET, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { type CartResult } from "../test/cart-helpers.js";
import { createTestCustomer, deleteTestCustomers } from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  changesOf,
  checkoutAs,
  checkoutBody,
  orderRow,
  reservationsOfOrder,
  type CheckoutResult,
} from "../test/order-http.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { Shopper } from "../test/shopper.js";
import { deriveAccessToken } from "./access-token.js";

const START = new Date("2035-03-01T08:00:00.000Z");
const PASSWORD = "correct horse battery staple";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

describe("checkout idempotency (real app, real Postgres)", () => {
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
  const stocked = (onHand = 10, price = 1_000) =>
    catalog.simple({ trackInventory: true, onHand, price });
  const lookup = (who: Shopper, number: string, accessToken: string) =>
    who.post<CheckoutResult>("/store/orders/lookup", { number, accessToken });
  const orderCount = async (key: string): Promise<number> =>
    (
      await pool.query<{ n: number }>(
        "select count(*)::int as n from sales_order where idempotency_key = $1",
        [key],
      )
    ).rows[0]?.n ?? -1;

  /** Another browser holding the same cart cookie (the same shopper in a second tab, or a double click). */
  function twinOf(who: Shopper): Shopper {
    const twin = new Shopper(running.baseUrl);
    for (const name of ["fluxkit_cart", "fluxkit_customer_session"]) {
      const value = who.cookie(name);
      if (value !== undefined) twin.setCookie(name, value);
    }
    return twin;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: {
        checkout: { maxAttempts: 10_000, windowMinutes: 10 },
        orderLookup: { maxAttempts: 10_000, windowMinutes: 10 },
      },
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

  async function firstOrder(total = 2_000, quantity = 2) {
    const { variantId } = await stocked(10, total / quantity);
    await add(shopper, variantId, quantity);
    const key = randomUUID();
    const body = checkoutBody(total);
    const first = await checkoutAs(shopper, body, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    placedOrders.track(first.body.order?.number ?? "");
    return { variantId, key, body, first };
  }

  describe("the same key and the same request", () => {
    it("answers 200 with the same order and the SAME access token, which keeps working; nothing is rotated", async () => {
      const { key, body, first, variantId } = await firstOrder();
      const number = first.body.order?.number ?? "";
      const token = first.body.accessToken ?? "";
      expect(token).toMatch(TOKEN);

      const hashBefore = (await orderRow(pool, number)).access_token_hash;
      const again = await checkoutAs(shopper, body, key);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.order).toEqual(first.body.order);
      expect(again.body.accessToken).toBe(token);

      // One order, one hold: a replay never reserves or inserts anything.
      expect(await orderCount(key)).toBe(1);
      const row = await orderRow(pool, number);
      expect(await reservationsOfOrder(pool, row.id)).toHaveLength(1);
      const level = await pool.query("select reserved from inventory_level where variant_id = $1", [
        variantId,
      ]);
      expect(level.rows).toEqual([{ reserved: 2 }]);
      expect(await changesOf(pool, row.id)).toHaveLength(1);

      // The token of the first answer still opens the order, and the stored hash is the one written at placement.
      const open = await lookup(shopper, number, token);
      expect(open.status).toBe(200);
      expect(open.body).toEqual(first.body.order);
      expect(hashBefore).not.toBeNull();
      expect(row.access_token_hash).toBe(hashBefore);
    });

    it("never rotates: every replay returns the token of the first answer", async () => {
      const { key, body, first } = await firstOrder();
      const number = first.body.order?.number ?? "";
      const tokens = [first.body.accessToken ?? ""];
      for (let replay = 0; replay < 3; replay += 1) {
        const again = await checkoutAs(shopper, body, key);
        expect(again.status).toBe(200);
        tokens.push(again.body.accessToken ?? "");
      }
      expect(new Set(tokens).size).toBe(1);
      const result = await lookup(shopper, number, tokens[0] ?? "");
      expect(result.status).toBe(200);
    });

    it("the token is the HMAC of the order id and the key under the secret, and differs per key and per order", async () => {
      const one = await firstOrder();
      const two = await firstOrder(1_000, 1);
      const rowOne = await orderRow(pool, one.first.body.order?.number ?? "");
      const rowTwo = await orderRow(pool, two.first.body.order?.number ?? "");
      const tokenOne = one.first.body.accessToken ?? "";
      const tokenTwo = two.first.body.accessToken ?? "";
      expect(tokenOne).toBe(deriveAccessToken(TEST_ORDER_TOKEN_SECRET, rowOne.id, one.key).token);
      expect(tokenTwo).toBe(deriveAccessToken(TEST_ORDER_TOKEN_SECRET, rowTwo.id, two.key).token);
      expect(tokenOne).not.toBe(tokenTwo);
      // Neither token opens the other order.
      const crossed = await lookup(shopper, rowTwo.number, tokenOne);
      expect(crossed.status).toBe(404);
    });

    it("never stores or logs the raw token or the secret", async () => {
      const writes: string[] = [];
      const capture = (chunk: unknown): boolean => {
        writes.push(
          typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString(),
        );
        return true;
      };
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(capture);
      let token: string;
      let number: string;
      try {
        const { key, body, first } = await firstOrder();
        token = first.body.accessToken ?? "";
        number = first.body.order?.number ?? "";
        const again = await checkoutAs(shopper, body, key);
        expect(again.status).toBe(200);
        const reused = await checkoutAs(shopper, { ...body, phone: "+380509999999" }, key);
        expect(reused.status).toBe(409);
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
      }
      expect(token).toMatch(TOKEN);
      const log = writes.join("");
      expect(log).not.toContain(token);
      expect(log).not.toContain(TEST_ORDER_TOKEN_SECRET);

      const row = await orderRow(pool, number);
      expect(row.access_token_hash).toBe(hashSessionToken(token));
      const stored = await pool.query<{ text: string }>(
        `select row_to_json(o)::text as text from sales_order o where o.id = $1
         union all select row_to_json(c)::text from order_status_change c where c.order_id = $1
         union all select row_to_json(i)::text from order_item i where i.order_id = $1
         union all select row_to_json(e)::text from domain_event e where e::text like '%' || $2 || '%'`,
        [row.id, row.number],
      );
      expect(stored.rows.length).toBeGreaterThan(0);
      for (const entry of stored.rows) {
        expect(entry.text).not.toContain(token);
        expect(entry.text).not.toContain(TEST_ORDER_TOKEN_SECRET);
      }
    });

    it("after the secret changed, tokens already handed out keep working, and a replay by the owner of the cart re-derives the token (the old one is then dead)", async () => {
      const { key, body, first } = await firstOrder();
      const number = first.body.order?.number ?? "";
      const oldToken = first.body.accessToken ?? "";
      const rotated = await startApp({
        adminAuthenticator: "production-default",
        clock,
        orderTokenSecret: "another-order-token-secret-0123456789-xyz",
        rateLimits: {
          checkout: { maxAttempts: 10_000, windowMinutes: 10 },
          orderLookup: { maxAttempts: 10_000, windowMinutes: 10 },
        },
      });
      try {
        const same = new Shopper(rotated.baseUrl);
        same.setCookie("fluxkit_cart", shopper.cookie("fluxkit_cart") ?? "");
        // Lookup compares hashes and never uses the secret: a token already handed out keeps working until a replay.
        expect((await lookup(same, number, oldToken)).status).toBe(200);
        const again = await checkoutAs(same, body, key);
        expect(again.status, JSON.stringify(again.body)).toBe(200);
        const newToken = again.body.accessToken ?? "";
        expect(newToken).toMatch(TOKEN);
        expect(newToken).not.toBe(oldToken);
        expect((await lookup(same, number, newToken)).status).toBe(200);
        expect((await lookup(same, number, oldToken)).status).toBe(404);
        // From now on it is stable again.
        const third = await checkoutAs(same, body, key);
        expect(third.body.accessToken).toBe(newToken);
      } finally {
        await rotated.app.close();
      }
    });

    it("the new token lives as long as a fresh one (from the replay), not as long as the old", async () => {
      const { key, body, first } = await firstOrder();
      const number = first.body.order?.number ?? "";
      const before = (await orderRow(pool, number)).access_expires_at;
      clock.advanceMinutes(60 * 24);
      const again = await checkoutAs(shopper, body, key);
      expect(again.status).toBe(200);
      const after = (await orderRow(pool, number)).access_expires_at;
      expect((after?.getTime() ?? 0) - (before?.getTime() ?? 0)).toBe(24 * 60 * 60_000);
    });

    it("a customer's replay is 200 without a token", async () => {
      const account = await createTestCustomer(db, { password: PASSWORD });
      customers.push(account.id);
      await shopper.post("/store/account/login", { email: account.email, password: PASSWORD });
      const { variantId } = await stocked(10, 500);
      await add(shopper, variantId, 2);
      const key = randomUUID();
      const body = checkoutBody(1_000, { email: undefined });
      const first = await checkoutAs(shopper, body, key);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      placedOrders.track(first.body.order?.number ?? "");
      const again = await checkoutAs(shopper, body, key);
      expect(again.status).toBe(200);
      expect(again.body).not.toHaveProperty("accessToken");
      expect(again.body.order).toEqual(first.body.order);
    });

    it("an omitted email and the account email sent explicitly are the same request for a customer", async () => {
      const account = await createTestCustomer(db, { password: PASSWORD });
      customers.push(account.id);
      await shopper.post("/store/account/login", { email: account.email, password: PASSWORD });
      const { variantId } = await stocked(10, 500);
      await add(shopper, variantId, 1);
      const key = randomUUID();
      const first = await checkoutAs(shopper, checkoutBody(500, { email: undefined }), key);
      expect(first.status).toBe(201);
      placedOrders.track(first.body.order?.number ?? "");
      const again = await checkoutAs(shopper, checkoutBody(500, { email: account.email }), key);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
    });

    it("normalization makes spelling variants one request (case of the email, spaces and dashes of the phone)", async () => {
      const { key, first } = await firstOrder();
      const again = await checkoutAs(
        shopper,
        checkoutBody(2_000, { email: "  BUYER@Example.TEST ", phone: "+38 (050) 123-45-67" }),
        key,
      );
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.order?.number).toBe(first.body.order?.number);
    });

    it("replays an order that was cancelled meanwhile (the order as it is now), with no new hold", async () => {
      const { key, body, first, variantId } = await firstOrder();
      const number = first.body.order?.number ?? "";
      const cancelled = await shopper.post("/store/orders/cancel", {
        number,
        accessToken: first.body.accessToken,
      });
      expect(cancelled.status).toBe(200);
      const again = await checkoutAs(shopper, body, key);
      expect(again.status).toBe(200);
      expect(again.body.order?.status).toBe("cancelled");
      const level = await pool.query("select reserved from inventory_level where variant_id = $1", [
        variantId,
      ]);
      expect(level.rows).toEqual([{ reserved: 0 }]);
    });

    it("does not touch a cart that was filled again after the checkout", async () => {
      const { key, body } = await firstOrder();
      const next = await stocked(10, 700);
      await add(shopper, next.variantId, 3);
      const again = await checkoutAs(shopper, body, key);
      expect(again.status).toBe(200);
      const cart = (await shopper.get<CartResult>("/store/cart")).body;
      expect(cart.lines).toHaveLength(1);
      expect(cart.lines[0]?.quantity).toBe(3);
    });
  });

  describe("the same key and another request is idempotency_key_reused", () => {
    const changes: [string, Record<string, unknown>][] = [
      ["the phone", { phone: "+380509999999" }],
      ["the email", { email: "someone.else@example.test" }],
      ["a name", { firstName: "Інший" }],
      [
        "the shipping address",
        { shippingAddress: { countryCode: "UA", city: "Львів", line1: "x" } },
      ],
      ["a billing address", { billingAddress: { countryCode: "UA", city: "Львів", line1: "x" } }],
      ["the locale", { locale: "en" }],
      ["the expected total", { expectedTotal: { amount: 2_001, currency: "UAH" } }],
    ];

    it.each(changes)("when %s differs", async (_name, change) => {
      const { key, body, first } = await firstOrder();
      const other = await checkoutAs(shopper, { ...body, ...change }, key);
      expect(other.status, JSON.stringify(other.body)).toBe(409);
      expect(other.body).toMatchObject({ code: "idempotency_key_reused" });
      expect(other.body).not.toHaveProperty("order");
      expect(other.body).not.toHaveProperty("accessToken");
      expect(await orderCount(key)).toBe(1);
      // The token of the first response still works: a refused replay rotates nothing.
      const stillOpen = await lookup(
        shopper,
        first.body.order?.number ?? "",
        first.body.accessToken ?? "",
      );
      expect(stillOpen.status).toBe(200);
    });

    it("answers every mismatch with the same body: it never says which part differed", async () => {
      const { key, body } = await firstOrder();
      const bodies: string[] = [];
      for (const [, change] of changes) {
        const other = await checkoutAs(shopper, { ...body, ...change }, key);
        expect(other.status).toBe(409);
        bodies.push(JSON.stringify(other.body));
      }
      // Another cart, a lost cookie and another principal look the same too.
      const stranger = await checkoutAs(new Shopper(running.baseUrl), body, key);
      bodies.push(JSON.stringify(stranger.body));
      expect(stranger.status).toBe(409);
      expect(new Set(bodies).size).toBe(1);
    });

    it("a shopper with a different cart cannot replay someone else's key, and learns nothing", async () => {
      const { key, body, first } = await firstOrder();
      const other = new Shopper(running.baseUrl);
      const { variantId } = await stocked(10, 1_000);
      await add(other, variantId, 2);
      const stolen = await checkoutAs(other, body, key);
      expect(stolen.status).toBe(409);
      expect(stolen.body).toMatchObject({ code: "idempotency_key_reused" });
      expect(JSON.stringify(stolen.body)).not.toContain(first.body.order?.number ?? "-");
      expect(await orderCount(key)).toBe(1);
      // The other shopper's cart was not consumed.
      expect((await other.get<CartResult>("/store/cart")).body.lines).toHaveLength(1);
    });

    it("a guest who lost the cart cookie cannot replay (no proof of the cart): 409, no token", async () => {
      const { key, body } = await firstOrder();
      const lost = new Shopper(running.baseUrl);
      const result = await checkoutAs(lost, body, key);
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "idempotency_key_reused" });
      expect(result.body).not.toHaveProperty("accessToken");
    });

    it("a signed-in customer cannot replay a guest's key, nor a guest a customer's", async () => {
      const guestOrder = await firstOrder();
      const account = await createTestCustomer(db, { password: PASSWORD });
      customers.push(account.id);
      const signed = new Shopper(running.baseUrl);
      await signed.post("/store/account/login", { email: account.email, password: PASSWORD });
      const { variantId } = await stocked(10, 1_000);
      await add(signed, variantId, 2);
      const toGuestKey = await checkoutAs(signed, guestOrder.body, guestOrder.key);
      expect(toGuestKey.status).toBe(409);
      expect(toGuestKey.body).toMatchObject({ code: "idempotency_key_reused" });

      const customerKey = randomUUID();
      const customerOrder = await checkoutAs(signed, checkoutBody(2_000), customerKey);
      expect(customerOrder.status, JSON.stringify(customerOrder.body)).toBe(201);
      placedOrders.track(customerOrder.body.order?.number ?? "");
      const guestTries = await checkoutAs(shopper, checkoutBody(2_000), customerKey);
      expect(guestTries.status).toBe(409);
      expect(guestTries.body).toMatchObject({ code: "idempotency_key_reused" });
    });

    it("a refused replay does not count the key as used for the other request: the first order stays the only one", async () => {
      const { key, body } = await firstOrder();
      const fresh = await stocked(10, 400);
      await add(shopper, fresh.variantId, 1);
      const reused = await checkoutAs(
        shopper,
        { ...body, expectedTotal: { amount: 400, currency: "UAH" } },
        key,
      );
      expect(reused.status).toBe(409);
      expect(await orderCount(key)).toBe(1);
      const fine = await checkoutAs(shopper, checkoutBody(400), randomUUID());
      expect(fine.status, JSON.stringify(fine.body)).toBe(201);
      placedOrders.track(fine.body.order?.number ?? "");
    });
  });

  describe("parallel requests", () => {
    it("the same key and the same request from several tabs make ONE order and replay the rest", async () => {
      const { variantId } = await stocked(10, 1_000);
      await add(shopper, variantId, 3);
      const key = randomUUID();
      const body = checkoutBody(3_000);
      const tabs = Array.from({ length: 8 }, () => twinOf(shopper));
      const results = await Promise.all(tabs.map((tab) => checkoutAs(tab, body, key)));
      for (const result of results) {
        expect([200, 201], JSON.stringify(result.body)).toContain(result.status);
      }
      expect(results.filter((result) => result.status === 201)).toHaveLength(1);
      const numbers = new Set(results.map((result) => result.body.order?.number));
      expect(numbers.size).toBe(1);
      placedOrders.track([...numbers][0] ?? "");
      expect(await orderCount(key)).toBe(1);
      const level = await pool.query(
        "select on_hand, reserved from inventory_level where variant_id = $1",
        [variantId],
      );
      expect(level.rows).toEqual([{ on_hand: 10, reserved: 3 }]);
      const row = await orderRow(pool, [...numbers][0] ?? "");
      expect(await reservationsOfOrder(pool, row.id)).toHaveLength(1);
      expect(await changesOf(pool, row.id)).toHaveLength(1);
      // Every answer carries the same token, and it opens the order.
      const tokens = results.map((result) => result.body.accessToken ?? "");
      expect(new Set(tokens).size).toBe(1);
      const opened = await Promise.all(
        tokens.map((token) => lookup(shopper, [...numbers][0] ?? "", token)),
      );
      expect(opened.every((result) => result.status === 200)).toBe(true);
    });

    it("a double submit gives both answers the same working token (20 rounds): lookup and cancel open with the 201 answer", async () => {
      for (let round = 0; round < 20; round += 1) {
        const roundShopper = new Shopper(running.baseUrl);
        const { variantId } = await stocked(10, 1_000);
        await add(roundShopper, variantId, 1);
        const key = randomUUID();
        const body = checkoutBody(1_000);
        const results = await Promise.all([
          checkoutAs(twinOf(roundShopper), body, key),
          checkoutAs(twinOf(roundShopper), body, key),
        ]);
        const statuses = results.map((result) => result.status).sort();
        expect(statuses, `round ${String(round)}`).toEqual([200, 201]);
        const created = results.find((result) => result.status === 201);
        const replayed = results.find((result) => result.status === 200);
        const number = created?.body.order?.number ?? "";
        placedOrders.track(number);
        const token = created?.body.accessToken ?? "";
        expect(token, `round ${String(round)}`).toMatch(TOKEN);
        expect(replayed?.body.accessToken, `round ${String(round)}`).toBe(token);
        const opened = await lookup(roundShopper, number, token);
        expect(opened.status, `round ${String(round)}`).toBe(200);
        const cancelled = await roundShopper.post<CheckoutResult>("/store/orders/cancel", {
          number,
          accessToken: token,
        });
        expect(cancelled.status, `round ${String(round)} ${JSON.stringify(cancelled.body)}`).toBe(
          200,
        );
      }
    });

    it("two different keys for one cart make one order; the second sees an empty cart", async () => {
      const { variantId } = await stocked(10, 1_000);
      await add(shopper, variantId, 4);
      const [one, two] = await Promise.all([
        checkoutAs(twinOf(shopper), checkoutBody(4_000), randomUUID()),
        checkoutAs(twinOf(shopper), checkoutBody(4_000), randomUUID()),
      ]);
      const statuses = [one.status, two.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = one.status === 409 ? one : two;
      const winner = one.status === 201 ? one : two;
      placedOrders.track(winner.body.order?.number ?? "");
      expect(loser.body).toMatchObject({ code: "cart_empty" });
      const level = await pool.query("select reserved from inventory_level where variant_id = $1", [
        variantId,
      ]);
      expect(level.rows).toEqual([{ reserved: 4 }]);
    });

    it("two different keys for one signed-in customer's cart make one order, whatever the number of devices", async () => {
      const account = await createTestCustomer(db, { password: PASSWORD });
      customers.push(account.id);
      const devices = await Promise.all(
        Array.from({ length: 4 }, async () => {
          const device = new Shopper(running.baseUrl);
          const login = await device.post("/store/account/login", {
            email: account.email,
            password: PASSWORD,
          });
          expect(login.status).toBe(200);
          return device;
        }),
      );
      const { variantId } = await stocked(10, 1_000);
      await add(devices[0] as Shopper, variantId, 4);
      const results = await Promise.all(
        devices.map((device) => checkoutAs(device, checkoutBody(4_000), randomUUID())),
      );
      expect(results.filter((result) => result.status === 201)).toHaveLength(1);
      expect(results.filter((result) => result.status === 409)).toHaveLength(3);
      for (const result of results) {
        placedOrders.track(result.body.order?.number ?? "");
        if (result.status === 409) {
          expect(result.body).toMatchObject({ code: "cart_empty" });
        }
      }
      const level = await pool.query("select reserved from inventory_level where variant_id = $1", [
        variantId,
      ]);
      expect(level.rows).toEqual([{ reserved: 4 }]);
    });

    it("the same key from two different carts makes one order; the other is idempotency_key_reused and leaves nothing behind", async () => {
      const a = await stocked(10, 1_000);
      const b = await stocked(10, 1_000);
      const alice = new Shopper(running.baseUrl);
      const bob = new Shopper(running.baseUrl);
      await add(alice, a.variantId, 2);
      await add(bob, b.variantId, 2);
      const key = randomUUID();
      const [first, second] = await Promise.all([
        checkoutAs(alice, checkoutBody(2_000), key),
        checkoutAs(bob, checkoutBody(2_000), key),
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const winner = first.status === 201 ? first : second;
      const loser = first.status === 201 ? second : first;
      placedOrders.track(winner.body.order?.number ?? "");
      expect(loser.body).toMatchObject({ code: "idempotency_key_reused" });
      expect(await orderCount(key)).toBe(1);
      const loserVariant = first.status === 201 ? b.variantId : a.variantId;
      const level = await pool.query("select reserved from inventory_level where variant_id = $1", [
        loserVariant,
      ]);
      expect(level.rows).toEqual([{ reserved: 0 }]);
      const loserShopper = first.status === 201 ? bob : alice;
      expect((await loserShopper.get<CartResult>("/store/cart")).body.lines).toHaveLength(1);
    });
  });
});
