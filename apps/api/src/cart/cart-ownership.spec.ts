import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { customer as customerTable } from "../database/schema/index.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import {
  cartRowOfCustomer,
  cartRowsOfToken,
  itemsOfCart,
  quantities,
  sha256Hex,
  type CartResult,
} from "../test/cart-helpers.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { Shopper } from "../test/shopper.js";

const START = new Date("2033-03-01T08:00:00.000Z");
const PASSWORD = "correct horse battery staple";

describe("cart API: ownership, customers and concurrency", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const customers: string[] = [];
  let running: RunningApp;
  let db: Database;

  const browser = () => new Shopper(running.baseUrl);
  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const read = async (who: Shopper) => (await who.get<CartResult>("/store/cart")).body;

  async function newCustomer(): Promise<TestCustomer> {
    const made = await createTestCustomer(db, { password: PASSWORD });
    customers.push(made.id);
    return made;
  }

  async function signedIn(who: Shopper, shopperAccount: TestCustomer): Promise<void> {
    const result = await who.post("/store/account/login", {
      email: shopperAccount.email,
      password: PASSWORD,
    });
    expect(result.status).toBe(200);
  }

  async function guestCart(who: Shopper) {
    const [row] = await cartRowsOfToken(pool, who.cookie("fluxkit_cart") ?? "");
    if (row === undefined) {
      throw new Error("Test setup bug: no guest cart for the cookie");
    }
    return row;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    await catalog.init();
  });

  beforeEach(() => {
    // A fresh rate-limit window per test (login: 20 per 10 minutes, cart writes: 120 per minute).
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    await deleteTestCustomers(db, customers.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  describe("a cart is found through its own cookie only (IDOR by construction)", () => {
    it("keeps two shoppers' carts apart: one's writes never reach the other's cart", async () => {
      const x = await catalog.simple({ price: 100 });
      const y = await catalog.simple({ price: 200 });
      const alice = browser();
      const bob = browser();
      await add(alice, x.variantId, 2);
      await add(bob, y.variantId, 5);
      const aliceCart = await guestCart(alice);
      const bobCart = await guestCart(bob);
      expect(aliceCart.id).not.toBe(bobCart.id);

      expect(quantities(await read(alice))).toEqual({ [x.variantId]: 2 });
      expect(quantities(await read(bob))).toEqual({ [y.variantId]: 5 });

      // Bob addresses Alice's line: he has no such line in HIS cart.
      const patched = await bob.patch(`/store/cart/items/${x.variantId}`, { quantity: 99 });
      expect(patched.status).toBe(404);
      expect((await bob.delete(`/store/cart/items/${x.variantId}`)).status).toBe(404);
      await bob.post("/store/cart/acknowledge");
      await bob.delete("/store/cart");

      const rows = await itemsOfCart(pool, aliceCart.id);
      expect(rows.map((row) => [row.variant_id, row.quantity])).toEqual([[x.variantId, 2]]);
      expect(quantities(await read(alice))).toEqual({ [x.variantId]: 2 });
    });

    it("an unknown or altered token is no cart: a read is empty, a write starts a new cart, nobody else's is touched", async () => {
      const x = await catalog.simple();
      const alice = browser();
      await add(alice, x.variantId, 3);
      const token = alice.cookie("fluxkit_cart") ?? "";
      const tampered = (token.startsWith("A") ? "B" : "A") + token.slice(1);

      const mallory = browser();
      mallory.setCookie("fluxkit_cart", tampered);
      expect((await read(mallory)).lines).toEqual([]);
      const written = await add(mallory, x.variantId, 1);
      expect(written.body.itemCount).toBe(1);
      expect(mallory.cookie("fluxkit_cart")).not.toBe(tampered);
      expect(mallory.cookie("fluxkit_cart")).not.toBe(token);
      expect(quantities(await read(alice))).toEqual({ [x.variantId]: 3 });
    });

    it("nothing but the cookie names a cart: its id, its hash, other headers and other cookies give no access", async () => {
      const x = await catalog.simple();
      const alice = browser();
      await add(alice, x.variantId, 3);
      const row = await guestCart(alice);
      const token = alice.cookie("fluxkit_cart") ?? "";

      const probes: Record<string, string>[] = [
        { cookie: `fluxkit_cart=${row.id}` },
        { cookie: `fluxkit_cart=${row.token_hash}` },
        { cookie: `fluxkit_cart=${sha256Hex(token)}` },
        { cookie: `cart=${token}` },
        { cookie: `fluxkit_customer_session=${token}` },
        { "x-cart-id": row.id, "x-cart-token": token },
        { authorization: `Bearer ${token}` },
      ];
      for (const headers of probes) {
        const who = browser();
        const result = await who.request<CartResult>("GET", `/store/cart`, { headers });
        expect(result.status).toBe(200);
        expect(result.body.lines, JSON.stringify(headers)).toEqual([]);
      }
      // The same token in the query string or the body is not read either.
      const viaQuery = await browser().get<CartResult>(`/store/cart?token=${token}`);
      expect(viaQuery.status).toBe(400);
    });

    it("the hash stored in the database is not a credential", async () => {
      const x = await catalog.simple();
      const alice = browser();
      await add(alice, x.variantId, 3);
      const row = await guestCart(alice);
      const thief = browser();
      thief.setCookie("fluxkit_cart", (row.token_hash ?? "").slice(0, 43));
      expect((await read(thief)).lines).toEqual([]);
      expect((await add(thief, x.variantId)).body.itemCount).toBe(1);
      expect(quantities(await read(alice))).toEqual({ [x.variantId]: 3 });
    });
  });

  describe("customer carts and guest carts stay separate", () => {
    it("a signed-in customer's first write creates a cart bound to the account: no token hash, no cart cookie", async () => {
      const account = await newCustomer();
      const x = await catalog.simple({ price: 100 });
      const who = browser();
      await signedIn(who, account);
      const result = await add(who, x.variantId, 2);
      expect(result.status).toBe(200);
      expect(
        result.headers.getSetCookie().some((cookie) => cookie.startsWith("fluxkit_cart=")),
      ).toBe(false);
      expect(who.cookie("fluxkit_cart")).toBeUndefined();
      const row = await cartRowOfCustomer(pool, account.id);
      expect(row).toMatchObject({ customer_id: account.id, token_hash: null });
      expect(row?.expires_at.getTime()).toBe(clock.now().getTime() + 30 * 24 * 3600 * 1000);
      expect(quantities(await read(who))).toEqual({ [x.variantId]: 2 });
    });

    it("the cart cookie is ignored while a customer session is present, and both carts survive each other", async () => {
      const account = await newCustomer();
      const guestVariant = await catalog.simple({ price: 100 });
      const customerVariant = await catalog.simple({ price: 300 });
      const guest = browser();
      await add(guest, guestVariant.variantId, 4);
      const guestToken = guest.cookie("fluxkit_cart") ?? "";
      const guestRow = await guestCart(guest);

      // A browser that signed in without the guest cart cookie, then somehow holds a stale guest cookie.
      const who = browser();
      await signedIn(who, account);
      await add(who, customerVariant.variantId, 1);
      who.setCookie("fluxkit_cart", guestToken);
      expect(quantities(await read(who))).toEqual({ [customerVariant.variantId]: 1 });
      const written = await add(who, customerVariant.variantId, 1);
      expect(written.body.lines).toHaveLength(1);
      expect(written.body.itemCount).toBe(2);
      expect(
        written.headers.getSetCookie().some((cookie) => cookie.startsWith("fluxkit_cart=")),
      ).toBe(false);
      await who.delete(`/store/cart/items/${guestVariant.variantId}`);

      // The guest cart was not read, written, deleted or renewed.
      const rows = await itemsOfCart(pool, guestRow.id);
      expect(rows.map((row) => [row.variant_id, row.quantity])).toEqual([
        [guestVariant.variantId, 4],
      ]);
      const after = await guestCart(guest);
      expect(after.updated_at.getTime()).toBe(guestRow.updated_at.getTime());
      expect(after.expires_at.getTime()).toBe(guestRow.expires_at.getTime());
      expect(guest.cookie("fluxkit_cart")).toBe(guestToken);
      // DELETE /store/cart of the customer deletes the customer's cart only.
      expect((await who.delete("/store/cart")).status).toBe(204);
      expect(await cartRowOfCustomer(pool, account.id)).toBeUndefined();
      expect(quantities(await read(guest))).toEqual({ [guestVariant.variantId]: 4 });
    });

    it("two customers have two carts; neither can reach the other's", async () => {
      const one = await newCustomer();
      const two = await newCustomer();
      const x = await catalog.simple();
      const y = await catalog.simple();
      const first = browser();
      const second = browser();
      await signedIn(first, one);
      await signedIn(second, two);
      await add(first, x.variantId, 1);
      await add(second, y.variantId, 6);
      expect(quantities(await read(first))).toEqual({ [x.variantId]: 1 });
      expect(quantities(await read(second))).toEqual({ [y.variantId]: 6 });
      expect((await second.patch(`/store/cart/items/${x.variantId}`, { quantity: 9 })).status).toBe(
        404,
      );
      const rowOne = await cartRowOfCustomer(pool, one.id);
      const rowTwo = await cartRowOfCustomer(pool, two.id);
      expect(rowOne?.id).not.toBe(rowTwo?.id);
      // One cart per customer, enforced by the database.
      await expect(
        pool.query(
          "insert into cart (customer_id, expires_at) values ($1, now() + interval '1 day')",
          [one.id],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("a customer session that is no longer valid makes the shopper a guest again", async () => {
      const account = await newCustomer();
      const x = await catalog.simple();
      const y = await catalog.simple();
      const who = browser();
      await signedIn(who, account);
      await add(who, x.variantId, 2);
      await db
        .update(customerTable)
        .set({ isActive: false })
        .where(eq(customerTable.id, account.id));
      // The deactivated customer is anonymous now: no cart cookie, so an empty cart; a write makes a guest cart.
      expect((await read(who)).lines).toEqual([]);
      const written = await add(who, y.variantId, 1);
      expect(written.status).toBe(200);
      expect(who.cookie("fluxkit_cart")).toBeDefined();
      expect(quantities(written.body)).toEqual({ [y.variantId]: 1 });
    });

    it("deleting the customer deletes the cart and its lines", async () => {
      const account = await newCustomer();
      const x = await catalog.simple();
      const who = browser();
      await signedIn(who, account);
      await add(who, x.variantId, 2);
      const row = await cartRowOfCustomer(pool, account.id);
      expect(row).toBeDefined();
      await deleteTestCustomers(db, [account.id]);
      customers.splice(customers.indexOf(account.id), 1);
      expect((await pool.query("select 1 from cart where id = $1", [row?.id])).rowCount).toBe(0);
      expect(
        (await pool.query("select 1 from cart_item where cart_id = $1", [row?.id])).rowCount,
      ).toBe(0);
    });
  });

  describe("concurrent writes", () => {
    it("parallel first writes of one signed-in customer create exactly one cart and lose no unit", async () => {
      const account = await newCustomer();
      const x = await catalog.simple({ price: 10 });
      const sessions = [browser(), browser(), browser()];
      for (const who of sessions) {
        await signedIn(who, account);
      }
      const results = await Promise.all(
        Array.from({ length: 12 }, (_unused, index) =>
          add(sessions[index % sessions.length] ?? browser(), x.variantId, 1),
        ),
      );
      expect(results.map((result) => result.status)).toEqual(Array(12).fill(200));
      const carts = await pool.query("select id from cart where customer_id = $1", [account.id]);
      expect(carts.rowCount).toBe(1);
      const rows = await itemsOfCart(pool, (carts.rows[0] as { id: string }).id);
      expect(rows.map((row) => [row.variant_id, row.quantity])).toEqual([[x.variantId, 12]]);
    });

    it("parallel adds to one guest cart lose no unit (the cart row is locked)", async () => {
      const x = await catalog.simple({ price: 10 });
      const y = await catalog.simple({ price: 10 });
      const who = browser();
      await add(who, y.variantId, 1);
      const cookie = who.cookie("fluxkit_cart") ?? "";
      const results = await Promise.all(
        Array.from({ length: 15 }, () => {
          const tab = browser();
          tab.setCookie("fluxkit_cart", cookie);
          return add(tab, x.variantId, 2);
        }),
      );
      expect(results.map((result) => result.status)).toEqual(Array(15).fill(200));
      expect(quantities(await read(who))).toEqual({ [y.variantId]: 1, [x.variantId]: 30 });
    });

    it("parallel adds of different variants keep every line", async () => {
      const variants = await Promise.all(Array.from({ length: 10 }, () => catalog.simple()));
      const who = browser();
      await add(who, variants[0]?.variantId ?? "");
      const cookie = who.cookie("fluxkit_cart") ?? "";
      const results = await Promise.all(
        variants.slice(1).map((variant) => {
          const tab = browser();
          tab.setCookie("fluxkit_cart", cookie);
          return add(tab, variant.variantId, 1);
        }),
      );
      expect(results.map((result) => result.status)).toEqual(Array(9).fill(200));
      expect(Object.keys(quantities(await read(who))).sort()).toEqual(
        variants.map((variant) => variant.variantId).sort(),
      );
    });

    it("mixed parallel adds, sets, removes and deletes never fail with a server error", async () => {
      const x = await catalog.simple();
      const y = await catalog.simple();
      const who = browser();
      await add(who, x.variantId, 2);
      const cookie = who.cookie("fluxkit_cart") ?? "";
      const tab = () => {
        const next = browser();
        next.setCookie("fluxkit_cart", cookie);
        return next;
      };
      const results = await Promise.all([
        add(tab(), y.variantId, 1),
        tab().patch<CartResult>(`/store/cart/items/${x.variantId}`, { quantity: 5 }),
        tab().delete<CartResult>(`/store/cart/items/${y.variantId}`),
        tab().post<CartResult>("/store/cart/acknowledge"),
        tab().delete<CartResult>("/store/cart"),
        add(tab(), x.variantId, 1),
        tab().get<CartResult>("/store/cart"),
      ]);
      for (const result of results) {
        expect([200, 204, 404], JSON.stringify(result.body)).toContain(result.status);
      }
    });

    it("two first writes without a cookie are two independent carts, each with its own cookie", async () => {
      const x = await catalog.simple();
      const [one, two] = [browser(), browser()];
      const results = await Promise.all([add(one, x.variantId, 1), add(two, x.variantId, 2)]);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      expect(one.cookie("fluxkit_cart")).not.toBe(two.cookie("fluxkit_cart"));
      expect((await guestCart(one)).id).not.toBe((await guestCart(two)).id);
      expect(quantities(await read(one))).toEqual({ [x.variantId]: 1 });
      expect(quantities(await read(two))).toEqual({ [x.variantId]: 2 });
    });

    it("two parallel first writes with the same cookie that matches no cart each get their own new cart", async () => {
      const x = await catalog.simple();
      const stale = "D".repeat(43);
      const [one, two] = [browser(), browser()];
      one.setCookie("fluxkit_cart", stale);
      two.setCookie("fluxkit_cart", stale);
      const results = await Promise.all([add(one, x.variantId, 1), add(two, x.variantId, 1)]);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      expect(await cartRowsOfToken(pool, stale)).toEqual([]);
      expect(one.cookie("fluxkit_cart")).not.toBe(two.cookie("fluxkit_cart"));
    });

    it("a random UUID never becomes a cart by being used as a variant", async () => {
      const who = browser();
      expect((await add(who, randomUUID())).status).toBe(404);
      expect(who.cookie("fluxkit_cart")).toBeUndefined();
    });
  });
});
