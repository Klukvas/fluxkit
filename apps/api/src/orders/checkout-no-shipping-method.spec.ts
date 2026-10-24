import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { ADDRESS, checkoutAs, orderRow, orderTableCounts } from "../test/order-http.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import {
  expectNoActiveMethods,
  ShippingMethods,
  shippingOptions,
} from "../test/shipping-fixtures.js";
import { Shopper } from "../test/shopper.js";
import { testShippingProviders } from "../test/test-shipping-provider.js";

const START = new Date("2034-08-01T08:00:00.000Z");

/**
 * Regression (ADR 0029 decision 4, "a shop with no active method keeps today's behaviour"): the storefront v1 (before plan
 * step 10) sends no `shipping` member and `expectedTotal = cart.total`. With no ACTIVE method (inactive ones exist here, and
 * a provider is enabled) its checkout must behave exactly as before shipping existed: the same answers, the same totals,
 * no snapshot and no adjustment. Steps 6, 9b and 10 are released together once a shop activates a method.
 */
describe("checkout of a shop without an active shipping method (the storefront v1 body)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const methods = new ShippingMethods(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let shopper: Shopper;

  /** Exactly the body `buildCheckoutBody` of the storefront builds for a guest who ships goods. */
  const storefrontBody = (expectedTotal: number, shippingAddress: unknown = ADDRESS) => ({
    email: "buyer@example.test",
    phone: "+380501234567",
    firstName: "Іван",
    lastName: "Петренко",
    shippingAddress,
    locale: "uk",
    expectedTotal: { amount: expectedTotal, currency: "UAH" },
  });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      clock,
      extraShippingProviders: testShippingProviders(),
      rateLimits: { checkout: { maxAttempts: 1000, windowMinutes: 10 } },
    });
    await catalog.init();
  });

  beforeEach(async () => {
    clock.advanceMinutes(11);
    await expectNoActiveMethods(pool);
    // Inactive methods do not count: a new method is inactive until an admin activates it.
    await methods.create({ isActive: false });
    await methods.create({ kind: "pickup_point", isActive: false });
    shopper = new Shopper(running.baseUrl);
  });

  afterEach(async () => {
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

  it("places the order with total = subtotal, no snapshot and no adjustment; the options list is empty", async () => {
    const { variantId } = await catalog.simple({ trackInventory: true, onHand: 3, price: 2_500 });
    await shopper.post("/store/cart/items", { variantId, quantity: 2 });
    const options = await shippingOptions(shopper, { country: "UA" });
    expect(options.body).toEqual({ subtotal: { amount: 5_000, currency: "UAH" }, options: [] });
    const result = await checkoutAs(shopper, storefrontBody(5_000), randomUUID());
    expect(result.status).toBe(201);
    placedOrders.track(result.body.order?.number ?? "");
    expect(result.body.order).toMatchObject({
      subtotal: { amount: 5_000, currency: "UAH" },
      shippingTotal: { amount: 0, currency: "UAH" },
      discountTotal: { amount: 0, currency: "UAH" },
      taxTotal: { amount: 0, currency: "UAH" },
      total: { amount: 5_000, currency: "UAH" },
      adjustments: [],
      shippingAddress: ADDRESS,
      shipping: null,
    });
    const row = await orderRow(pool, result.body.order?.number ?? "");
    const extra = await pool.query<{ snapshots: number; adjustments: number }>(
      `select (select count(*)::int from order_shipping where order_id = $1) as snapshots,
              (select count(*)::int from order_adjustment where order_id = $1) as adjustments`,
      [row.id],
    );
    expect(extra.rows[0]).toEqual({ snapshots: 0, adjustments: 0 });
  });

  it("answers a changed total with cart_changed (never shipping_changed) and reserves nothing", async () => {
    const { variantId } = await catalog.simple({ trackInventory: true, onHand: 3, price: 2_500 });
    const added = await shopper.post("/store/cart/items", { variantId, quantity: 1 });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const before = await orderTableCounts(pool, [variantId]);
    const result = await checkoutAs(shopper, storefrontBody(2_400), randomUUID());
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("cart_changed");
    expect(result.body.cart).toBeDefined();
    expect(result.body.shipping).toBeUndefined();
    expect(await orderTableCounts(pool, [variantId])).toEqual(before);
  });

  it("still answers a missing address with shipping_address_required, after the consent check as before", async () => {
    const { variantId } = await catalog.simple({ price: 2_500 });
    await shopper.post("/store/cart/items", { variantId, quantity: 1 });
    const missing = await checkoutAs(shopper, storefrontBody(2_500, null), randomUUID());
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual([
      { path: "shippingAddress", code: "shipping_address_required" },
    ]);
    // A changed total is answered first, as before shipping existed.
    const changed = await checkoutAs(shopper, storefrontBody(1, null), randomUUID());
    expect(changed.body.code).toBe("cart_changed");
  });

  it("a digital order needs no address, and a replay answers the same order", async () => {
    const { variantId } = await catalog.simple({ digital: true, price: 900 });
    await shopper.post("/store/cart/items", { variantId, quantity: 1 });
    const key = randomUUID();
    const first = await checkoutAs(shopper, storefrontBody(900, null), key);
    expect(first.status).toBe(201);
    placedOrders.track(first.body.order?.number ?? "");
    const replay = await checkoutAs(shopper, storefrontBody(900, null), key);
    expect(replay.status).toBe(200);
    expect(replay.body.order?.number).toBe(first.body.order?.number);
  });
});
