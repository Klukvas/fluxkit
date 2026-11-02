import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import type { CartResult } from "../test/cart-helpers.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { checkoutAs, checkoutBody } from "../test/order-http.js";
import { Shopper } from "../test/shopper.js";

const START = new Date("2040-04-01T08:00:00.000Z");

interface HintedLine {
  variantId: string;
  quantity: number;
  availability: string;
  insufficientStock?: boolean;
  maxQuantity?: number | null;
}

/**
 * `insufficientStock` and `maxQuantity` on cart lines (plan 2026-11-02-api-matched-variant-and-stock-hints): what the
 * checkout would say about the line's quantity NOW (core `decideReserve` at the default location), with a number only
 * when it is at most `LOW_STOCK_THRESHOLD` (5 here). Nothing is reserved; the checkout stays the judge.
 */
describe("cart API: stock hints on lines", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  const extraLocations: string[] = [];
  let running: RunningApp;
  let shopper: Shopper;

  const add = (variantId: string, quantity = 1, who: Shopper = shopper) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const read = async (who: Shopper = shopper) => (await who.get<CartResult>("/store/cart")).body;
  const lineOf = (cart: CartResult, variantId: string): HintedLine | undefined =>
    (cart.lines as HintedLine[] | undefined)?.find((line) => line.variantId === variantId);
  const hintOf = (line: HintedLine | undefined) => ({
    insufficientStock: line?.insufficientStock,
    maxQuantity: line?.maxQuantity,
  });
  const tracked = (onHand: number, reserved = 0, price = 1000) =>
    catalog.simple({ trackInventory: true, onHand, reserved, price });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      lowStockThreshold: 5,
      rateLimits: { checkout: { maxAttempts: 1000, windowMinutes: 10 } },
    });
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
    shopper = new Shopper(running.baseUrl);
  });

  afterEach(async () => {
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await pool.query("delete from inventory_level where location_id = any($1::uuid[])", [
      extraLocations,
    ]);
    await pool.query("delete from location where id = any($1::uuid[])", [extraLocations]);
    await catalog.cleanup();
    await pool.end();
  });

  it("999 of 22: insufficient, and no number (above the threshold)", async () => {
    const product = await tracked(22);
    const added = await add(product.variantId, 999);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(hintOf(lineOf(added.body, product.variantId))).toEqual({
      insufficientStock: true,
      maxQuantity: null,
    });
    expect(hintOf(lineOf(await read(), product.variantId))).toEqual({
      insufficientStock: true,
      maxQuantity: null,
    });
  });

  it("8 of 3: insufficient with the low number; exactly enough is fine", async () => {
    const low = await tracked(3);
    await add(low.variantId, 8);
    expect(hintOf(lineOf(await read(), low.variantId))).toEqual({
      insufficientStock: true,
      maxQuantity: 3,
    });
    const exact = await tracked(22);
    await add(exact.variantId, 22);
    expect(hintOf(lineOf(await read(), exact.variantId))).toEqual({
      insufficientStock: false,
      maxQuantity: null,
    });
  });

  it("stock 0 and a tracked variant without a level row: insufficient, 0 left", async () => {
    const empty = await tracked(0);
    const never = await catalog.simple({ trackInventory: true, price: 1000 });
    await add(empty.variantId, 1);
    await add(never.variantId, 2);
    const cart = await read();
    for (const variantId of [empty.variantId, never.variantId]) {
      const line = lineOf(cart, variantId);
      expect(line?.availability).toBe("out_of_stock");
      expect(hintOf(line)).toEqual({ insufficientStock: true, maxQuantity: 0 });
    }
  });

  it("counts reserved stock: 10 on hand with 8 reserved leaves 2", async () => {
    const product = await tracked(10, 8);
    await add(product.variantId, 3);
    expect(hintOf(lineOf(await read(), product.variantId))).toEqual({
      insufficientStock: true,
      maxQuantity: 2,
    });
    await shopper.patch(`/store/cart/items/${product.variantId}`, { quantity: 2 });
    expect(hintOf(lineOf(await read(), product.variantId))).toEqual({
      insufficientStock: false,
      maxQuantity: null,
    });
  });

  it("backorder and untracked (digital) lines are never short", async () => {
    const backorder = await catalog.simple({
      trackInventory: true,
      allowBackorder: true,
      onHand: 0,
      price: 1000,
    });
    const digital = await catalog.simple({ digital: true, price: 1000 });
    await add(backorder.variantId, 999);
    await add(digital.variantId, 999);
    const cart = await read();
    for (const variantId of [backorder.variantId, digital.variantId]) {
      expect(hintOf(lineOf(cart, variantId))).toEqual({
        insufficientStock: false,
        maxQuantity: null,
      });
    }
  });

  it("an unavailable line carries no hint (the checkout answers cart_changed for it first)", async () => {
    const product = await tracked(0);
    await add(product.variantId, 4);
    await catalog.setActive(product.variantId, false);
    const line = lineOf(await read(), product.variantId);
    expect(line?.availability).toBe("out_of_stock");
    expect(hintOf(line)).toEqual({ insufficientStock: false, maxQuantity: null });
  });

  it("counts the default location only, where the checkout reserves", async () => {
    const product = await tracked(2);
    const code = `mv_extra_${randomUUID().slice(0, 8)}`;
    const location = await pool.query<{ id: string }>(
      "insert into location (code, name) values ($1, $1) returning id",
      [code],
    );
    const locationId = location.rows[0]?.id ?? "";
    extraLocations.push(locationId);
    await pool.query(
      "insert into inventory_level (variant_id, location_id, on_hand, reserved) values ($1, $2, 50, 0)",
      [product.variantId, locationId],
    );
    await add(product.variantId, 3);
    const line = lineOf(await read(), product.variantId);
    // All locations together are plenty (`in_stock`), but the checkout reserves at the default one: 2 there.
    expect(line?.availability).toBe("in_stock");
    expect(hintOf(line)).toEqual({ insufficientStock: true, maxQuantity: 2 });
    const refused = await checkoutAs(shopper, checkoutBody(3000));
    expect(refused.body).toMatchObject({
      code: "checkout_refused",
      errors: [{ path: "lines.0", code: "insufficient_stock" }],
    });
  });

  it("follows stock changes between reads; the checkout stays the judge of a read that said enough", async () => {
    const product = await tracked(6);
    await add(product.variantId, 4);
    expect(hintOf(lineOf(await read(), product.variantId))).toEqual({
      insufficientStock: false,
      maxQuantity: null,
    });
    // Another shopper buys 3 after this cart was read (a real reservation, not a stock write).
    const other = new Shopper(running.baseUrl);
    await add(product.variantId, 3, other);
    const bought = await checkoutAs(other, checkoutBody(3000));
    expect(bought.status, JSON.stringify(bought.body)).toBe(201);
    placedOrders.track(bought.body.order?.number ?? "");
    // The first shopper's checkout, without a new read, is refused: the hint was a hint.
    const refused = await checkoutAs(shopper, checkoutBody(4000));
    expect(refused.body).toMatchObject({
      code: "checkout_refused",
      errors: [{ path: "lines.0", code: "insufficient_stock" }],
    });
    expect(hintOf(lineOf(await read(), product.variantId))).toEqual({
      insufficientStock: true,
      maxQuantity: 3,
    });
    // A receipt later: enough again.
    await catalog.setStock(product.variantId, 13, 3);
    expect(hintOf(lineOf(await read(), product.variantId))).toEqual({
      insufficientStock: false,
      maxQuantity: null,
    });
  });

  it("agrees with the checkout on the same carts", async () => {
    const cases = [
      { onHand: 5, quantity: 5 },
      { onHand: 5, quantity: 6 },
      { onHand: 30, quantity: 31 },
      { onHand: 0, quantity: 1 },
    ];
    for (const { onHand, quantity } of cases) {
      const who = new Shopper(running.baseUrl);
      const product = await tracked(onHand, 0, 100);
      await add(product.variantId, quantity, who);
      const hinted = lineOf(await read(who), product.variantId)?.insufficientStock;
      const result = await checkoutAs(who, checkoutBody(100 * quantity));
      if (result.status === 201) {
        placedOrders.track(result.body.order?.number ?? "");
      }
      const refused =
        result.status === 409 && (result.body as { code?: string }).code === "checkout_refused";
      expect(hinted, JSON.stringify({ onHand, quantity, status: result.status })).toBe(refused);
    }
  });

  it("is in the cart of a 409 cart_changed too", async () => {
    const product = await tracked(1, 0, 700);
    await add(product.variantId, 2);
    const result = await checkoutAs(shopper, checkoutBody(1));
    expect(result.status).toBe(409);
    const body = result.body as { code?: string; cart?: CartResult };
    expect(body.code).toBe("cart_changed");
    expect(
      hintOf(body.cart === undefined ? undefined : lineOf(body.cart, product.variantId)),
    ).toEqual({
      insufficientStock: true,
      maxQuantity: 1,
    });
  });
});
