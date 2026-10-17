import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import {
  countCartsSince,
  cartRowsOfToken,
  itemsOfCart,
  sha256Hex,
  type CartResult,
} from "../test/cart-helpers.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { Shopper, setCookieOf } from "../test/shopper.js";

const START = new Date("2031-03-01T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

describe("cart API: lazy creation, cookie and line rules", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  let running: RunningApp;
  let shopper: Shopper;

  const add = (who: Shopper, variantId: string, quantity: unknown = 1) =>
    who.post<CartResult>("/store/cart/items", { variantId, quantity });

  async function tokenOf(who: Shopper): Promise<string> {
    const token = who.cookie("fluxkit_cart");
    if (token === undefined) {
      throw new Error("Test setup bug: the shopper has no cart cookie");
    }
    return token;
  }

  async function cartOf(who: Shopper) {
    const [row] = await cartRowsOfToken(pool, await tokenOf(who));
    if (row === undefined) {
      throw new Error("Test setup bug: no cart row for the cookie");
    }
    return row;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    await catalog.init();
  });

  beforeEach(() => {
    // A fresh rate-limit window per test (the limiter shares this clock).
    clock.advanceMinutes(2);
    shopper = new Shopper(running.baseUrl);
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  describe("a read creates nothing", () => {
    it("answers the empty cart with no row and no cookie when the shopper has no cookie", async () => {
      const before = await countCartsSince(pool, START);
      const result = await shopper.get<CartResult>("/store/cart");
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        lines: [],
        subtotal: { amount: 0, currency: "UAH" },
        total: { amount: 0, currency: "UAH" },
        itemCount: 0,
        purchasable: false,
        notices: [],
      });
      expect(result.headers.getSetCookie()).toEqual([]);
      expect(await countCartsSince(pool, START)).toBe(before);
    });

    it("treats a well-formed cookie that matches no cart as no cart: empty, no row, no cookie change", async () => {
      const unknown = "A".repeat(43);
      shopper.setCookie("fluxkit_cart", unknown);
      const before = await countCartsSince(pool, START);
      const result = await shopper.get<CartResult>("/store/cart");
      expect(result.status).toBe(200);
      expect(result.body.lines).toEqual([]);
      expect(result.headers.getSetCookie()).toEqual([]);
      expect(await cartRowsOfToken(pool, unknown)).toEqual([]);
      expect(await countCartsSince(pool, START)).toBe(before);
    });

    it.each(["x", "A".repeat(42), "A".repeat(44), "not a token!".padEnd(43, "!"), sha256Hex("x")])(
      "ignores the malformed cookie %j",
      async (value) => {
        shopper.setCookie("fluxkit_cart", value);
        const result = await shopper.get<CartResult>("/store/cart");
        expect(result.status).toBe(200);
        expect(result.body.lines).toEqual([]);
      },
    );
  });

  describe("the first write creates the cart and the cookie", () => {
    it("creates one row owned by the token hash and sets the cookie with the exact attributes", async () => {
      const { variantId } = await catalog.simple({ price: 1_000 });
      const result = await add(shopper, variantId, 2);
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.body.itemCount).toBe(2);

      const header = setCookieOf(result, "fluxkit_cart") ?? "";
      const [pair, ...attributes] = header.split("; ");
      expect(pair).toMatch(/^fluxkit_cart=[A-Za-z0-9_-]{43}$/);
      expect(attributes).toEqual(
        expect.arrayContaining([
          "Path=/store",
          "HttpOnly",
          "SameSite=Lax",
          "Secure",
          `Max-Age=${30 * 24 * 3600}`,
        ]),
      );
      expect(attributes.some((attribute) => attribute.startsWith("Expires="))).toBe(true);
      expect(attributes).not.toContain("Domain");

      const token = await tokenOf(shopper);
      expect(token).toMatch(TOKEN);
      const rows = await cartRowsOfToken(pool, token);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row?.token_hash).toBe(sha256Hex(token));
      expect(row?.customer_id).toBeNull();
      // The raw token is never stored anywhere in the cart tables.
      const stored = await pool.query(
        "select 1 from cart where token_hash = $1 or id::text = $1 or customer_id::text = $1",
        [token],
      );
      expect(stored.rowCount).toBe(0);
    });

    it("sets expires_at to now + CART_TTL_DAYS", async () => {
      const { variantId } = await catalog.simple();
      await add(shopper, variantId);
      const row = await cartOf(shopper);
      expect(row.created_at.getTime()).toBe(clock.now().getTime());
      expect(row.expires_at.getTime()).toBe(clock.now().getTime() + 30 * DAY_MS);
    });

    it("omits Secure only when STORE_COOKIE_SECURE=false and follows CART_TTL_DAYS in Max-Age", async () => {
      const custom = await startApp({
        adminAuthenticator: "production-default",
        clock,
        storeCookieSecure: false,
        cartTtlDays: 2,
      });
      try {
        const { variantId } = await catalog.simple();
        const result = await http<CartResult>(custom.baseUrl, "POST", "/store/cart/items", {
          body: { variantId, quantity: 1 },
        });
        expect(result.status).toBe(200);
        const attributes = (setCookieOf(result, "fluxkit_cart") ?? "").split("; ");
        expect(attributes).not.toContain("Secure");
        expect(attributes).toContain("HttpOnly");
        expect(attributes).toContain(`Max-Age=${2 * 24 * 3600}`);
      } finally {
        await custom.app.close();
      }
    });

    it("re-sets the same cookie value on later writes and keeps one row", async () => {
      const { variantId } = await catalog.simple();
      const other = await catalog.simple();
      const first = await add(shopper, variantId);
      const token = await tokenOf(shopper);
      const second = await add(shopper, other.variantId);
      expect(setCookieOf(second, "fluxkit_cart")?.startsWith(`fluxkit_cart=${token};`)).toBe(true);
      expect(second.body.lines.map((line) => line.variantId)).toEqual([variantId, other.variantId]);
      expect(first.status).toBe(200);
      expect(await cartRowsOfToken(pool, token)).toHaveLength(1);
    });

    it("replaces a well-formed cookie that matches no cart with a NEW token (a client-chosen token is never adopted)", async () => {
      const { variantId } = await catalog.simple();
      const planted = "B".repeat(43);
      shopper.setCookie("fluxkit_cart", planted);
      const result = await add(shopper, variantId);
      expect(result.status).toBe(200);
      const token = await tokenOf(shopper);
      expect(token).not.toBe(planted);
      expect(await cartRowsOfToken(pool, planted)).toEqual([]);
      expect(await cartRowsOfToken(pool, token)).toHaveLength(1);
    });

    it("leaves no cart and no cookie behind when the first write is refused", async () => {
      const before = await countCartsSince(pool, START);
      const draft = await catalog.simple({ status: "draft" });
      const refused = await add(shopper, draft.variantId);
      expect(refused.status).toBe(409);
      expect(refused.headers.getSetCookie()).toEqual([]);
      expect(await countCartsSince(pool, START)).toBe(before);
    });
  });

  describe("lines", () => {
    it("adds a variant, adds to its quantity, sets it, removes it and keeps the order of the lines", async () => {
      const a = await catalog.simple({ price: 100 });
      const b = await catalog.simple({ price: 250 });
      const c = await catalog.simple({ price: 7 });
      await add(shopper, a.variantId, 1);
      await add(shopper, b.variantId, 2);
      let cart = (await add(shopper, c.variantId, 3)).body;
      expect(cart.lines.map((line) => [line.variantId, line.quantity])).toEqual([
        [a.variantId, 1],
        [b.variantId, 2],
        [c.variantId, 3],
      ]);
      cart = (await add(shopper, a.variantId, 4)).body;
      expect(cart.lines[0]).toMatchObject({ variantId: a.variantId, quantity: 5 });
      expect(cart.lines).toHaveLength(3);

      const set = await shopper.patch<CartResult>(`/store/cart/items/${b.variantId}`, {
        quantity: 9,
      });
      expect(set.status).toBe(200);
      expect(set.body.lines[1]).toMatchObject({ variantId: b.variantId, quantity: 9 });
      expect(set.body.itemCount).toBe(5 + 9 + 3);

      const removed = await shopper.delete<CartResult>(`/store/cart/items/${b.variantId}`);
      expect(removed.status).toBe(200);
      expect(removed.body.lines.map((line) => line.variantId)).toEqual([a.variantId, c.variantId]);

      const rows = await itemsOfCart(pool, (await cartOf(shopper)).id);
      expect(rows.map((row) => [row.variant_id, row.quantity])).toEqual([
        [a.variantId, 5],
        [c.variantId, 3],
      ]);
    });

    it("removing the last line leaves an empty cart that still has its cookie", async () => {
      const a = await catalog.simple();
      await add(shopper, a.variantId);
      const removed = await shopper.delete<CartResult>(`/store/cart/items/${a.variantId}`);
      expect(removed.status).toBe(200);
      expect(removed.body.lines).toEqual([]);
      expect(removed.body.purchasable).toBe(false);
      expect(shopper.cookie("fluxkit_cart")).toMatch(TOKEN);
    });

    it("DELETE /store/cart deletes the cart row and its lines, answers 204 and clears the cookie", async () => {
      const a = await catalog.simple();
      await add(shopper, a.variantId);
      const row = await cartOf(shopper);
      const cleared = await shopper.delete("/store/cart");
      expect(cleared.status).toBe(204);
      expect(cleared.headers.get("cache-control")).toBe("no-store");
      expect(shopper.cookie("fluxkit_cart")).toBeUndefined();
      const left = await pool.query("select 1 from cart where id = $1", [row.id]);
      expect(left.rowCount).toBe(0);
      const items = await pool.query("select 1 from cart_item where cart_id = $1", [row.id]);
      expect(items.rowCount).toBe(0);
      // The next write starts a new cart with a new token.
      const again = await add(shopper, a.variantId);
      expect(again.status).toBe(200);
      expect(again.body.itemCount).toBe(1);
    });

    it("DELETE /store/cart with no cart is a 204 that creates nothing; a dead cookie is cleared", async () => {
      const before = await countCartsSince(pool, START);
      const none = await shopper.delete("/store/cart");
      expect(none.status).toBe(204);
      expect(none.headers.getSetCookie()).toEqual([]);
      shopper.setCookie("fluxkit_cart", "C".repeat(43));
      const dead = await shopper.delete("/store/cart");
      expect(dead.status).toBe(204);
      expect(shopper.cookie("fluxkit_cart")).toBeUndefined();
      expect(await countCartsSince(pool, START)).toBe(before);
    });

    it("answers 404 for a line that is not in the cart (PATCH and DELETE), also with no cart at all", async () => {
      const a = await catalog.simple();
      const b = await catalog.simple();
      const withoutCart = await shopper.patch<CartResult>(`/store/cart/items/${a.variantId}`, {
        quantity: 2,
      });
      expect(withoutCart.status).toBe(404);
      expect(withoutCart.headers.getSetCookie()).toEqual([]);
      await add(shopper, a.variantId);
      expect(
        (await shopper.patch(`/store/cart/items/${b.variantId}`, { quantity: 2 })).status,
      ).toBe(404);
      expect((await shopper.delete(`/store/cart/items/${b.variantId}`)).status).toBe(404);
      expect((await shopper.delete(`/store/cart/items/${randomUUID()}`)).status).toBe(404);
      expect((await shopper.delete("/store/cart/items/not-a-uuid")).status).toBe(404);
      expect((await shopper.patch("/store/cart/items/not-a-uuid", { quantity: 1 })).status).toBe(
        404,
      );
    });

    it("acknowledge on a shopper with no cart is the empty cart and creates nothing", async () => {
      const before = await countCartsSince(pool, START);
      const result = await shopper.post<CartResult>("/store/cart/acknowledge");
      expect(result.status).toBe(200);
      expect(result.body.lines).toEqual([]);
      expect(await countCartsSince(pool, START)).toBe(before);
    });
  });

  describe("limits and invalid input (core rules)", () => {
    it("accepts 999 on one line and refuses the next unit with 409 rule_violation quantity_limit", async () => {
      const { variantId } = await catalog.simple({ price: 1 });
      const full = await add(shopper, variantId, 999);
      expect(full.status).toBe(200);
      expect(full.body.lines[0]?.quantity).toBe(999);
      const over = await add(shopper, variantId, 1);
      expect(over.status).toBe(409);
      expect(over.body).toMatchObject({ code: "rule_violation", rule: "quantity_limit" });
      // Never capped silently: the line still holds exactly 999.
      const after = await shopper.get<CartResult>("/store/cart");
      expect(after.body.lines[0]?.quantity).toBe(999);
    });

    it("refuses 1000 on a first add with quantity_limit and creates no cart", async () => {
      const before = await countCartsSince(pool, START);
      const { variantId } = await catalog.simple();
      const result = await add(shopper, variantId, 1_000);
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "quantity_limit" });
      expect(result.headers.getSetCookie()).toEqual([]);
      expect(await countCartsSince(pool, START)).toBe(before);
    });

    it.each([0, -1, 1.5, "2", "abc", "NaN", "1e3", null, true, [], {}])(
      "refuses the quantity %j with 400 invalid_quantity and creates nothing",
      async (quantity) => {
        const before = await countCartsSince(pool, START);
        const { variantId } = await catalog.simple();
        const result = await add(shopper, variantId, quantity);
        expect(result.status).toBe(400);
        expect(result.body.code).toBe("validation_failed");
        expect(result.body.errors).toEqual([
          expect.objectContaining({ path: "quantity", code: "invalid_quantity" }),
        ]);
        expect(result.headers.getSetCookie()).toEqual([]);
        expect(await countCartsSince(pool, START)).toBe(before);
      },
    );

    it("refuses a missing quantity with 400 required", async () => {
      const { variantId } = await catalog.simple();
      const result = await shopper.post<CartResult>("/store/cart/items", { variantId });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "quantity", code: "required" }),
      ]);
    });

    it("holds at most 100 lines: the 101st is 409 too_many_lines, an existing line can still grow", async () => {
      const variants: string[] = [];
      for (let index = 0; index < 101; index += 1) {
        variants.push((await catalog.simple()).variantId);
      }
      for (const variantId of variants.slice(0, 100)) {
        expect((await add(shopper, variantId)).status).toBe(200);
      }
      const hundredFirst = await add(shopper, variants[100] ?? "");
      expect(hundredFirst.status).toBe(409);
      expect(hundredFirst.body).toMatchObject({ code: "rule_violation", rule: "too_many_lines" });
      const grown = await add(shopper, variants[0] ?? "", 2);
      expect(grown.status).toBe(200);
      expect(grown.body.lines).toHaveLength(100);
      expect(grown.body.lines[0]?.quantity).toBe(3);
    });

    it("PATCH: 0 and fractions are 400, 1000 is 409 quantity_limit, 999 is fine", async () => {
      const { variantId } = await catalog.simple({ price: 1 });
      await add(shopper, variantId);
      const path = `/store/cart/items/${variantId}`;
      for (const quantity of [0, -3, 2.5, "7", null]) {
        const result = await shopper.patch<CartResult>(path, { quantity });
        expect(result.status, JSON.stringify(quantity)).toBe(400);
        expect(result.body.errors?.[0]).toMatchObject({
          path: "quantity",
          code: "invalid_quantity",
        });
      }
      const over = await shopper.patch<CartResult>(path, { quantity: 1_000 });
      expect(over.status).toBe(409);
      expect(over.body).toMatchObject({ code: "rule_violation", rule: "quantity_limit" });
      const ok = await shopper.patch<CartResult>(path, { quantity: 999 });
      expect(ok.status).toBe(200);
      expect(ok.body.lines[0]?.quantity).toBe(999);
    });

    it("rejects unknown fields, a malformed variant id and a cart id anywhere in the request", async () => {
      const { variantId } = await catalog.simple();
      const unknownField = await shopper.post<CartResult>("/store/cart/items", {
        variantId,
        quantity: 1,
        cartId: randomUUID(),
      });
      expect(unknownField.status).toBe(400);
      expect(unknownField.body.errors).toEqual([
        expect.objectContaining({ path: "cartId", code: "unknown_field" }),
      ]);
      expect(
        (await shopper.post<CartResult>("/store/cart/items", { variantId: "nope", quantity: 1 }))
          .status,
      ).toBe(400);
      expect((await shopper.get(`/store/cart?cartId=${randomUUID()}`)).status).toBe(400);
      expect((await shopper.get(`/store/cart/${randomUUID()}`)).status).toBe(404);
    });
  });

  describe("what can be added", () => {
    it("answers 404 for a variant that does not exist and for a product id", async () => {
      const product = await catalog.simple();
      expect((await add(shopper, randomUUID())).status).toBe(404);
      expect((await add(shopper, product.productId)).status).toBe(404);
    });

    it.each([
      ["an inactive variant", { isActive: false }],
      ["a variant without a price", { price: null }],
      ["a variant of a draft product", { status: "draft" as const }],
      ["a variant of an archived product", { status: "archived" as const }],
      [
        "a variant priced only in another currency",
        { price: null, otherCurrency: { currency: "USD", amount: 500 } },
      ],
    ])("refuses %s with 409 variant_not_sellable", async (_name, options) => {
      const { variantId } = await catalog.simple(options);
      const result = await add(shopper, variantId);
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "variant_not_sellable" });
      expect(result.headers.getSetCookie()).toEqual([]);
    });

    it("accepts an out-of-stock variant (a cart holds no stock): the line carries the out_of_stock notice", async () => {
      const { variantId } = await catalog.simple({ trackInventory: true, onHand: 0 });
      const result = await add(shopper, variantId);
      expect(result.status).toBe(200);
      expect(result.body.lines[0]).toMatchObject({
        availability: "out_of_stock",
        notices: [{ code: "out_of_stock" }],
      });
      expect(result.body.purchasable).toBe(true);
    });
  });

  describe("expiry", () => {
    it("every write moves expires_at to now + TTL; a read does not", async () => {
      const { variantId } = await catalog.simple();
      await add(shopper, variantId);
      const created = await cartOf(shopper);
      clock.advanceMinutes(10 * 24 * 60);
      await shopper.get("/store/cart");
      expect((await cartOf(shopper)).expires_at.getTime()).toBe(created.expires_at.getTime());
      await add(shopper, variantId);
      const refreshed = await cartOf(shopper);
      expect(refreshed.expires_at.getTime()).toBe(clock.now().getTime() + 30 * DAY_MS);
      expect(refreshed.updated_at.getTime()).toBe(clock.now().getTime());
      expect(refreshed.expires_at.getTime()).toBeGreaterThan(created.expires_at.getTime());
    });

    it("treats an expired cart as no cart on a read (empty, row untouched)", async () => {
      const { variantId } = await catalog.simple();
      await add(shopper, variantId);
      const row = await cartOf(shopper);
      clock.advanceMinutes(30 * 24 * 60);
      const read = await shopper.get<CartResult>("/store/cart");
      expect(read.status).toBe(200);
      expect(read.body.lines).toEqual([]);
      expect(read.headers.getSetCookie()).toEqual([]);
      expect((await cartOf(shopper)).id).toBe(row.id);
    });

    it("a write to an expired cart starts empty: the stale lines are gone, the owner keeps the token", async () => {
      const old = await catalog.simple();
      const fresh = await catalog.simple();
      await add(shopper, old.variantId, 3);
      const token = await tokenOf(shopper);
      clock.advanceMinutes(31 * 24 * 60);
      const result = await add(shopper, fresh.variantId);
      expect(result.status).toBe(200);
      expect(result.body.lines.map((line) => line.variantId)).toEqual([fresh.variantId]);
      expect(await tokenOf(shopper)).toBe(token);
      const [row] = await cartRowsOfToken(pool, token);
      expect(row?.expires_at.getTime()).toBe(clock.now().getTime() + 30 * DAY_MS);
    });

    it("answers 404 for a PATCH of a line of an expired cart", async () => {
      const a = await catalog.simple();
      await add(shopper, a.variantId);
      clock.advanceMinutes(31 * 24 * 60);
      const result = await shopper.patch(`/store/cart/items/${a.variantId}`, { quantity: 2 });
      expect(result.status).toBe(404);
    });
  });

  describe("HTTP contract", () => {
    it("sends Cache-Control: no-store on every cart response, errors included", async () => {
      const a = await catalog.simple();
      const draft = await catalog.simple({ status: "draft" });
      const responses = [
        await shopper.get("/store/cart"),
        await add(shopper, a.variantId),
        await add(shopper, draft.variantId),
        await add(shopper, a.variantId, 0),
        await shopper.patch(`/store/cart/items/${a.variantId}`, { quantity: 3 }),
        await shopper.patch(`/store/cart/items/${randomUUID()}`, { quantity: 3 }),
        await shopper.post("/store/cart/acknowledge"),
        await shopper.delete(`/store/cart/items/${a.variantId}`),
        await shopper.get("/store/cart?locale=xx"),
        await shopper.request("POST", "/store/cart/items", { body: {}, csrf: false }),
        await shopper.delete("/store/cart"),
      ];
      expect(responses.map((response) => response.status)).toEqual([
        200, 200, 409, 400, 200, 404, 200, 200, 400, 403, 204,
      ]);
      for (const response of responses) {
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    });

    it("needs the CSRF header on every write and creates nothing without it", async () => {
      const { variantId } = await catalog.simple();
      await add(shopper, variantId);
      const before = await countCartsSince(pool, START);
      const attempts: [Parameters<Shopper["request"]>[0], string, unknown][] = [
        ["POST", "/store/cart/items", { variantId, quantity: 1 }],
        ["PATCH", `/store/cart/items/${variantId}`, { quantity: 5 }],
        ["DELETE", `/store/cart/items/${variantId}`, undefined],
        ["DELETE", "/store/cart", undefined],
        ["POST", "/store/cart/acknowledge", undefined],
      ];
      for (const [method, path, body] of attempts) {
        const result = await shopper.request<CartResult>(method, path, { body, csrf: false });
        expect(result.status, `${method} ${path}`).toBe(403);
        expect(result.body.code).toBe("forbidden");
      }
      expect(await countCartsSince(pool, START)).toBe(before);
      const read = await shopper.get<CartResult>("/store/cart");
      expect(read.body.lines[0]?.quantity).toBe(1);
    });

    it("limits writes per address: 429 with Retry-After after 120 in a minute, reads are not limited", async () => {
      const { variantId } = await catalog.simple({ price: 1 });
      // Starts with an empty window: the clock moved two minutes since the previous test.
      let limited: Awaited<ReturnType<typeof add>> | undefined;
      for (let attempt = 0; attempt < 121; attempt += 1) {
        const result = await shopper.post<CartResult>("/store/cart/acknowledge");
        if (result.status === 429) {
          limited = result;
          break;
        }
        expect(result.status).toBe(200);
      }
      expect(limited?.status).toBe(429);
      expect(limited?.body.code).toBe("too_many_requests");
      expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(limited?.headers.get("cache-control")).toBe("no-store");
      expect((await shopper.get("/store/cart")).status).toBe(200);
      // The window passes.
      clock.advanceMinutes(2);
      expect((await add(shopper, variantId)).status).toBe(200);
    });
  });

  describe("locale", () => {
    it("resolves product, variant and option texts to ?locale with the default-locale fallback", async () => {
      const product = await catalog.product({
        title: { uk: "Футболка", en: "T-shirt" },
        withColors: true,
      });
      const red = await catalog.variant(product.id, {
        color: "red",
        title: { uk: "Червона", en: "Red one" },
      });
      const blue = await catalog.variant(product.id, { color: "blue" });
      await add(shopper, red);
      await add(shopper, blue);

      const uk = (await shopper.get<CartResult>("/store/cart")).body;
      expect(uk.lines.map((line) => line.title)).toEqual(["Футболка", "Футболка"]);
      expect(uk.lines[0]).toMatchObject({
        variantTitle: "Червона",
        optionValues: [{ option: "Колір", value: "Червоний" }],
      });
      expect(uk.lines[1]).toMatchObject({
        variantTitle: null,
        optionValues: [{ option: "Колір", value: "Синій" }],
      });

      const en = (await shopper.get<CartResult>("/store/cart?locale=en")).body;
      expect(en.lines[0]).toMatchObject({
        title: "T-shirt",
        variantTitle: "Red one",
        optionValues: [{ option: "Color", value: "Red" }],
      });
      // The blue value has no English label: the default locale fills in per field.
      expect(en.lines[1]).toMatchObject({ optionValues: [{ option: "Color", value: "Синій" }] });

      const written = await shopper.post<CartResult>("/store/cart/items?locale=en", {
        variantId: red,
        quantity: 1,
      });
      expect(written.body.lines[0]?.title).toBe("T-shirt");
      expect((await shopper.get("/store/cart?locale=de")).status).toBe(400);
      expect(
        (await shopper.post("/store/cart/items?locale=de", { variantId: red, quantity: 1 })).status,
      ).toBe(400);
    });

    it("shows the image of the variant's colour, else the first gallery image, with the alt text in the locale", async () => {
      const product = await catalog.product({ withColors: true });
      await catalog.media(product.id, "https://img.test/gallery.jpg", 0, {
        alt: { uk: "Галерея", en: "Gallery" },
      });
      await catalog.media(product.id, "https://img.test/red.jpg", 1, {
        color: "red",
        alt: { uk: "Червона" },
      });
      const red = await catalog.variant(product.id, { color: "red" });
      const blue = await catalog.variant(product.id, { color: "blue" });
      await add(shopper, red);
      await add(shopper, blue);
      const cart = (await shopper.get<CartResult>("/store/cart?locale=en")).body;
      expect(cart.lines[0]?.image).toEqual({ url: "https://img.test/red.jpg", alt: "Червона" });
      expect(cart.lines[1]?.image).toEqual({ url: "https://img.test/gallery.jpg", alt: "Gallery" });
      const bare = await catalog.simple();
      expect((await add(shopper, bare.variantId)).body.lines[2]?.image).toBeNull();
    });
  });
});
