import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { VariantsService } from "../catalog/admin/variants/variants.service.js";
import { InventoryService } from "../inventory/admin/inventory.service.js";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { type CartResult } from "../test/cart-helpers.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { defaultLocationId, insertAdminUserRow } from "../test/inventory-fixtures.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import {
  checkoutAs,
  checkoutBody,
  itemsOf,
  orderRow,
  type CheckoutResult,
} from "../test/order-http.js";
import { expectLevelInvariants } from "../test/stock-world.js";
import type { HttpResult } from "../test/http.js";
import { Shopper } from "../test/shopper.js";

const START = new Date("2038-03-01T08:00:00.000Z");
const PASSWORD = "correct horse battery staple";
const ROUNDS = 12;

/** Whether the answer is one of the documented outcomes of a checkout (never a 500, a 503 or a lock failure). */
function documented(result: HttpResult<CheckoutResult>): boolean {
  return [200, 201, 409].includes(result.status);
}

describe("checkout under concurrency (real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  const customers: string[] = [];
  let running: RunningApp;
  let db: Database;
  let inventory: InventoryService;
  let adminId = "";
  let mainId = "";

  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const tracked = (onHand: number, price = 1_000) =>
    catalog.simple({ trackInventory: true, onHand, price });
  const levelOf = async (variantId: string) =>
    (
      await pool.query<{ on_hand: number; reserved: number }>(
        "select on_hand, reserved from inventory_level where variant_id = $1",
        [variantId],
      )
    ).rows[0] ?? { on_hand: -1, reserved: -1 };
  const activeHolds = async (variantId: string): Promise<number> =>
    (
      await pool.query<{ n: number }>(
        "select coalesce(sum(quantity), 0)::int as n from reservation where variant_id = $1 and status = 'active'",
        [variantId],
      )
    ).rows[0]?.n ?? -1;
  const ordersOf = async (variantId: string): Promise<number> =>
    (
      await pool.query<{ n: number }>(
        "select count(distinct order_id)::int as n from order_item where variant_id = $1",
        [variantId],
      )
    ).rows[0]?.n ?? -1;

  function track(results: HttpResult<CheckoutResult>[]): void {
    for (const result of results) {
      if (result.body.order?.number !== undefined) {
        placedOrders.track(result.body.order.number);
      }
    }
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

  /** A held transaction: `hold` runs inside it; `release` commits. For tests that need a lock to be taken at a known moment. */
  async function holdTransaction(
    statements: { text: string; values?: unknown[] }[],
  ): Promise<{ commit: () => Promise<void> }> {
    const client = await pool.connect();
    await client.query("begin");
    for (const statement of statements) {
      await client.query(statement.text, statement.values);
    }
    return {
      commit: async () => {
        try {
          await client.query("commit");
        } finally {
          client.release();
        }
      },
    };
  }

  const settledWithin = async (promise: Promise<unknown>, ms: number): Promise<boolean> =>
    Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: {
        checkout: { maxAttempts: 1_000_000, windowMinutes: 10 },
        login: { maxAttempts: 1_000_000, windowMinutes: 10 },
        cartWrite: { maxAttempts: 1_000_000, windowMinutes: 1 },
      },
    });
    db = running.app.get<Database>(DRIZZLE);
    inventory = running.app.get(InventoryService, { strict: false });
    adminId = await insertAdminUserRow(pool);
    mainId = await defaultLocationId(pool);
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    await placedOrders.cleanup();
    await deleteTestCustomers(db, customers.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  describe("the last units are never oversold", () => {
    it("N carts race for K units: exactly K orders, the rest are refused, reserved never passes on hand (many rounds)", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const stock = 1 + (round % 3);
        const buyers = 6;
        const { variantId } = await tracked(stock);
        const shoppers = await Promise.all(
          Array.from({ length: buyers }, async () => {
            const who = new Shopper(running.baseUrl);
            await add(who, variantId, 1);
            return who;
          }),
        );
        const results = await Promise.all(
          shoppers.map((who) => checkoutAs(who, checkoutBody(1_000))),
        );
        track(results);
        expect(results.every(documented), JSON.stringify(results.map((r) => r.status))).toBe(true);
        const won = results.filter((result) => result.status === 201);
        expect(won, `round ${String(round)}`).toHaveLength(stock);
        for (const lost of results.filter((result) => result.status !== 201)) {
          expect(lost.body).toMatchObject({
            code: "checkout_refused",
            errors: [{ path: "lines.0", code: "insufficient_stock" }],
          });
        }
        expect(await levelOf(variantId)).toEqual({ on_hand: stock, reserved: stock });
        expect(await activeHolds(variantId)).toBe(stock);
        expect(await ordersOf(variantId)).toBe(stock);
        await expectLevelInvariants(pool, variantId, mainId);
        // The losers keep their cart: nothing of a refused checkout was consumed.
        for (const [index, result] of results.entries()) {
          if (result.status !== 201) {
            const cart = (await shoppers[index]?.get<CartResult>("/store/cart"))?.body;
            expect(cart?.lines).toHaveLength(1);
          }
        }
      }
    });

    it("quantities that do not divide the stock: as many orders as fit, never more units than on hand", async () => {
      const { variantId } = await tracked(10);
      const shoppers = await Promise.all(
        Array.from({ length: 8 }, async () => {
          const who = new Shopper(running.baseUrl);
          await add(who, variantId, 2);
          return who;
        }),
      );
      const results = await Promise.all(
        shoppers.map((who) => checkoutAs(who, checkoutBody(2_000))),
      );
      track(results);
      expect(results.filter((result) => result.status === 201)).toHaveLength(5);
      expect(await levelOf(variantId)).toEqual({ on_hand: 10, reserved: 10 });
      await expectLevelInvariants(pool, variantId, mainId);
    });
  });

  describe("crossing carts", () => {
    it("two carts with the same variants in opposite order never deadlock and both succeed when stock is ample (many rounds)", async () => {
      const a = await tracked(10_000);
      const b = await tracked(10_000);
      const c = await tracked(10_000);
      for (let round = 0; round < ROUNDS * 2; round += 1) {
        const first = new Shopper(running.baseUrl);
        const second = new Shopper(running.baseUrl);
        for (const variant of [a, b, c]) await add(first, variant.variantId, 1);
        for (const variant of [c, b, a]) await add(second, variant.variantId, 1);
        const results = await Promise.all([
          checkoutAs(first, checkoutBody(3_000)),
          checkoutAs(second, checkoutBody(3_000)),
        ]);
        track(results);
        expect(
          results.map((result) => result.status),
          JSON.stringify(results.map((r) => r.body)),
        ).toEqual([201, 201]);
      }
      for (const variant of [a, b, c]) {
        await expectLevelInvariants(pool, variant.variantId, mainId);
      }
    });

    it("scarce crossing stock: one cart wins ALL its lines, the other none (all or nothing), many rounds", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const a = await tracked(1);
        const b = await tracked(1);
        const first = new Shopper(running.baseUrl);
        const second = new Shopper(running.baseUrl);
        await add(first, a.variantId, 1);
        await add(first, b.variantId, 1);
        await add(second, b.variantId, 1);
        await add(second, a.variantId, 1);
        const results = await Promise.all([
          checkoutAs(first, checkoutBody(2_000)),
          checkoutAs(second, checkoutBody(2_000)),
        ]);
        track(results);
        expect(results.every(documented)).toBe(true);
        expect(
          results.filter((result) => result.status === 201),
          `round ${String(round)}`,
        ).toHaveLength(1);
        const loser = results.find((result) => result.status !== 201);
        expect(loser?.body).toMatchObject({ code: "checkout_refused" });
        expect(loser?.body.errors).toHaveLength(2);
        expect(await levelOf(a.variantId)).toEqual({ on_hand: 1, reserved: 1 });
        expect(await levelOf(b.variantId)).toEqual({ on_hand: 1, reserved: 1 });
        expect(await activeHolds(a.variantId)).toBe(1);
        expect(await activeHolds(b.variantId)).toBe(1);
      }
    });
  });

  describe("checkout against writes of the catalog and the stock", () => {
    it("holds the product lock while it works: an unpublish or a price write waits until the order is committed", async () => {
      const { variantId, productId } = await tracked(5, 1_000);
      const who = new Shopper(running.baseUrl);
      await add(who, variantId, 2);
      // Block the checkout late in its run: it holds the cart, product and variant locks and waits for the level row.
      const blocker = await holdTransaction([
        {
          text: "select 1 from inventory_level where variant_id = $1 for update",
          values: [variantId],
        },
      ]);
      const checkout = checkoutAs(who, checkoutBody(2_000));
      expect(await settledWithin(checkout, 500)).toBe(false);

      // An admin write takes the product row first (publishing, unpublishing, price writes, variant edits all do).
      const writer = pool.connect().then(async (client) => {
        await client.query("begin");
        await client.query("select 1 from product where id = $1 for update", [productId]);
        await client.query("update price set amount = 1500 where variant_id = $1", [variantId]);
        await client.query("commit");
        client.release();
      });
      expect(await settledWithin(writer, 500), "the writer must wait for the checkout").toBe(false);

      await blocker.commit();
      const placed = await checkout;
      await writer;
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      track([placed]);
      // The order was priced before the write and keeps that price; the cart is gone, nothing is half-priced.
      expect(placed.body.order?.total.amount).toBe(2_000);
      const row = await orderRow(pool, placed.body.order?.number ?? "");
      expect((await itemsOf(pool, row.id))[0]?.unit_amount).toBe("1000");
    });

    it("holds the variant row too: a variant edit that locks only the variant waits for the checkout", async () => {
      const { variantId } = await tracked(5, 1_000);
      const who = new Shopper(running.baseUrl);
      await add(who, variantId, 1);
      const blocker = await holdTransaction([
        {
          text: "select 1 from inventory_level where variant_id = $1 for update",
          values: [variantId],
        },
      ]);
      const checkout = checkoutAs(who, checkoutBody(1_000));
      expect(await settledWithin(checkout, 500)).toBe(false);
      const writer = pool.query("update variant set is_active = false where id = $1", [variantId]);
      expect(await settledWithin(writer, 500), "the switch-off must wait for the checkout").toBe(
        false,
      );
      await blocker.commit();
      const placed = await checkout;
      await writer;
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      track([placed]);
    });

    it.each([
      [
        "an unpublish",
        (productId: string) => [
          { text: "select 1 from product where id = $1 for update", values: [productId] },
          { text: "update product set status = 'draft' where id = $1", values: [productId] },
        ],
        "unavailable",
      ],
      [
        "a price write",
        (productId: string, variantId: string) => [
          { text: "select 1 from product where id = $1 for update", values: [productId] },
          { text: "update price set amount = 1500 where variant_id = $1", values: [variantId] },
        ],
        "price",
      ],
      [
        "a variant switch-off",
        (productId: string, variantId: string) => [
          { text: "select 1 from product where id = $1 for update", values: [productId] },
          { text: "update variant set is_active = false where id = $1", values: [variantId] },
        ],
        "unavailable",
      ],
    ] as const)(
      "waits for %s that is already in progress and then sees its result (cart_changed, nothing reserved)",
      async (_name, statementsFor, kind) => {
        const { variantId, productId } = await tracked(5, 1_000);
        const who = new Shopper(running.baseUrl);
        await add(who, variantId, 2);
        const writer = await holdTransaction([...statementsFor(productId, variantId)]);
        const checkout = checkoutAs(who, checkoutBody(2_000));
        expect(await settledWithin(checkout, 500), "the checkout must wait for the writer").toBe(
          false,
        );
        await writer.commit();
        const result = await checkout;
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(result.body).toMatchObject({ code: "cart_changed" });
        const fresh = (result.body as unknown as { cart: CartResult }).cart;
        if (kind === "price") {
          expect(fresh.total.amount).toBe(3_000);
        } else {
          expect(fresh.lines[0]?.notices).toEqual([{ code: "unavailable" }]);
        }
        expect(await levelOf(variantId)).toEqual({ on_hand: 5, reserved: 0 });
        expect(await ordersOf(variantId)).toBe(0);
      },
    );

    it("a price write that finished before the checkout read is priced at the new price when the shopper agrees to it", async () => {
      const { variantId, productId } = await tracked(5, 1_000);
      const who = new Shopper(running.baseUrl);
      await add(who, variantId, 2);
      const writer = await holdTransaction([
        { text: "select 1 from product where id = $1 for update", values: [productId] },
        { text: "update price set amount = 1500 where variant_id = $1", values: [variantId] },
      ]);
      const checkout = checkoutAs(who, checkoutBody(3_000));
      expect(await settledWithin(checkout, 500)).toBe(false);
      await writer.commit();
      const result = await checkout;
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      track([result]);
      expect(result.body.order?.total.amount).toBe(3_000);
    });

    it("a variant deleted while the checkout waits for the locks is a changed cart, not a half order", async () => {
      const product = await catalog.product({ withColors: true });
      const keep = await catalog.variant(product.id, { color: "red", price: 500 });
      const doomed = await catalog.variant(product.id, { color: "blue", price: 700 });
      const who = new Shopper(running.baseUrl);
      await add(who, keep, 1);
      await add(who, doomed, 1);
      const writer = await holdTransaction([
        { text: "select 1 from product where id = $1 for update", values: [product.id] },
        { text: "delete from variant where id = $1", values: [doomed] },
      ]);
      const checkout = checkoutAs(who, checkoutBody(1_200));
      expect(await settledWithin(checkout, 500)).toBe(false);
      await writer.commit();
      const result = await checkout;
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body).toMatchObject({ code: "cart_changed" });
      expect((result.body as unknown as { cart: CartResult }).cart.lines).toHaveLength(1);
      expect(await ordersOf(keep)).toBe(0);
    });

    it("a variant delete that arrives after the order is refused (an order line refers to the variant)", async () => {
      // An untracked (digital) variant has no stock rows, so only the order line tells it was sold (ADR 0020).
      const product = await catalog.product({ withColors: true, digital: true });
      await catalog.variant(product.id, { color: "red", price: 900 });
      const sold = await catalog.variant(product.id, { color: "blue", price: 100 });
      const who = new Shopper(running.baseUrl);
      await add(who, sold, 1);
      const result = await checkoutAs(who, checkoutBody(100));
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      track([result]);
      // Unpublished again, the product is a draft and the variant is not the default one: only the order line forbids it.
      await catalog.setProductStatus(product.id, "draft");
      const variants = running.app.get(VariantsService, { strict: false });
      await expect(variants.delete(product.id, sold)).rejects.toMatchObject({
        code: "rule_violation",
        extensions: { rule: "has_order_lines" },
      });
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect((await itemsOf(pool, row.id))[0]?.variant_id).toBe(sold);
    });

    it("stock adjustments and checkouts race: reserved never passes on hand, one of the two yields (many rounds)", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { variantId, productId } = await tracked(5);
        const who = new Shopper(running.baseUrl);
        await add(who, variantId, 3);
        const [checkout, adjustment] = await Promise.allSettled([
          checkoutAs(who, checkoutBody(3_000)),
          inventory.adjust(productId, variantId, { kind: "adjustment", setOnHand: 2 }, adminId),
        ]);
        expect(checkout.status).toBe("fulfilled");
        const result = checkout.status === "fulfilled" ? checkout.value : undefined;
        if (result !== undefined) track([result]);
        const level = await levelOf(variantId);
        expect(level.reserved).toBeLessThanOrEqual(level.on_hand);
        if (result?.status === 201) {
          // The order won: the adjustment below the held units was refused.
          expect(adjustment.status).toBe("rejected");
          expect(level).toEqual({ on_hand: 5, reserved: 3 });
        } else {
          expect(result?.body).toMatchObject({ code: "checkout_refused" });
          expect(adjustment.status).toBe("fulfilled");
          expect(level).toEqual({ on_hand: 2, reserved: 0 });
        }
        await expectLevelInvariants(pool, variantId, mainId);
      }
    });
  });

  describe("checkout against the sign-in merge of the same customer's cart", () => {
    it("no deadlock and no lost line: the order has the old lines and the cart the merged ones, or the other way round (many rounds)", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { account, browser } = await newCustomer();
        const mine = await tracked(10, 1_000);
        const fromGuest = await tracked(10, 400);
        await add(browser, mine.variantId, 1);
        // A guest cart that logs in as the same customer from another device merges into the customer's cart.
        const guest = new Shopper(running.baseUrl);
        await add(guest, fromGuest.variantId, 2);
        const [checkout, login] = await Promise.all([
          checkoutAs(browser, checkoutBody(1_000, { email: undefined })),
          guest.post("/store/account/login", { email: account.email, password: PASSWORD }),
        ]);
        track([checkout]);
        expect(login.status, JSON.stringify(login.body)).toBe(200);
        expect(documented(checkout), JSON.stringify(checkout.body)).toBe(true);
        const cartNow = (await browser.get<CartResult>("/store/cart")).body;
        if (checkout.status === 201) {
          // Placed first: the order has only the first line, the merge landed in the emptied cart.
          expect(checkout.body.order?.items).toHaveLength(1);
          expect(cartNow.lines.map((line) => line.variantId)).toEqual([fromGuest.variantId]);
        } else {
          // The merge came first: the shopper agreed to a smaller total, so nothing was ordered.
          expect(checkout.body).toMatchObject({ code: "cart_changed" });
          expect(cartNow.lines.map((line) => line.variantId).sort()).toEqual(
            [mine.variantId, fromGuest.variantId].sort(),
          );
          expect(await levelOf(mine.variantId)).toEqual({ on_hand: 10, reserved: 0 });
        }
      }
    });
  });

  describe("the same cart from several places", () => {
    it("a double click on the pay button (same key, many rounds) always makes one order", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const { variantId } = await tracked(3);
        const who = new Shopper(running.baseUrl);
        await add(who, variantId, 2);
        const key = randomUUID();
        const clones = Array.from({ length: 4 }, () => {
          const clone = new Shopper(running.baseUrl);
          clone.setCookie("fluxkit_cart", who.cookie("fluxkit_cart") ?? "");
          return clone;
        });
        const results = await Promise.all(
          clones.map((clone) => checkoutAs(clone, checkoutBody(2_000), key)),
        );
        track(results);
        expect(results.every((result) => result.status === 200 || result.status === 201)).toBe(
          true,
        );
        expect(results.filter((result) => result.status === 201)).toHaveLength(1);
        expect(await ordersOf(variantId)).toBe(1);
        expect(await levelOf(variantId)).toEqual({ on_hand: 3, reserved: 2 });
      }
    });
  });
});
