import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import {
  cartRowOfCustomer,
  cartRowsOfToken,
  itemsOfCart,
  quantities,
  type CartResult,
} from "../test/cart-helpers.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import type { HttpResult } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { Shopper, setCookieOf } from "../test/shopper.js";

const START = new Date("2034-03-01T08:00:00.000Z");
const PASSWORD = "correct horse battery staple";

type SignIn = HttpResult<{ customer: { id: string }; cartNotices: { code: string }[] }>;

describe("cart merge at login and registration", () => {
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
  const login = (who: Shopper, account: TestCustomer, password = PASSWORD) =>
    who.post<SignIn["body"]>("/store/account/login", {
      email: account.email,
      password,
    }) as Promise<SignIn>;

  async function newCustomer(): Promise<TestCustomer> {
    const made = await createTestCustomer(db, { password: PASSWORD });
    customers.push(made.id);
    return made;
  }

  async function guestWith(lines: [string, number][]): Promise<Shopper> {
    const who = browser();
    for (const [variantId, quantity] of lines) {
      expect((await add(who, variantId, quantity)).status).toBe(200);
    }
    return who;
  }

  /** A customer with a cart of the given lines, built through a signed-in browser. */
  async function customerWith(lines: [string, number][]): Promise<TestCustomer> {
    const account = await newCustomer();
    const who = browser();
    expect((await login(who, account)).status).toBe(200);
    for (const [variantId, quantity] of lines) {
      expect((await add(who, variantId, quantity)).status).toBe(200);
    }
    return account;
  }

  const guestRowOf = async (who: Shopper) =>
    (await cartRowsOfToken(pool, who.cookie("fluxkit_cart") ?? ""))[0];

  async function customerLines(account: TestCustomer) {
    const row = await cartRowOfCustomer(pool, account.id);
    return row === undefined ? [] : itemsOfCart(pool, row.id);
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    await catalog.init();
  });

  beforeEach(() => {
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

  describe("login", () => {
    it("moves the guest lines into a customer who has no cart, deletes the guest cart and clears the cookie", async () => {
      const a = await catalog.simple({ price: 100 });
      const b = await catalog.simple({ price: 200 });
      const guest = await guestWith([
        [a.variantId, 2],
        [b.variantId, 1],
      ]);
      const guestRow = await guestRowOf(guest);
      await catalog.setPrice(a.variantId, 150);
      const account = await newCustomer();

      const result = await login(guest, account);
      expect(result.status).toBe(200);
      expect(Object.keys(result.body)).toEqual(["customer", "cartNotices"]);
      expect(result.body.cartNotices).toEqual([]);

      // The cookie is cleared with the flags it was set with.
      const cleared = setCookieOf(result, "fluxkit_cart") ?? "";
      expect(cleared).toMatch(/^fluxkit_cart=;/);
      expect(cleared).toContain("Path=/store");
      expect(cleared).toContain("Expires=Thu, 01 Jan 1970");
      expect(guest.cookie("fluxkit_cart")).toBeUndefined();

      expect((await pool.query("select 1 from cart where id = $1", [guestRow?.id])).rowCount).toBe(
        0,
      );
      const cart = await read(guest);
      expect(cart.lines.map((line) => [line.variantId, line.quantity])).toEqual([
        [a.variantId, 2],
        [b.variantId, 1],
      ]);
      // The price the guest saw survives the merge, so the change since then still shows.
      expect(cart.lines[0]?.notices).toEqual([
        { code: "price_changed", previousAmount: { amount: 100, currency: "UAH" } },
      ]);
      const row = await cartRowOfCustomer(pool, account.id);
      expect(row).toMatchObject({ customer_id: account.id, token_hash: null });
      expect(row?.expires_at.getTime()).toBe(clock.now().getTime() + 30 * 24 * 3600 * 1000);
    });

    it("adds quantities of shared variants, keeps the customer's older seen price, appends guest-only lines in guest order", async () => {
      const [a, b, c, d] = await Promise.all(
        [1, 2, 3, 4].map(() => catalog.simple({ price: 100 })),
      );
      if (a === undefined || b === undefined || c === undefined || d === undefined)
        throw new Error("fixture");
      const account = await customerWith([
        [a.variantId, 2],
        [c.variantId, 1],
      ]);
      await catalog.setPrice(a.variantId, 150);
      const guest = await guestWith([
        [d.variantId, 1],
        [a.variantId, 3],
        [b.variantId, 4],
      ]);

      const result = await login(guest, account);
      expect(result.body.cartNotices).toEqual([]);
      const cart = await read(guest);
      expect(cart.lines.map((line) => [line.variantId, line.quantity])).toEqual([
        [a.variantId, 5],
        [c.variantId, 1],
        [d.variantId, 1],
        [b.variantId, 4],
      ]);
      // A keeps the customer's older price (100): the change to 150 is still announced.
      expect(cart.lines[0]?.notices).toEqual([
        { code: "price_changed", previousAmount: { amount: 100, currency: "UAH" } },
      ]);
      expect(cart.lines[2]?.notices).toEqual([]);
      const rows = await customerLines(account);
      expect(rows.map((row) => row.variant_id)).toEqual([
        a.variantId,
        c.variantId,
        d.variantId,
        b.variantId,
      ]);
      expect(rows).toHaveLength(4);
    });

    it("caps a merged quantity at 999 with the quantity_capped notice", async () => {
      const a = await catalog.simple({ price: 1 });
      const account = await customerWith([[a.variantId, 600]]);
      const guest = await guestWith([[a.variantId, 600]]);
      const result = await login(guest, account);
      expect(result.body.cartNotices).toEqual([{ code: "quantity_capped" }]);
      expect(quantities(await read(guest))).toEqual({ [a.variantId]: 999 });
    });

    it("drops guest-only lines beyond 100 with the lines_dropped notice and keeps the first ones", async () => {
      const variants = await Promise.all(Array.from({ length: 120 }, () => catalog.simple()));
      const ids = variants.map((variant) => variant.variantId);
      const account = await customerWith(ids.slice(0, 60).map((id): [string, number] => [id, 1]));
      const guest = await guestWith(ids.slice(60).map((id): [string, number] => [id, 2]));
      const result = await login(guest, account);
      expect(result.status).toBe(200);
      expect(result.body.cartNotices).toEqual([{ code: "lines_dropped" }]);
      const cart = await read(guest);
      expect(cart.lines.map((line) => line.variantId)).toEqual(ids.slice(0, 100));
      expect((await customerLines(account)).length).toBe(100);
    });

    it("reports both notices, capped first, and still merges lines that fit", async () => {
      const variants = await Promise.all(
        Array.from({ length: 105 }, () => catalog.simple({ price: 1 })),
      );
      const ids = variants.map((variant) => variant.variantId);
      const account = await customerWith(ids.slice(0, 99).map((id): [string, number] => [id, 998]));
      const guest = await guestWith([
        [ids[0] ?? "", 5],
        ...ids.slice(99, 105).map((id): [string, number] => [id, 1]),
      ]);
      const result = await login(guest, account);
      expect(result.body.cartNotices).toEqual([
        { code: "quantity_capped" },
        { code: "lines_dropped" },
      ]);
      const cart = await read(guest);
      expect(cart.lines).toHaveLength(100);
      expect(cart.lines[0]?.quantity).toBe(999);
    });

    it("a guest cookie that matches no cart merges nothing, creates no customer cart and is cleared", async () => {
      const account = await newCustomer();
      const who = browser();
      who.setCookie("fluxkit_cart", "E".repeat(43));
      const result = await login(who, account);
      expect(result.status).toBe(200);
      expect(result.body.cartNotices).toEqual([]);
      expect(setCookieOf(result, "fluxkit_cart")).toMatch(/^fluxkit_cart=;/);
      expect(await cartRowOfCustomer(pool, account.id)).toBeUndefined();
    });

    it("without a guest cookie it touches no cart and sets no cart cookie", async () => {
      const a = await catalog.simple();
      const account = await customerWith([[a.variantId, 2]]);
      const before = await cartRowOfCustomer(pool, account.id);
      const who = browser();
      const result = await login(who, account);
      expect(result.status).toBe(200);
      expect(setCookieOf(result, "fluxkit_cart")).toBeUndefined();
      const after = await cartRowOfCustomer(pool, account.id);
      expect(after?.updated_at.getTime()).toBe(before?.updated_at.getTime());
      expect(quantities(await read(who))).toEqual({ [a.variantId]: 2 });
    });

    it("an expired guest cart is not merged (and is removed); an expired customer cart starts from nothing", async () => {
      const a = await catalog.simple();
      const b = await catalog.simple();
      const account = await customerWith([[a.variantId, 2]]);
      const staleGuest = await guestWith([[b.variantId, 1]]);
      clock.advanceMinutes(31 * 24 * 60);
      const result = await login(staleGuest, account);
      expect(result.status).toBe(200);
      expect(result.body.cartNotices).toEqual([]);
      expect((await read(staleGuest)).lines).toEqual([]);

      // A fresh guest cart now meets the customer's expired cart.
      const fresh = await guestWith([[b.variantId, 3]]);
      const second = await login(fresh, account);
      expect(second.status).toBe(200);
      expect(quantities(await read(fresh))).toEqual({ [b.variantId]: 3 });
    });

    it("merges when the request also carries the session of another account, and revokes that session", async () => {
      const a = await catalog.simple();
      const other = await newCustomer();
      const account = await newCustomer();
      const guest = await guestWith([[a.variantId, 2]]);
      const who = browser();
      expect((await login(who, other)).status).toBe(200);
      const oldSession = who.cookie("fluxkit_customer_session") ?? "";
      who.setCookie("fluxkit_cart", guest.cookie("fluxkit_cart") ?? "");

      const result = await login(who, account);
      expect(result.status).toBe(200);
      expect(quantities(await read(who))).toEqual({ [a.variantId]: 2 });
      expect((await customerLines(account)).map((row) => row.quantity)).toEqual([2]);
      expect(await cartRowOfCustomer(pool, other.id)).toBeUndefined();
      const stale = browser();
      stale.setCookie("fluxkit_customer_session", oldSession);
      expect((await stale.get("/store/account/me")).status).toBe(401);
    });
  });

  describe("registration", () => {
    it("merges the guest cart into the new account, answers 201 with cartNotices and clears the cookie", async () => {
      const a = await catalog.simple({ price: 100 });
      const guest = await guestWith([[a.variantId, 7]]);
      const email = `merge-register-${catalog.runId}@example.test`;
      const result = await guest.post<{ customer: { id: string }; cartNotices: unknown[] }>(
        "/store/account/register",
        { email, password: PASSWORD, firstName: "Ann", lastName: "Shopper" },
      );
      expect(result.status).toBe(201);
      expect(result.body.cartNotices).toEqual([]);
      customers.push(result.body.customer.id);
      expect(setCookieOf(result, "fluxkit_cart")).toMatch(/^fluxkit_cart=;/);
      expect(guest.cookie("fluxkit_cart")).toBeUndefined();
      expect(quantities(await read(guest))).toEqual({ [a.variantId]: 7 });
      const row = await pool.query("select customer_id from cart where customer_id = $1", [
        result.body.customer.id,
      ]);
      expect(row.rowCount).toBe(1);
    });

    it("a refused registration (taken email, weak password) leaves the guest cart alone", async () => {
      const a = await catalog.simple();
      const taken = await newCustomer();
      const guest = await guestWith([[a.variantId, 2]]);
      const token = guest.cookie("fluxkit_cart");
      for (const body of [
        { email: taken.email, password: PASSWORD, firstName: "A", lastName: "B" },
        {
          email: `weak-${catalog.runId}@example.test`,
          password: "short",
          firstName: "A",
          lastName: "B",
        },
      ]) {
        const result = await guest.post("/store/account/register", body);
        expect([400, 409]).toContain(result.status);
        expect(setCookieOf(result, "fluxkit_cart")).toBeUndefined();
      }
      expect(guest.cookie("fluxkit_cart")).toBe(token);
      expect(quantities(await read(guest))).toEqual({ [a.variantId]: 2 });
      expect(await cartRowOfCustomer(pool, taken.id)).toBeUndefined();
    });
  });

  describe("a failed login never touches the guest cart", () => {
    it.each([
      ["a wrong password", "wrong"],
      ["an unknown email", "unknown"],
      ["a deactivated account", "inactive"],
      ["a locked account", "locked"],
      ["an invalid body", "invalid"],
    ])("%s", async (_name, kind) => {
      const a = await catalog.simple();
      const b = await catalog.simple();
      const account = await customerWith([[b.variantId, 1]]);
      const guest = await guestWith([[a.variantId, 2]]);
      const token = guest.cookie("fluxkit_cart");
      const guestRow = await guestRowOf(guest);
      const customerRowBefore = await cartRowOfCustomer(pool, account.id);

      if (kind === "inactive") {
        await pool.query("update customer set is_active = false where id = $1", [account.id]);
      }
      if (kind === "locked") {
        await pool.query("update customer set locked_until = $2 where id = $1", [
          account.id,
          new Date(clock.now().getTime() + 3_600_000),
        ]);
      }
      const result =
        kind === "unknown"
          ? await guest.post("/store/account/login", {
              email: "nobody@example.test",
              password: PASSWORD,
            })
          : kind === "invalid"
            ? await guest.post("/store/account/login", { email: account.email })
            : await login(guest, account, kind === "wrong" ? "wrong password!!" : PASSWORD);
      expect([400, 401]).toContain(result.status);
      expect(setCookieOf(result, "fluxkit_cart")).toBeUndefined();
      expect(guest.cookie("fluxkit_cart")).toBe(token);

      const after = await guestRowOf(guest);
      expect(after?.id).toBe(guestRow?.id);
      expect(after?.updated_at.getTime()).toBe(guestRow?.updated_at.getTime());
      expect(
        (await itemsOfCart(pool, guestRow?.id ?? "")).map((row) => [row.variant_id, row.quantity]),
      ).toEqual([[a.variantId, 2]]);
      const customerRowAfter = await cartRowOfCustomer(pool, account.id);
      expect(customerRowAfter?.updated_at.getTime()).toBe(customerRowBefore?.updated_at.getTime());
      expect((await customerLines(account)).map((row) => [row.variant_id, row.quantity])).toEqual([
        [b.variantId, 1],
      ]);
    });

    it("and a successful login afterwards still merges that cart", async () => {
      const a = await catalog.simple();
      const account = await newCustomer();
      const guest = await guestWith([[a.variantId, 2]]);
      expect((await login(guest, account, "wrong password!!")).status).toBe(401);
      expect((await login(guest, account)).status).toBe(200);
      expect(quantities(await read(guest))).toEqual({ [a.variantId]: 2 });
    });
  });

  describe("races", () => {
    it("parallel logins with the same guest cookie merge it exactly once", async () => {
      const a = await catalog.simple();
      const b = await catalog.simple();
      const account = await customerWith([[a.variantId, 1]]);
      const guest = await guestWith([
        [a.variantId, 2],
        [b.variantId, 3],
      ]);
      const cookie = guest.cookie("fluxkit_cart") ?? "";
      const results = await Promise.all(
        Array.from({ length: 6 }, () => {
          const tab = browser();
          tab.setCookie("fluxkit_cart", cookie);
          return login(tab, account);
        }),
      );
      expect(results.map((result) => result.status)).toEqual(Array(6).fill(200));
      const rows = await customerLines(account);
      expect(rows.map((row) => [row.variant_id, row.quantity])).toEqual([
        [a.variantId, 3],
        [b.variantId, 3],
      ]);
      expect(await cartRowsOfToken(pool, cookie)).toEqual([]);
      expect(
        (await pool.query("select 1 from cart where customer_id = $1", [account.id])).rowCount,
      ).toBe(1);
    });

    it("parallel logins of two customers with one guest cookie: exactly one gets the lines, nobody deadlocks", async () => {
      const a = await catalog.simple();
      const first = await newCustomer();
      const second = await newCustomer();
      const guest = await guestWith([[a.variantId, 4]]);
      const cookie = guest.cookie("fluxkit_cart") ?? "";
      const tabs = [first, second, first, second].map((account) => {
        const tab = browser();
        tab.setCookie("fluxkit_cart", cookie);
        return login(tab, account);
      });
      const results = await Promise.all(tabs);
      expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
      const totals = [await customerLines(first), await customerLines(second)].map((rows) =>
        rows.reduce((sum, row) => sum + row.quantity, 0),
      );
      expect(totals.sort()).toEqual([0, 4]);
    });

    it("a login that merges while the same customer writes to the cart from another session loses nothing", async () => {
      const a = await catalog.simple();
      const b = await catalog.simple();
      const c = await catalog.simple();
      const account = await customerWith([[a.variantId, 1]]);
      const session = browser();
      await login(session, account);
      const guest = await guestWith([[b.variantId, 5]]);
      const writes = Array.from({ length: 8 }, () => add(session, c.variantId, 1));
      const [merge, ...results] = await Promise.all([login(guest, account), ...writes]);
      expect(merge?.status).toBe(200);
      expect(results.map((result) => result.status)).toEqual(Array(8).fill(200));
      expect(quantities(await read(session))).toEqual({
        [a.variantId]: 1,
        [b.variantId]: 5,
        [c.variantId]: 8,
      });
    });

    it("a customer who has no cart yet and writes while the guest cart is merged ends with one cart", async () => {
      const a = await catalog.simple();
      const b = await catalog.simple();
      const account = await newCustomer();
      const session = browser();
      await login(session, account);
      const guest = await guestWith([[b.variantId, 2]]);
      const [merge, write] = await Promise.all([
        login(guest, account),
        add(session, a.variantId, 1),
      ]);
      expect([merge?.status, write?.status]).toEqual([200, 200]);
      expect(
        (await pool.query("select 1 from cart where customer_id = $1", [account.id])).rowCount,
      ).toBe(1);
      expect(quantities(await read(session))).toEqual({ [a.variantId]: 1, [b.variantId]: 2 });
    });
  });
});
