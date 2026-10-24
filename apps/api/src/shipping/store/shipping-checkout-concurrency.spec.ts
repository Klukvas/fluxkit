import { randomUUID } from "node:crypto";
import pg from "pg";
import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ShippingMethodsService } from "../admin/shipping-methods.service.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { CartCatalog } from "../../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { FakeClock } from "../../test/fake-clock.js";
import type { HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { PlacedOrders } from "../../test/order-fixtures.js";
import { checkoutAs, checkoutBody, type CheckoutResult } from "../../test/order-http.js";
import { ShippingMethods } from "../../test/shipping-fixtures.js";
import { Shopper } from "../../test/shopper.js";
import { testShippingProviders } from "../../test/test-shipping-provider.js";

const START = new Date("2034-07-01T08:00:00.000Z");
const ROUNDS = 8;

/**
 * Concurrency of the checkout's shipping step (ADR 0029 decision 4): the method is read without a lock (the lock order of
 * ADR 0015 is unchanged), the snapshot is written after the inventory locks. Every outcome must be a documented answer, no
 * deadlock may happen (the retry would hide it), and an order never exists without its snapshot and adjustment or the
 * other way round.
 */
describe("checkout with shipping under concurrency (real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const methods = new ShippingMethods(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let warnings: string[] = [];

  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post("/store/cart/items", { variantId, quantity });

  function track(results: HttpResult<CheckoutResult>[]): void {
    for (const result of results) {
      if (result.body.order?.number !== undefined) {
        placedOrders.track(result.body.order.number);
      }
    }
  }

  /** Orders with a shipping snapshot and with a shipping adjustment must be the same set: all or nothing. */
  async function expectSnapshotsComplete(): Promise<void> {
    const result = await pool.query<{ orders: number; snapshots: number; adjustments: number }>(
      `select (select count(*)::int from sales_order o where o.shipping_total > 0) as orders,
              (select count(*)::int from order_shipping) as snapshots,
              (select count(*)::int from order_adjustment where kind = 'shipping') as adjustments`,
    );
    const row = result.rows[0];
    expect(row?.snapshots).toBe(row?.adjustments);
    const orphans = await pool.query<{ n: number }>(
      `select count(*)::int as n from sales_order o
        where (exists (select 1 from order_shipping s where s.order_id = o.id))
           <> (exists (select 1 from order_adjustment a where a.order_id = o.id and a.kind = 'shipping'))`,
    );
    expect(orphans.rows[0]?.n).toBe(0);
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      clock,
      extraShippingProviders: testShippingProviders(),
      rateLimits: {
        checkout: { maxAttempts: 10_000, windowMinutes: 10 },
        cartWrite: { maxAttempts: 10_000, windowMinutes: 1 },
      },
    });
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
    warnings = [];
    vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
  });

  afterEach(async () => {
    expect(
      warnings.filter((message) => message.includes("Deadlock")),
      "a deadlock happened (and was retried)",
    ).toEqual([]);
    vi.restoreAllMocks();
    try {
      await placedOrders.cleanup();
    } finally {
      await methods.cleanup();
    }
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  it("two shoppers, one unit left, both with a shipping method: one order with its snapshot, one checkout_refused (many rounds)", async () => {
    const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
    for (let round = 0; round < ROUNDS; round += 1) {
      const { variantId } = await catalog.simple({ trackInventory: true, onHand: 1, price: 1_000 });
      const one = new Shopper(running.baseUrl);
      const two = new Shopper(running.baseUrl);
      await add(one, variantId);
      await add(two, variantId);
      const body = checkoutBody(1_500, { shipping: { methodCode: method.code } });
      const results = await Promise.all([checkoutAs(one, body), checkoutAs(two, body)]);
      track(results);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const refused = results.find((result) => result.status === 409);
      expect(refused?.body.code).toBe("checkout_refused");
      const level = await pool.query<{ reserved: number }>(
        "select reserved from inventory_level where variant_id = $1",
        [variantId],
      );
      expect(level.rows[0]?.reserved).toBe(1);
    }
    await expectSnapshotsComplete();
  });

  it("an admin deactivates or reprices the method while shoppers check out: each answer is 201 with the old price or 409 shipping_changed (many rounds)", async () => {
    const admin = running.app.get(ShippingMethodsService);
    for (let round = 0; round < ROUNDS; round += 1) {
      const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
      const shoppers = [1, 2, 3].map(() => new Shopper(running.baseUrl));
      for (const shopper of shoppers) {
        const { variantId } = await catalog.simple({ price: 1_000 });
        await add(shopper, variantId);
      }
      const body = checkoutBody(1_500, { shipping: { methodCode: method.code } });
      const change =
        round % 2 === 0
          ? admin.update(method.id, { isActive: false })
          : admin.update(method.id, { pricing: { type: "flat", amount: 700 } });
      const [results] = await Promise.all([
        Promise.all(shoppers.map((shopper) => checkoutAs(shopper, body, randomUUID()))),
        change,
      ]);
      track(results);
      for (const result of results) {
        expect([201, 409]).toContain(result.status);
        if (result.status === 201) {
          // Placed against the method as it was read: the price the shopper agreed to, never a mix.
          expect(result.body.order).toMatchObject({
            shippingTotal: { amount: 500 },
            total: { amount: 1_500 },
          });
        } else {
          expect(result.body.code).toBe("shipping_changed");
        }
      }
      // After the change has committed, nobody gets the old terms any more.
      const late = new Shopper(running.baseUrl);
      const { variantId } = await catalog.simple({ price: 1_000 });
      await add(late, variantId);
      const after = await checkoutAs(late, body);
      track([after]);
      expect(after.status).toBe(409);
      expect(after.body.code).toBe("shipping_changed");
    }
    await expectSnapshotsComplete();
  });

  it("an admin delete of an unused method racing a checkout: the delete is refused once the order exists, or the checkout answers shipping_changed", async () => {
    const admin = running.app.get(ShippingMethodsService);
    for (let round = 0; round < ROUNDS; round += 1) {
      const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
      const shopper = new Shopper(running.baseUrl);
      const { variantId } = await catalog.simple({ price: 1_000 });
      await add(shopper, variantId);
      const body = checkoutBody(1_500, { shipping: { methodCode: method.code } });
      const [checkout, deletion] = await Promise.allSettled([
        checkoutAs(shopper, body),
        admin.delete(method.id),
      ]);
      expect(checkout.status).toBe("fulfilled");
      const result = (checkout as PromiseFulfilledResult<HttpResult<CheckoutResult>>).value;
      track([result]);
      if (result.status === 201) {
        // The order linked the method first: the delete must have been refused (method_in_use).
        expect(deletion.status).toBe("rejected");
        const snapshot = await pool.query<{ method_id: string | null }>(
          "select s.method_id from order_shipping s join sales_order o on o.id = s.order_id where o.number = $1",
          [result.body.order?.number],
        );
        expect(snapshot.rows[0]?.method_id).toBe(method.id);
      } else {
        expect(result.status).toBe(409);
        expect(result.body.code).toBe("shipping_changed");
        expect(deletion.status).toBe("fulfilled");
      }
    }
    await expectSnapshotsComplete();
  });
});
