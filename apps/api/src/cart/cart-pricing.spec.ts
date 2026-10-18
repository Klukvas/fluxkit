import { MAX_AMOUNT } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import {
  cartRowsOfToken,
  countCartsSince,
  deepKeys,
  itemsOfCart,
  type CartResult,
} from "../test/cart-helpers.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { Shopper } from "../test/shopper.js";

const START = new Date("2032-03-01T08:00:00.000Z");

describe("cart API: repricing, notices and amounts", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  let running: RunningApp;
  let shopper: Shopper;

  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });
  const read = async (who: Shopper = shopper) => (await who.get<CartResult>("/store/cart")).body;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    await catalog.init();
  });

  beforeEach(() => {
    clock.advanceMinutes(2);
    shopper = new Shopper(running.baseUrl);
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  describe("prices and totals come from the server", () => {
    it("shows the current unit price, compare-at price, line total, subtotal and total (total equals subtotal)", async () => {
      const a = await catalog.simple({ price: 1_000, compareAt: 1_500 });
      const b = await catalog.simple({ price: 333 });
      await add(shopper, a.variantId, 3);
      const cart = (await add(shopper, b.variantId, 2)).body;
      expect(cart.lines[0]).toMatchObject({
        variantId: a.variantId,
        productSlug: a.slug,
        quantity: 3,
        unitPrice: { amount: 1_000, currency: "UAH" },
        compareAtAmount: 1_500,
        lineTotal: { amount: 3_000, currency: "UAH" },
        notices: [],
      });
      expect(cart.lines[1]).toMatchObject({
        unitPrice: { amount: 333, currency: "UAH" },
        compareAtAmount: null,
        lineTotal: { amount: 666, currency: "UAH" },
      });
      expect(cart.subtotal).toEqual({ amount: 3_666, currency: "UAH" });
      expect(cart.total).toEqual(cart.subtotal);
      expect(cart.itemCount).toBe(5);
      expect(cart.purchasable).toBe(true);
      expect(cart.notices).toEqual([]);
    });

    it("never takes a price or total from the client: extra fields are refused", async () => {
      const a = await catalog.simple({ price: 1_000 });
      for (const extra of [
        { price: 1 },
        { unitPrice: { amount: 1, currency: "UAH" } },
        { total: 1 },
      ]) {
        const result = await shopper.post<CartResult>("/store/cart/items", {
          variantId: a.variantId,
          quantity: 1,
          ...extra,
        });
        expect(result.status).toBe(400);
        expect(result.body.errors?.[0]?.code).toBe("unknown_field");
      }
    });

    it("stores the price the shopper saw (seen) when a line is added and when its quantity changes", async () => {
      const a = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      const token = shopper.cookie("fluxkit_cart") ?? "";
      const [cartRow] = await cartRowsOfToken(pool, token);
      const lines = await itemsOfCart(pool, cartRow?.id ?? "");
      expect(lines[0]).toMatchObject({ seen_unit_amount: "1000", seen_currency: "UAH" });
    });
  });

  describe("price_changed notice", () => {
    it("shows previousAmount after the catalog price changes, the new price and totals, and acknowledge clears it", async () => {
      const a = await catalog.simple({ price: 1_000 });
      const b = await catalog.simple({ price: 500 });
      await add(shopper, a.variantId, 2);
      await add(shopper, b.variantId, 1);
      await catalog.setPrice(a.variantId, 1_200);

      const changed = await read();
      expect(changed.lines[0]).toMatchObject({
        unitPrice: { amount: 1_200, currency: "UAH" },
        lineTotal: { amount: 2_400, currency: "UAH" },
        notices: [{ code: "price_changed", previousAmount: { amount: 1_000, currency: "UAH" } }],
      });
      expect(changed.lines[1]?.notices).toEqual([]);
      expect(changed.subtotal.amount).toBe(2_900);
      // A read does not clear the notice.
      expect((await read()).lines[0]?.notices).toHaveLength(1);

      const acknowledged = await shopper.post<CartResult>("/store/cart/acknowledge");
      expect(acknowledged.status).toBe(200);
      expect(acknowledged.body.lines[0]?.notices).toEqual([]);
      expect((await read()).lines[0]?.notices).toEqual([]);
    });

    it("also notices a price drop, and a price that went back to the seen value ends the notice", async () => {
      const a = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      await catalog.setPrice(a.variantId, 800);
      expect((await read()).lines[0]?.notices).toEqual([
        { code: "price_changed", previousAmount: { amount: 1_000, currency: "UAH" } },
      ]);
      await catalog.setPrice(a.variantId, 1_000);
      expect((await read()).lines[0]?.notices).toEqual([]);
    });

    it("keeps the notice until the line changes: a new quantity or adding more records the current price", async () => {
      const a = await catalog.simple({ price: 1_000 });
      const b = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      await add(shopper, b.variantId);
      await catalog.setPrice(a.variantId, 1_100);
      await catalog.setPrice(b.variantId, 1_100);
      expect((await read()).lines.map((line) => line.notices.length)).toEqual([1, 1]);

      const patched = await shopper.patch<CartResult>(`/store/cart/items/${a.variantId}`, {
        quantity: 4,
      });
      expect(patched.body.lines.map((line) => line.notices.length)).toEqual([0, 1]);
      const added = await add(shopper, b.variantId, 1);
      expect(added.body.lines.map((line) => line.notices.length)).toEqual([0, 0]);
    });

    it("a second change after an acknowledge shows the acknowledged price as previousAmount", async () => {
      const a = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      await catalog.setPrice(a.variantId, 1_100);
      await shopper.post("/store/cart/acknowledge");
      await catalog.setPrice(a.variantId, 1_300);
      expect((await read()).lines[0]?.notices).toEqual([
        { code: "price_changed", previousAmount: { amount: 1_100, currency: "UAH" } },
      ]);
    });

    it("reflects a changed compare-at price immediately and without a notice", async () => {
      const a = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      await catalog.setPrice(a.variantId, 1_000, 1_400);
      expect((await read()).lines[0]).toMatchObject({ compareAtAmount: 1_400, notices: [] });
    });
  });

  describe("lines that can no longer be bought stay, marked unavailable", () => {
    it("a deactivated variant: unavailable, no price, left out of the subtotal, cart not purchasable", async () => {
      const a = await catalog.simple({ price: 1_000 });
      const b = await catalog.simple({ price: 500 });
      await add(shopper, a.variantId, 2);
      await add(shopper, b.variantId, 1);
      await catalog.setActive(a.variantId, false);
      const cart = await read();
      expect(cart.lines[0]).toEqual(
        expect.objectContaining({
          variantId: a.variantId,
          quantity: 2,
          unitPrice: null,
          compareAtAmount: null,
          lineTotal: null,
          availability: "out_of_stock",
          notices: [{ code: "unavailable" }],
        }),
      );
      expect(cart.lines[1]?.lineTotal).toEqual({ amount: 500, currency: "UAH" });
      expect(cart.subtotal).toEqual({ amount: 500, currency: "UAH" });
      expect(cart.total).toEqual(cart.subtotal);
      expect(cart.itemCount).toBe(3);
      expect(cart.purchasable).toBe(false);
    });

    it("a cart whose only line is unavailable has a zero subtotal and is not purchasable", async () => {
      const a = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      await catalog.setActive(a.variantId, false);
      const cart = await read();
      expect(cart.subtotal).toEqual({ amount: 0, currency: "UAH" });
      expect(cart.purchasable).toBe(false);
    });

    it.each([["a deleted price", async (c: CartCatalog, id: string) => c.deletePrice(id)]])(
      "%s makes the line unavailable",
      async (_name, change) => {
        const a = await catalog.simple({ price: 1_000 });
        await add(shopper, a.variantId);
        await change(catalog, a.variantId);
        const cart = await read();
        expect(cart.lines[0]?.notices).toEqual([{ code: "unavailable" }]);
        expect(cart.lines[0]?.unitPrice).toBeNull();
        expect(cart.subtotal.amount).toBe(0);
      },
    );

    it.each(["draft", "archived"] as const)(
      "a product that becomes %s makes its lines unavailable, and back to active restores them",
      async (status) => {
        const a = await catalog.simple({ price: 1_000 });
        await add(shopper, a.variantId);
        await catalog.setProductStatus(a.productId, status);
        expect((await read()).lines[0]?.notices).toEqual([{ code: "unavailable" }]);
        await catalog.setProductStatus(a.productId, "active");
        const restored = await read();
        expect(restored.lines[0]).toMatchObject({ notices: [], lineTotal: { amount: 1_000 } });
        expect(restored.purchasable).toBe(true);
      },
    );

    it("acknowledge does not touch an unavailable line, and the line keeps its seen price for when it returns", async () => {
      const a = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      await catalog.setActive(a.variantId, false);
      await catalog.setPrice(a.variantId, 1_700);
      const acknowledged = await shopper.post<CartResult>("/store/cart/acknowledge");
      expect(acknowledged.body.lines[0]?.notices).toEqual([{ code: "unavailable" }]);
      await catalog.setActive(a.variantId, true);
      expect((await read()).lines[0]?.notices).toEqual([
        { code: "price_changed", previousAmount: { amount: 1_000, currency: "UAH" } },
      ]);
    });

    it("a PATCH of an unavailable line is allowed and keeps its seen price; removing it works", async () => {
      const a = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId);
      await catalog.setActive(a.variantId, false);
      const patched = await shopper.patch<CartResult>(`/store/cart/items/${a.variantId}`, {
        quantity: 5,
      });
      expect(patched.status).toBe(200);
      expect(patched.body.lines[0]).toMatchObject({
        quantity: 5,
        notices: [{ code: "unavailable" }],
      });
      const removed = await shopper.delete<CartResult>(`/store/cart/items/${a.variantId}`);
      expect(removed.body.lines).toEqual([]);
    });

    it("a deleted variant leaves the cart (the FK cascades), the rest stays", async () => {
      const a = await catalog.simple({ price: 1_000 });
      const b = await catalog.simple({ price: 500 });
      await add(shopper, a.variantId);
      await add(shopper, b.variantId);
      await pool.query("delete from variant where id = $1", [a.variantId]);
      const cart = await read();
      expect(cart.lines.map((line) => line.variantId)).toEqual([b.variantId]);
      expect(cart.subtotal.amount).toBe(500);
    });
  });

  describe("availability (a status, never a quantity)", () => {
    it("reports in_stock, low_stock and out_of_stock from the stock the store would show", async () => {
      const plenty = await catalog.simple({ trackInventory: true, onHand: 50 });
      const low = await catalog.simple({ trackInventory: true, onHand: 12345, reserved: 12341 });
      const none = await catalog.simple({ trackInventory: true, onHand: 3, reserved: 3 });
      const backorder = await catalog.simple({
        trackInventory: true,
        allowBackorder: true,
        onHand: 0,
      });
      const untracked = await catalog.simple({ trackInventory: false });
      for (const variant of [plenty, low, none, backorder, untracked]) {
        await add(shopper, variant.variantId);
      }
      const cart = await read();
      expect(cart.lines.map((line) => line.availability)).toEqual([
        "in_stock",
        "low_stock",
        "out_of_stock",
        "in_stock",
        "in_stock",
      ]);
      expect(cart.lines[2]?.notices).toEqual([{ code: "out_of_stock" }]);
      expect(cart.lines.filter((line) => line.notices.length > 0)).toHaveLength(1);
      const text = JSON.stringify(cart);
      for (const secret of ["12345", "12341", "onHand", "reserved", "location"]) {
        expect(text).not.toContain(secret);
      }
    });

    it("follows a stock change on the next read", async () => {
      const a = await catalog.simple({ trackInventory: true, onHand: 50 });
      await add(shopper, a.variantId);
      expect((await read()).lines[0]?.availability).toBe("in_stock");
      await catalog.setStock(a.variantId, 0);
      expect((await read()).lines[0]).toMatchObject({
        availability: "out_of_stock",
        notices: [{ code: "out_of_stock" }],
      });
    });
  });

  describe("SHOP_CURRENCY", () => {
    it("prices the cart in the shop currency and refuses variants that have none", async () => {
      const eur = await startApp({
        adminAuthenticator: "production-default",
        clock,
        shopCurrency: "EUR",
      });
      try {
        const shopperEur = new Shopper(eur.baseUrl);
        const sold = await catalog.simple({
          price: null,
          otherCurrency: { currency: "EUR", amount: 900 },
        });
        const uahOnly = await catalog.simple({ price: 1_000 });
        const refused = await add(shopperEur, uahOnly.variantId);
        expect(refused.status).toBe(409);
        expect(refused.body.rule).toBe("variant_not_sellable");
        const cart = (await add(shopperEur, sold.variantId, 2)).body;
        expect(cart.lines[0]?.unitPrice).toEqual({ amount: 900, currency: "EUR" });
        expect(cart.subtotal).toEqual({ amount: 1_800, currency: "EUR" });
        expect((await shopperEur.get<CartResult>("/store/cart")).body.total.currency).toBe("EUR");
        // The empty cart is in the shop currency too.
        expect(
          (await new Shopper(eur.baseUrl).get<CartResult>("/store/cart")).body.subtotal,
        ).toEqual({ amount: 0, currency: "EUR" });
      } finally {
        await eur.app.close();
      }
    });

    it("a line seen in another currency (the shop currency changed) shows price_changed, or unavailable without a new price", async () => {
      const both = await catalog.simple({
        price: 1_000,
        otherCurrency: { currency: "EUR", amount: 25 },
      });
      const onlyUah = await catalog.simple({ price: 700 });
      await add(shopper, both.variantId);
      await add(shopper, onlyUah.variantId);

      const eur = await startApp({
        adminAuthenticator: "production-default",
        clock,
        shopCurrency: "EUR",
      });
      try {
        const sameCart = new Shopper(eur.baseUrl);
        sameCart.setCookie("fluxkit_cart", shopper.cookie("fluxkit_cart") ?? "");
        const cart = (await sameCart.get<CartResult>("/store/cart")).body;
        expect(cart.lines[0]).toMatchObject({
          unitPrice: { amount: 25, currency: "EUR" },
          notices: [{ code: "price_changed", previousAmount: { amount: 1_000, currency: "UAH" } }],
        });
        expect(cart.lines[1]).toMatchObject({
          unitPrice: null,
          notices: [{ code: "unavailable" }],
        });
        expect(cart.subtotal).toEqual({ amount: 25, currency: "EUR" });
        const acknowledged = (await sameCart.post<CartResult>("/store/cart/acknowledge")).body;
        expect(acknowledged.lines[0]?.notices).toEqual([]);
      } finally {
        await eur.app.close();
      }
    });
  });

  describe("amounts near the limits are exact; an overflow is a documented 409, never a clamp", () => {
    it("computes 999 x a large price exactly", async () => {
      const a = await catalog.simple({ price: 1_000_000_000 });
      const cart = (await add(shopper, a.variantId, 999)).body;
      expect(cart.lines[0]?.lineTotal).toEqual({ amount: 999_000_000_000, currency: "UAH" });
      expect(cart.subtotal.amount).toBe(999_000_000_000);
      expect(Number.isSafeInteger(cart.subtotal.amount)).toBe(true);
    });

    it("allows a line total of exactly MAX_AMOUNT and refuses one unit more with line_total_out_of_range", async () => {
      const max = await catalog.simple({ price: MAX_AMOUNT });
      const single = await add(shopper, max.variantId, 1);
      expect(single.status).toBe(200);
      expect(single.body.lines[0]?.lineTotal?.amount).toBe(MAX_AMOUNT);
      expect(single.body.subtotal.amount).toBe(MAX_AMOUNT);
      const two = await add(shopper, max.variantId, 1);
      expect(two.status).toBe(409);
      expect(two.body).toMatchObject({ code: "rule_violation", rule: "line_total_out_of_range" });
      expect(two.body.errors).toEqual([
        { path: `lines.${max.variantId}`, code: "line_total_out_of_range" },
      ]);
      // The refused write changed nothing.
      expect((await read()).lines.find((line) => line.variantId === max.variantId)?.quantity).toBe(
        1,
      );
    });

    it("refuses a first add whose line total overflows and leaves no cart or cookie", async () => {
      const before = await countCartsSince(pool, START);
      const big = await catalog.simple({ price: 100_000_000_000 });
      const result = await add(shopper, big.variantId, 11);
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        code: "rule_violation",
        rule: "line_total_out_of_range",
      });
      expect(result.headers.getSetCookie()).toEqual([]);
      expect(await countCartsSince(pool, START)).toBe(before);
    });

    it("refuses an add that makes the subtotal overflow with subtotal_out_of_range and keeps the cart as it was", async () => {
      const a = await catalog.simple({ price: 700_000_000_000 });
      const b = await catalog.simple({ price: 400_000_000_000 });
      expect((await add(shopper, a.variantId)).status).toBe(200);
      const refused = await add(shopper, b.variantId);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "rule_violation", rule: "subtotal_out_of_range" });
      const cart = await read();
      expect(cart.lines.map((line) => line.variantId)).toEqual([a.variantId]);
      expect(cart.subtotal.amount).toBe(700_000_000_000);
    });

    it("a subtotal that overflows while every line fits stays a 409 on read: no single line is to blame", async () => {
      const a = await catalog.simple({ price: 1_000 });
      const b = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId, 1);
      await add(shopper, b.variantId, 1);
      await catalog.setPrice(a.variantId, 700_000_000_000);
      await catalog.setPrice(b.variantId, 700_000_000_000);
      const stuck = await shopper.get<CartResult>("/store/cart");
      expect(stuck.status).toBe(409);
      expect(stuck.body).toMatchObject({ code: "rule_violation", rule: "subtotal_out_of_range" });
      expect((await shopper.delete(`/store/cart/items/${b.variantId}`)).status).toBe(200);
    });

    it("a cart that became unpriceable (a price rose) is READ with the overflowing line marked unavailable, can be repaired by lowering or removing, and always be emptied", async () => {
      const a = await catalog.simple({ price: 1_000 });
      const b = await catalog.simple({ price: 1_000 });
      await add(shopper, a.variantId, 100);
      await add(shopper, b.variantId, 1);
      await catalog.setPrice(a.variantId, 100_000_000_000);

      // Review fix (Low): the shopper can still READ the cart. The line that no longer fits is unavailable (no price, no
      // total), left out of the subtotal, carries its own notice, and the cart can not be ordered as it is.
      const stuck = await shopper.get<CartResult>("/store/cart");
      expect(stuck.status, JSON.stringify(stuck.body)).toBe(200);
      expect(stuck.headers.get("cache-control")).toBe("no-store");
      const [stuckA, stuckB] = stuck.body.lines;
      expect(stuckA).toMatchObject({
        variantId: a.variantId,
        quantity: 100,
        unitPrice: null,
        lineTotal: null,
        notices: [{ code: "line_total_out_of_range" }],
      });
      expect(stuckB).toMatchObject({ variantId: b.variantId, lineTotal: { amount: 1_000 } });
      expect(stuck.body.subtotal.amount).toBe(1_000);
      expect(stuck.body.itemCount).toBe(101);
      expect(stuck.body.purchasable).toBe(false);
      // A change that leaves the cart unpriceable is refused and rolled back ...
      const stillStuck = await shopper.patch<CartResult>(`/store/cart/items/${b.variantId}`, {
        quantity: 3,
      });
      expect(stillStuck.status).toBe(409);
      // ... one that fixes it is allowed.
      const lowered = await shopper.patch<CartResult>(`/store/cart/items/${a.variantId}`, {
        quantity: 5,
      });
      expect(lowered.status).toBe(200);
      expect(lowered.body.lines[0]?.lineTotal?.amount).toBe(500_000_000_000);
      expect(lowered.body.lines[1]?.quantity).toBe(1);

      await catalog.setPrice(a.variantId, 300_000_000_000);
      const again = await shopper.get<CartResult>("/store/cart");
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.lines[0]?.notices).toEqual([{ code: "line_total_out_of_range" }]);
      const removed = await shopper.delete<CartResult>(`/store/cart/items/${a.variantId}`);
      expect(removed.status).toBe(200);
      expect(removed.body.lines.map((line) => line.variantId)).toEqual([b.variantId]);

      await shopper.patch(`/store/cart/items/${b.variantId}`, { quantity: 999 });
      await catalog.setPrice(b.variantId, 100_000_000_000);
      expect((await shopper.get("/store/cart")).status).toBe(200);
      expect((await shopper.delete("/store/cart")).status).toBe(204);
      expect((await shopper.get<CartResult>("/store/cart")).body.lines).toEqual([]);
    });
  });

  describe("leaks", () => {
    it("exposes exactly the documented keys and no stock, ids of other rows, hashes, flags or other-currency prices", async () => {
      const product = await catalog.product({ withColors: true });
      await catalog.media(product.id, "https://img.test/a.jpg", 0);
      const red = await catalog.variant(product.id, {
        color: "red",
        price: 1_000,
        compareAt: 1_500,
        trackInventory: true,
        onHand: 424_243,
        reserved: 31_337,
        otherCurrency: { currency: "USD", amount: 424_242 },
      });
      const first = await add(shopper, red, 2);
      const second = await shopper.patch<CartResult>(`/store/cart/items/${red}`, { quantity: 3 });
      const third = await shopper.post<CartResult>("/store/cart/acknowledge");
      const fourth = await read();

      const token = shopper.cookie("fluxkit_cart") ?? "";
      const [row] = await cartRowsOfToken(pool, token);
      const productId = product.id;
      const itemId = (
        await pool.query<{ id: string }>("select id from cart_item where cart_id = $1", [row?.id])
      ).rows[0]?.id;
      const locationId = (await pool.query<{ id: string }>("select id from location limit 1"))
        .rows[0]?.id;

      const allowedKeys = new Set([
        "lines",
        "subtotal",
        "total",
        "itemCount",
        "purchasable",
        "requiresShipping",
        "notices",
        "variantId",
        "productSlug",
        "sku",
        "title",
        "variantTitle",
        "optionValues",
        "option",
        "value",
        "image",
        "url",
        "alt",
        "quantity",
        "unitPrice",
        "compareAtAmount",
        "lineTotal",
        "availability",
        "amount",
        "currency",
      ]);
      for (const response of [first, second, third]) {
        expect(response.status).toBe(200);
        for (const key of deepKeys(response.body)) {
          expect(allowedKeys.has(key), `unexpected key "${key}"`).toBe(true);
        }
      }
      for (const key of deepKeys(fourth)) {
        expect(allowedKeys.has(key), `unexpected key "${key}"`).toBe(true);
      }
      const text = JSON.stringify([first.body, second.body, third.body, fourth]);
      const forbidden = [
        "424243",
        "31337",
        "424242",
        "USD",
        token,
        row?.token_hash ?? "?",
        row?.id ?? "?",
        productId,
        itemId ?? "?",
        locationId ?? "?",
        "trackInventory",
        "allowBackorder",
        "isActive",
        "tokenHash",
        "cartId",
        "customerId",
        "seen",
      ];
      for (const secret of forbidden) {
        expect(text, secret).not.toContain(secret);
      }
    });

    it("exposes nothing in the problem bodies of refusals either", async () => {
      const draft = await catalog.simple({ status: "draft", onHand: 99_881, trackInventory: true });
      const refused = await add(shopper, draft.variantId);
      const text = JSON.stringify(refused.body);
      expect(text).not.toContain("99881");
      expect(text).not.toContain(draft.productId);
      expect(Object.keys(refused.body).sort()).toEqual(
        ["code", "detail", "rule", "status", "title", "type"].sort(),
      );
    });
  });

  describe("query count (no N+1)", () => {
    async function statements(run: () => Promise<unknown>): Promise<number> {
      const spy = vi.spyOn(pg.Client.prototype, "query");
      try {
        await run();
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }

    async function bigCart(lineCount: number): Promise<{ shopper: Shopper; variants: string[] }> {
      const who = new Shopper(running.baseUrl);
      const variants: string[] = [];
      for (let index = 0; index < lineCount; index += 1) {
        const product = await catalog.product({ withColors: true });
        await catalog.media(product.id, `https://img.test/${index}.jpg`, 0);
        const variantId = await catalog.variant(product.id, {
          color: "red",
          price: 100 + index,
          trackInventory: true,
          onHand: 10 + index,
        });
        variants.push(variantId);
        expect((await add(who, variantId, 1 + (index % 3))).status).toBe(200);
      }
      return { shopper: who, variants };
    }

    it("issues the same number of statements for a cart of 1 line and of 50 lines, on a read and on every write", async () => {
      const small = await bigCart(1);
      const large = await bigCart(50);
      const extraSmall = await catalog.simple();
      const extraLarge = await catalog.simple();

      type Entry = { shopper: Shopper; variants: string[] };
      const runs: [string, (who: Entry, extra: string) => Promise<unknown>, boolean?][] = [
        ["GET /store/cart", (who) => who.shopper.get("/store/cart")],
        ["POST add a new line", (who, extra) => add(who.shopper, extra)],
        ["POST add to a line", (who) => add(who.shopper, who.variants[0] ?? "")],
        [
          "PATCH quantity",
          (who) => who.shopper.patch(`/store/cart/items/${who.variants[0]}`, { quantity: 7 }),
        ],
        ["DELETE a line", (who) => who.shopper.delete(`/store/cart/items/${who.variants[0]}`)],
        [
          "POST acknowledge (every line changed)",
          (who) => who.shopper.post("/store/cart/acknowledge"),
          true,
        ],
      ];
      for (const [name, run, changesPrices] of runs) {
        if (changesPrices === true) {
          // Every line of both carts has a new price, so acknowledge has the same number of lines to update.
          for (const entry of [small, large]) {
            const lines = (await entry.shopper.get<CartResult>("/store/cart")).body.lines;
            for (const line of lines) {
              await catalog.setPrice(line.variantId, 888);
            }
          }
        }
        const forSmall = await statements(() => run(small, extraSmall.variantId));
        const forLarge = await statements(() => run(large, extraLarge.variantId));
        expect(forSmall, name).toBeGreaterThan(0);
        expect(forLarge, `${name}: 1 line vs 50 lines`).toBe(forSmall);
        expect(forLarge, `${name}: a fixed budget`).toBeLessThanOrEqual(16);
      }
    }, 60_000);
  });
});
