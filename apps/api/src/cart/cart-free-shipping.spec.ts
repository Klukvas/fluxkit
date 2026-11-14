import { randomUUID } from "node:crypto";
import { MAX_AMOUNT } from "@fluxkit/core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import type { CartResult } from "../test/cart-helpers.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { checkoutAs, checkoutBody } from "../test/order-http.js";
import { Shopper } from "../test/shopper.js";

const money = (amount: number) => ({ amount, currency: "UAH" });
const progress = (threshold: number, remaining: number) => ({
  threshold: money(threshold),
  remaining: money(remaining),
});

describe("cart API: freeShipping", () => {
  const clock = new FakeClock(new Date("2041-03-01T08:00:00Z"));
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const codes: string[] = [];
  let running: RunningApp;
  let shopper: Shopper;
  const add = (variantId: string, quantity = 1, who = shopper) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const read = async (who = shopper) => (await who.get<CartResult>("/store/cart")).body;

  async function method(
    freeFrom: number,
    options: {
      active?: boolean;
      currency?: string;
      pricing?: unknown;
      kind?: string;
      provider?: string;
    } = {},
  ) {
    const code = `progress_${randomUUID().replaceAll("-", "")}`;
    codes.push(code);
    await pool.query(
      `insert into shipping_method
      (code, title, kind, pricing, currency, country_codes, is_active, provider_code)
      values ($1, '{"uk":"Delivery"}', $2, $3::jsonb, $4, '{UA}', $5, $6)`,
      [
        code,
        options.kind ?? "address",
        JSON.stringify(options.pricing ?? { type: "free_over", amount: 100, freeFrom }),
        options.currency ?? "UAH",
        options.active ?? true,
        options.provider ?? null,
      ],
    );
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    await catalog.init();
  });
  beforeEach(() => {
    clock.advanceMinutes(11);
    shopper = new Shopper(running.baseUrl);
  });
  afterEach(async () => {
    await pool.query("delete from shipping_method where code = any($1::text[])", [codes]);
    codes.length = 0;
  });
  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  it("returns null with no methods, for an absent cart and after removing its last line", async () => {
    expect((await read()).freeShipping).toBeNull();
    const physical = await catalog.simple();
    expect((await add(physical.variantId)).body.freeShipping).toBeNull();
    await method(2000);
    expect(
      (await shopper.delete<CartResult>(`/store/cart/items/${physical.variantId}`)).body
        .freeShipping,
    ).toBeNull();
  });
  it("returns null for digital-only carts with one bounded method read", async () => {
    await method(2000);
    await add((await catalog.simple({ digital: true })).variantId);
    const spy = vi.spyOn(pg.Client.prototype, "query");
    try {
      expect((await read()).freeShipping).toBeNull();
      expect(
        spy.mock.calls.filter((args) => JSON.stringify(args[0]).includes("shipping_method")),
      ).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
  it("includes the hint in writes and uses every available line, including digital ones", async () => {
    await method(2000);
    await add((await catalog.simple({ digital: true, price: 300 })).variantId);
    const added = await add((await catalog.simple({ price: 500 })).variantId);
    expect(added.status).toBe(200);
    expect(added.body.freeShipping).toEqual(progress(2000, 1200));
    expect((await read()).freeShipping).toEqual(progress(2000, 1200));
  });
  it("chooses the lowest active offered valid threshold in the cart currency", async () => {
    await method(3000);
    await method(2000);
    await method(100, { active: false });
    await method(200, { currency: "EUR" });
    await method(300, { pricing: { type: "free_over", amount: -1, freeFrom: 300 } });
    await method(400, { kind: "pickup_point", provider: "unloaded" });
    await method(0, { pricing: { type: "flat", amount: 0 } });
    await add((await catalog.simple({ price: 500 })).variantId);
    expect((await read()).freeShipping).toEqual(progress(2000, 1500));
  });
  it.each([1000, 1200])("clamps remaining to zero at subtotal %i", async (price) => {
    await method(1000);
    await add((await catalog.simple({ price })).variantId);
    expect((await read()).freeShipping).toEqual(progress(1000, 0));
  });
  it("includes the same value in checkout's cart_changed response", async () => {
    await method(2000);
    const physical = await catalog.simple({ price: 500 });
    await add(physical.variantId);
    await catalog.setPrice(physical.variantId, 600);
    const refused = await checkoutAs(shopper, {
      ...checkoutBody(500),
      shipping: { methodCode: codes[0] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "cart_changed",
      cart: { freeShipping: progress(2000, 1400) },
    });
  });
  it("uses the repaired subtotal and ignores overflowing physical lines on reads", async () => {
    await method(2000);
    const physical = await catalog.simple({ price: 500 });
    await add(physical.variantId, 2);
    await add((await catalog.simple({ digital: true, price: 300 })).variantId);
    await catalog.setPrice(physical.variantId, MAX_AMOUNT);
    expect((await read()).freeShipping).toBeNull();
  });
  it("reads methods once for any number of lines and never for an absent cart", async () => {
    await method(2000);
    const physical = await catalog.simple({ price: 100 });
    await add(physical.variantId);
    async function count(who: Shopper) {
      const spy = vi.spyOn(pg.Client.prototype, "query");
      try {
        await read(who);
        return spy.mock.calls.filter((args) => JSON.stringify(args[0]).includes("shipping_method"))
          .length;
      } finally {
        spy.mockRestore();
      }
    }
    expect(await count(new Shopper(running.baseUrl))).toBe(0);
    expect(await count(shopper)).toBe(1);
    for (let i = 0; i < 5; i += 1) await add((await catalog.simple({ price: 100 })).variantId);
    expect(await count(shopper)).toBe(1);
  });
});
