import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import type { CartResult } from "../test/cart-helpers.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { checkoutAs, checkoutBody, itemsOf, orderRow } from "../test/order-http.js";
import { Shopper } from "../test/shopper.js";

// Review fix Medium 3: a product whose texts exist in locales that are no longer in LOCALES (the test app runs uk,en)
// used to be shown in the cart (200) and then fail the checkout with a 500. The snapshot keeps every real translation.
const START = new Date("2035-03-01T08:00:00.000Z");

describe("checkout of a product whose texts use locales that are no longer configured (real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let shopper: Shopper;

  const add = (variantId: string) =>
    shopper.post<CartResult>("/store/cart/items", { variantId, quantity: 1 });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      rateLimits: { checkout: { maxAttempts: 1000, windowMinutes: 10 } },
    });
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
    shopper = new Shopper(running.baseUrl);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  const product = (productTitle: Record<string, string>) =>
    catalog.simple({ trackInventory: true, onHand: 5, price: 1_000, productTitle });

  it("a title in uk, en and de only: the cart reads 200 and the checkout places the order, keeping every translation", async () => {
    const { variantId } = await product({ uk: "Футболка", en: "Tee", de: "T-Shirt" });
    expect([200, 201]).toContain((await add(variantId)).status);
    expect((await shopper.get<CartResult>("/store/cart")).status).toBe(200);

    const result = await checkoutAs(shopper, checkoutBody(1_000));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    placedOrders.track(result.body.order?.number ?? "");
    const row = await orderRow(pool, result.body.order?.number ?? "");
    expect((await itemsOf(pool, row.id))[0]?.product_title).toEqual({
      uk: "Футболка",
      en: "Tee",
      de: "T-Shirt",
    });
  });

  it("a title that exists only in a removed locale: the cart shows it (the same fallback chain), the checkout places the order, and the order view shows it", async () => {
    const { variantId } = await product({ de: "Nur Deutsch" });
    await add(variantId);
    const cart = (await shopper.get<CartResult>("/store/cart")).body;
    expect(cart.lines[0]?.title).toBe("Nur Deutsch");

    const result = await checkoutAs(shopper, checkoutBody(1_000));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    placedOrders.track(result.body.order?.number ?? "");
    expect(result.body.order?.items[0]?.productTitle).toBe("Nur Deutsch");
  });

  it("a truly empty title is refused with a client error naming the line, not a 500, and the cart is kept", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { variantId, productId } = await product({ uk: "Тимчасова", en: "Temporary" });
    await add(variantId);
    await pool.query("update product set title = $2::jsonb where id = $1", [
      productId,
      JSON.stringify({ uk: "  ", de: "" }),
    ]);

    const result = await checkoutAs(shopper, checkoutBody(1_000));
    expect(result.status, JSON.stringify(result.body)).toBe(409);
    expect(result.body).toMatchObject({
      code: "checkout_refused",
      errors: [{ path: "lines.0", code: "product_title_missing" }],
    });
    expect((await shopper.get<CartResult>("/store/cart")).body.lines).toHaveLength(1);
  });
});
