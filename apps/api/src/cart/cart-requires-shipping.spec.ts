import { randomUUID } from "node:crypto";
import { MAX_AMOUNT } from "@fluxkit/core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { deepKeys, type CartResult } from "../test/cart-helpers.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { PlacedOrders } from "../test/order-fixtures.js";
import { checkoutAs, checkoutBody } from "../test/order-http.js";
import { Shopper } from "../test/shopper.js";

const START = new Date("2040-03-01T08:00:00.000Z");

// `requiresShipping` on the cart (plan step 2 of docs/plans/2026-10-18-storefront.md, docs/api/cart.md). The rule is the
// one the checkout enforces: core `shippingAddressRequired` over the lines the shopper can actually buy, so the cart
// and the order never disagree about the address.
describe("cart API: requiresShipping", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let shopper: Shopper;

  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const read = async (who: Shopper = shopper) => (await who.get<CartResult>("/store/cart")).body;

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
    await placedOrders.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  describe("the rule", () => {
    it("is false for a cart that does not exist and for a cart whose last line was removed", async () => {
      expect((await read()).requiresShipping).toBe(false);
      const digital = await catalog.simple({ digital: true });
      await add(shopper, digital.variantId);
      const physical = await catalog.simple();
      await add(shopper, physical.variantId);
      expect((await read()).requiresShipping).toBe(true);
      await shopper.delete(`/store/cart/items/${physical.variantId}`);
      await shopper.delete(`/store/cart/items/${digital.variantId}`);
      const empty = await read();
      expect(empty.lines).toEqual([]);
      expect(empty.requiresShipping).toBe(false);
    });

    it("is false for digital goods only, true for physical goods only, true for a mix", async () => {
      const digitalA = await catalog.simple({ digital: true });
      const digitalB = await catalog.simple({ digital: true });
      const physical = await catalog.simple();
      const digitalShopper = new Shopper(running.baseUrl);
      await add(digitalShopper, digitalA.variantId);
      expect((await add(digitalShopper, digitalB.variantId)).body.requiresShipping).toBe(false);
      expect((await read(digitalShopper)).requiresShipping).toBe(false);

      const physicalShopper = new Shopper(running.baseUrl);
      expect((await add(physicalShopper, physical.variantId)).body.requiresShipping).toBe(true);
      expect((await read(physicalShopper)).requiresShipping).toBe(true);

      await add(digitalShopper, physical.variantId);
      expect((await read(digitalShopper)).requiresShipping).toBe(true);
    });

    it("follows the product type: it is read from the catalog every time, not stored with the line", async () => {
      const product = await catalog.simple();
      await add(shopper, product.variantId);
      expect((await read()).requiresShipping).toBe(true);
      const flip = (value: boolean) =>
        pool.query(
          `update product_type set requires_shipping = $2
            where id = (select product_type_id from product where id = $1)`,
          [product.productId, value],
        );
      // The product type is shared by the other products of this file: restore it in any case.
      await flip(false);
      try {
        expect((await read()).requiresShipping).toBe(false);
      } finally {
        await flip(true);
      }
      expect((await read()).requiresShipping).toBe(true);
    });

    it("counts the lines the shopper can buy: an unavailable physical line does not require an address", async () => {
      const digital = await catalog.simple({ digital: true });
      const physical = await catalog.simple();
      await add(shopper, digital.variantId);
      await add(shopper, physical.variantId);
      await catalog.setActive(physical.variantId, false);
      const cart = await read();
      expect(cart.purchasable).toBe(false);
      expect(cart.lines.find((line) => line.variantId === physical.variantId)?.notices).toEqual([
        { code: "unavailable" },
      ]);
      expect(cart.requiresShipping).toBe(false);
    });

    it("counts an available physical line next to an unavailable digital one", async () => {
      const digital = await catalog.simple({ digital: true });
      const physical = await catalog.simple();
      await add(shopper, digital.variantId);
      await add(shopper, physical.variantId);
      await catalog.deletePrice(digital.variantId);
      const cart = await read();
      expect(cart.purchasable).toBe(false);
      expect(cart.requiresShipping).toBe(true);
    });

    it("is false when the only physical line is unpublished, and true again when it is back", async () => {
      const physical = await catalog.simple();
      await add(shopper, physical.variantId);
      await catalog.setProductStatus(physical.productId, "draft");
      const hidden = await read();
      expect(hidden.lines).toHaveLength(1);
      expect(hidden.requiresShipping).toBe(false);
      await catalog.setProductStatus(physical.productId, "active");
      expect((await read()).requiresShipping).toBe(true);
    });

    it("counts a physical line that is only out of stock: it is priced, and an order of it needs the address", async () => {
      const physical = await catalog.simple({ trackInventory: true, onHand: 0 });
      const cart = (await add(shopper, physical.variantId)).body;
      expect(cart.lines[0]?.availability).toBe("out_of_stock");
      expect(cart.lines[0]?.unitPrice).not.toBeNull();
      expect(cart.requiresShipping).toBe(true);
    });

    it("counts a line whose total no longer fits the money limit as unavailable", async () => {
      const digital = await catalog.simple({ digital: true });
      const physical = await catalog.simple({ price: 1_000 });
      await add(shopper, digital.variantId);
      await add(shopper, physical.variantId, 2);
      await catalog.setPrice(physical.variantId, MAX_AMOUNT);
      const cart = await read();
      const line = cart.lines.find((entry) => entry.variantId === physical.variantId);
      expect(line?.notices).toEqual([{ code: "line_total_out_of_range" }]);
      expect(line?.lineTotal).toBeNull();
      expect(cart.requiresShipping).toBe(false);
    });
  });

  describe("every response that returns the cart shape", () => {
    it("carries it: add, set quantity, remove, acknowledge and read", async () => {
      const digital = await catalog.simple({ digital: true });
      const physical = await catalog.simple();
      const added = await add(shopper, digital.variantId);
      expect(added.body.requiresShipping).toBe(false);
      const second = await add(shopper, physical.variantId);
      expect(second.body.requiresShipping).toBe(true);
      const changed = await shopper.patch<CartResult>(`/store/cart/items/${physical.variantId}`, {
        quantity: 3,
      });
      expect(changed.body.requiresShipping).toBe(true);
      const acknowledged = await shopper.post<CartResult>("/store/cart/acknowledge");
      expect(acknowledged.body.requiresShipping).toBe(true);
      const removed = await shopper.delete<CartResult>(`/store/cart/items/${physical.variantId}`);
      expect(removed.body.requiresShipping).toBe(false);
      expect((await read()).requiresShipping).toBe(false);
      const last = await shopper.delete<CartResult>(`/store/cart/items/${digital.variantId}`);
      expect(last.body.requiresShipping).toBe(false);
    });

    it("is in the fresh cart of a 409 cart_changed from the checkout, equal to what a read says", async () => {
      const digital = await catalog.simple({ digital: true, price: 100 });
      const physical = await catalog.simple({ price: 200 });
      await add(shopper, digital.variantId);
      await add(shopper, physical.variantId);
      await catalog.setActive(physical.variantId, false);
      const refused = await checkoutAs(shopper, checkoutBody(300));
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "cart_changed" });
      const embedded = (refused.body as unknown as { cart: CartResult }).cart;
      expect(embedded.requiresShipping).toBe(false);
      expect(embedded.requiresShipping).toBe((await read()).requiresShipping);
    });

    it("does not change the notices, the totals or the purchasable flag", async () => {
      const digital = await catalog.simple({ digital: true, price: 1_000 });
      const physical = await catalog.simple({ price: 500 });
      const gone = await catalog.simple({ price: 300 });
      await add(shopper, digital.variantId, 2);
      await add(shopper, physical.variantId, 1);
      await add(shopper, gone.variantId, 1);
      await catalog.setPrice(digital.variantId, 1_200);
      await catalog.setActive(gone.variantId, false);
      const cart = await read();
      expect(cart.purchasable).toBe(false);
      expect(cart.itemCount).toBe(4);
      expect(cart.subtotal).toEqual({ amount: 2_900, currency: "UAH" });
      expect(cart.total).toEqual(cart.subtotal);
      expect(cart.lines.map((line) => line.notices)).toEqual([
        [{ code: "price_changed", previousAmount: { amount: 1_000, currency: "UAH" } }],
        [],
        [{ code: "unavailable" }],
      ]);
      expect(cart.requiresShipping).toBe(true);
    });

    it("exposes only the new key and nothing of the product type", async () => {
      const physical = await catalog.simple({ digital: false });
      const cart = (await add(shopper, physical.variantId)).body;
      expect(Object.keys(cart).sort()).toEqual(
        [
          "itemCount",
          "lines",
          "notices",
          "purchasable",
          "requiresShipping",
          "subtotal",
          "total",
        ].sort(),
      );
      const text = JSON.stringify(cart);
      for (const secret of ["productType", "product_type", "requires_shipping", "typeId"]) {
        expect(text, secret).not.toContain(secret);
      }
      expect([...deepKeys(cart)].filter((key) => /type/i.test(key))).toEqual([]);
    });
  });

  describe("the cart and the checkout never disagree", () => {
    async function checkoutWithoutAddress(who: Shopper) {
      const cart = await read(who);
      expect(cart.purchasable).toBe(true);
      const body = checkoutBody(cart.total.amount);
      delete body["shippingAddress"];
      const result = await checkoutAs(who, body, randomUUID());
      if (result.status === 201) {
        placedOrders.track(result.body.order?.number ?? "");
      }
      return { cart, result };
    }

    it.each([
      ["digital only", { digital: 2, physical: 0 }],
      ["physical only", { digital: 0, physical: 2 }],
      ["mixed", { digital: 1, physical: 1 }],
    ])(
      "%s: checkout without an address is refused exactly when requiresShipping is true",
      async (_name, mix) => {
        const who = new Shopper(running.baseUrl);
        for (let index = 0; index < mix.digital; index += 1) {
          await add(who, (await catalog.simple({ digital: true, price: 100 })).variantId);
        }
        for (let index = 0; index < mix.physical; index += 1) {
          await add(
            who,
            (await catalog.simple({ trackInventory: true, onHand: 5, price: 200 })).variantId,
          );
        }
        const { cart, result } = await checkoutWithoutAddress(who);
        if (cart.requiresShipping) {
          expect(result.status).toBe(400);
          expect(result.body).toMatchObject({
            code: "validation_failed",
            errors: [{ path: "shippingAddress", code: "shipping_address_required" }],
          });
        } else {
          expect(result.status, JSON.stringify(result.body)).toBe(201);
        }
        expect(cart.requiresShipping).toBe(mix.physical > 0);
      },
    );

    it("an unavailable physical line is refused as cart_changed first; once it is removed the cart says what the checkout then demands", async () => {
      const digital = await catalog.simple({ digital: true, price: 100 });
      const physical = await catalog.simple({ price: 200 });
      await add(shopper, digital.variantId);
      await add(shopper, physical.variantId);
      await catalog.setActive(physical.variantId, false);
      expect((await read()).requiresShipping).toBe(false);
      await shopper.delete(`/store/cart/items/${physical.variantId}`);
      const { cart, result } = await checkoutWithoutAddress(shopper);
      expect(cart.requiresShipping).toBe(false);
      expect(result.status, JSON.stringify(result.body)).toBe(201);
    });
  });
});
