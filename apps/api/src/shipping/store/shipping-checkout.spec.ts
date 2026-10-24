import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_AMOUNT, ORDER_READ_PORT, type OrderReadPort } from "@fluxkit/core";
import { hashSessionToken } from "../../auth/session-token.js";
import { canonicalJson } from "../../orders/checkout-fingerprint.js";
import { ShippingProviderRegistry } from "../registry/index.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { CartCatalog } from "../../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { FakeClock } from "../../test/fake-clock.js";
import { ensureMigrated } from "../../test/migrate.js";
import {
  ADDRESS,
  checkoutAs,
  checkoutBody,
  orderRow,
  orderTableCounts,
  type CheckoutResult,
} from "../../test/order-http.js";
import { PlacedOrders } from "../../test/order-fixtures.js";
import {
  captureLogs,
  expectNoActiveMethods,
  ShippingMethods,
  shippingOptions,
} from "../../test/shipping-fixtures.js";
import { Shopper } from "../../test/shopper.js";
import {
  TEST_ESTIMATE_MINOR_UNITS,
  testShippingProviders,
  type TestShippingProvider,
} from "../../test/test-shipping-provider.js";

const START = new Date("2034-05-01T08:00:00.000Z");
const POINT = "test-city-kyiv-point-1";
const LOCKER = "test-city-kyiv-point-2";

interface OrderShippingRowForTest {
  method_id: string | null;
  method_code: string;
  kind: string;
  provider_code: string | null;
  title: Record<string, string>;
  amount: string;
  currency: string;
  payer: string;
  estimated_carrier_amount: string | null;
  destination: Record<string, string> | null;
}

describe("checkout with a shipping method (ADR 0029 decision 4; real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const methods = new ShippingMethods(pool);
  const placedOrders = new PlacedOrders(pool);
  let running: RunningApp;
  let shopper: Shopper;
  let provider: TestShippingProvider;

  const add = (who: Shopper, variantId: string, quantity = 1) =>
    who.post("/store/cart/items", { variantId, quantity });

  async function place(
    total: number,
    overrides: Record<string, unknown> = {},
    key: string = randomUUID(),
    who: Shopper = shopper,
  ) {
    const result = await checkoutAs(who, checkoutBody(total, overrides), key);
    if (result.status === 201 || result.status === 200) {
      placedOrders.track(result.body.order?.number ?? "");
    }
    return result;
  }

  /** A physical tracked variant with stock in the cart of `shopper`. */
  async function cartWith(price: number, quantity = 1, onHand = 5) {
    const made = await catalog.simple({ trackInventory: true, onHand, price });
    await add(shopper, made.variantId, quantity);
    return made;
  }

  async function shippingOf(orderId: string): Promise<OrderShippingRowForTest | undefined> {
    const result = await pool.query<OrderShippingRowForTest>(
      "select * from order_shipping where order_id = $1",
      [orderId],
    );
    return result.rows[0];
  }

  async function adjustmentsOf(orderId: string) {
    const result = await pool.query<{
      kind: string;
      code: string;
      label: Record<string, string>;
      amount: string;
      included_in_price: boolean;
      source: string | null;
    }>(
      "select kind, code, label, amount, included_in_price, source from order_adjustment where order_id = $1",
      [orderId],
    );
    return result.rows;
  }

  const optionOf = async (code: string, query: Record<string, string> = { country: "UA" }) => {
    const result = await shippingOptions(shopper, query);
    expect(result.status).toBe(200);
    const option = result.body.options.find((entry) => entry.methodCode === code);
    if (option === undefined) {
      throw new Error(`no option ${code}`);
    }
    return option;
  };

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      extraShippingProviders: testShippingProviders(),
      rateLimits: {
        checkout: { maxAttempts: 1000, windowMinutes: 10 },
        shippingOptions: { maxAttempts: 1000, windowMinutes: 1 },
        shippingLookup: { maxAttempts: 1000, windowMinutes: 1 },
      },
    });
    provider = running.app.get(ShippingProviderRegistry).get("fake") as TestShippingProvider;
    await catalog.init();
  });

  beforeEach(async () => {
    await expectNoActiveMethods(pool);
    // Past every cache entry of the previous test (24 h + 72 h stale window), so each test starts cold.
    clock.advanceMinutes(5 * 24 * 60);
    provider.reset();
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

  describe("the price and the total (money, TDD)", () => {
    it("adds the shipping price to the order total and writes the snapshot and ONE shipping adjustment", async () => {
      const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
      await cartWith(2_500, 2);
      const option = await optionOf(method.code);
      expect(option).toMatchObject({
        available: true,
        price: { amount: 500, currency: "UAH" },
        total: { amount: 5_500, currency: "UAH" },
        payer: "shop_charge",
      });

      const result = await place(option.total?.amount ?? 0, {
        shipping: { methodCode: method.code },
      });
      expect(result.status).toBe(201);
      expect(result.body.order).toMatchObject({
        subtotal: { amount: 5_000, currency: "UAH" },
        shippingTotal: { amount: 500, currency: "UAH" },
        total: { amount: 5_500, currency: "UAH" },
        adjustments: [
          {
            kind: "shipping",
            code: method.code,
            label: "Кур'єр",
            amount: { amount: 500, currency: "UAH" },
            includedInPrice: false,
          },
        ],
        shippingAddress: ADDRESS,
        shipping: {
          methodCode: method.code,
          kind: "address",
          title: "Кур'єр",
          providerCode: null,
          amount: { amount: 500, currency: "UAH" },
          payer: "shop_charge",
          estimatedCarrierAmount: null,
          destination: null,
        },
      });
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect([row.subtotal_amount, row.shipping_total, row.total_amount]).toEqual([
        "5000",
        "500",
        "5500",
      ]);
      expect(await shippingOf(row.id)).toMatchObject({
        method_id: method.id,
        method_code: method.code,
        kind: "address",
        title: { uk: "Кур'єр", en: "Courier" },
        amount: "500",
        currency: "UAH",
        payer: "shop_charge",
        destination: null,
      });
      expect(await adjustmentsOf(row.id)).toEqual([
        {
          kind: "shipping",
          code: method.code,
          label: { uk: "Кур'єр", en: "Courier" },
          amount: "500",
          included_in_price: false,
          source: null,
        },
      ]);
    });

    it("a client that still sends the subtotal as the total gets 409 shipping_changed with the fresh option, and nothing is reserved", async () => {
      const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
      const { variantId } = await cartWith(2_500);
      const before = await orderTableCounts(pool, [variantId]);
      const result = await place(2_500, { shipping: { methodCode: method.code } });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("shipping_changed");
      expect(result.body.shipping).toMatchObject({
        methodCode: method.code,
        available: true,
        total: { amount: 3_000, currency: "UAH" },
      });
      expect(result.body.cart).toBeUndefined();
      expect(await orderTableCounts(pool, [variantId])).toEqual(before);
    });

    it("free over a threshold: free at exactly the threshold, charged one minor unit below", async () => {
      const method = await methods.create({
        pricing: { type: "free_over", amount: 700, freeFrom: 10_000 },
      });
      await cartWith(10_000);
      const free = await place(10_000, { shipping: { methodCode: method.code } });
      expect(free.status).toBe(201);
      expect(free.body.order).toMatchObject({
        shippingTotal: { amount: 0 },
        total: { amount: 10_000 },
        adjustments: [{ kind: "shipping", amount: { amount: 0 } }],
      });

      await cartWith(9_999);
      expect((await place(9_999, { shipping: { methodCode: method.code } })).body.code).toBe(
        "shipping_changed",
      );
      const charged = await place(10_699, { shipping: { methodCode: method.code } });
      expect(charged.status).toBe(201);
      expect(charged.body.order).toMatchObject({
        shippingTotal: { amount: 700 },
        total: { amount: 10_699 },
      });
    });

    it("tiers: the highest tier reached decides", async () => {
      const method = await methods.create({
        pricing: {
          type: "tiers",
          tiers: [
            { fromSubtotal: 0, amount: 900 },
            { fromSubtotal: 5_000, amount: 400 },
          ],
        },
      });
      await cartWith(5_000);
      const result = await place(5_400, { shipping: { methodCode: method.code } });
      expect(result.status).toBe(201);
      expect(result.body.order?.shippingTotal.amount).toBe(400);
    });

    it("refuses a total beyond MAX_AMOUNT as 409 rule_violation total_out_of_range (never clamped), and accepts exactly MAX_AMOUNT", async () => {
      const charged = await methods.create({ pricing: { type: "flat", amount: 1 } });
      const free = await methods.create({ pricing: { type: "flat", amount: 0 } });
      const { variantId } = await cartWith(MAX_AMOUNT);
      const option = await optionOf(charged.code);
      expect(option).toMatchObject({ available: false, reason: "total_out_of_range" });
      const before = await orderTableCounts(pool, [variantId]);
      const refused = await place(MAX_AMOUNT, { shipping: { methodCode: charged.code } });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "rule_violation", rule: "total_out_of_range" });
      expect(await orderTableCounts(pool, [variantId])).toEqual(before);

      const accepted = await place(MAX_AMOUNT, { shipping: { methodCode: free.code } });
      expect(accepted.status).toBe(201);
      expect(accepted.body.order?.total.amount).toBe(MAX_AMOUNT);
    });

    it("carrier on delivery charges 0, names the recipient and records the estimate the options showed", async () => {
      const method = await methods.create({
        kind: "pickup_point",
        pricing: { type: "carrier_on_delivery" },
      });
      await cartWith(3_000);
      const option = await optionOf(method.code, { pickupPointRef: POINT });
      expect(option).toMatchObject({
        available: true,
        price: { amount: 0 },
        payer: "recipient_on_delivery",
        total: { amount: 3_000 },
        estimate: { amount: TEST_ESTIMATE_MINOR_UNITS, currency: "UAH" },
      });
      const result = await place(3_000, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: POINT },
      });
      expect(result.status).toBe(201);
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect(await shippingOf(row.id)).toMatchObject({
        amount: "0",
        payer: "recipient_on_delivery",
        estimated_carrier_amount: String(TEST_ESTIMATE_MINOR_UNITS),
      });
      expect(row.total_amount).toBe("3000");
    });
  });

  describe("consent: cart_changed first, then shipping_changed", () => {
    it("a line price that changed is cart_changed, even when the method price changed too", async () => {
      const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
      const { variantId } = await cartWith(2_000);
      const option = await optionOf(method.code);
      await catalog.setPrice(variantId, 2_100);
      await methods.update(method.id, { pricing: { type: "flat", amount: 600 } });
      const result = await place(option.total?.amount ?? 0, {
        shipping: { methodCode: method.code },
      });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("cart_changed");
      expect(result.body.cart).toBeDefined();
    });

    it("only the method price changed (an admin repriced it): shipping_changed with the new price", async () => {
      const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
      await cartWith(2_000);
      const option = await optionOf(method.code);
      await methods.update(method.id, { pricing: { type: "flat", amount: 650 } });
      const result = await place(option.total?.amount ?? 0, {
        shipping: { methodCode: method.code },
      });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("shipping_changed");
      expect(result.body.shipping).toMatchObject({
        price: { amount: 650 },
        total: { amount: 2_650 },
      });
      // Consent to the new total places the order.
      expect((await place(2_650, { shipping: { methodCode: method.code } })).status).toBe(201);
    });

    it("the method was deactivated or never existed: shipping_changed with available false", async () => {
      const method = await methods.create();
      await methods.create(); // another active method keeps the shop "with methods"
      await cartWith(2_000);
      await methods.update(method.id, { isActive: false });
      const gone = await place(2_500, { shipping: { methodCode: method.code } });
      expect(gone.status).toBe(409);
      expect(gone.body).toMatchObject({
        code: "shipping_changed",
        shipping: { methodCode: method.code, available: false, reason: "inactive" },
      });
      const unknown = await place(2_500, { shipping: { methodCode: "no_such_method" } });
      expect(unknown.body.shipping).toEqual({
        methodCode: "no_such_method",
        available: false,
        reason: "inactive",
      });
    });

    it("a country the method does not serve: shipping_changed with the reason", async () => {
      const method = await methods.create({ countryCodes: ["PL"] });
      await cartWith(2_000);
      const result = await place(2_500, { shipping: { methodCode: method.code } });
      expect(result.status).toBe(409);
      expect(result.body.shipping).toMatchObject({
        available: false,
        reason: "country_not_served",
        price: null,
        total: null,
      });
    });
  });

  describe("selection rules", () => {
    it("a cart that ships nothing refuses a method: 400 shipping_not_applicable", async () => {
      const method = await methods.create();
      const digital = await catalog.simple({ digital: true, price: 1_000 });
      await add(shopper, digital.variantId);
      const result = await place(1_000, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code },
      });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("shipping_not_applicable");
      // Without the member the digital order works as before (no snapshot, no adjustment).
      const placed = await place(1_000, { shippingAddress: undefined });
      expect(placed.status).toBe(201);
      expect(placed.body.order).toMatchObject({ shipping: null, adjustments: [] });
    });

    it("a cart that ships needs a method once the shop has an active one: 400 shipping_method_required", async () => {
      await methods.create();
      await cartWith(2_000);
      const result = await place(2_000);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("shipping_method_required");
    });

    it("the kind decides the address and the pickup point", async () => {
      const address = await methods.create({ kind: "address" });
      const point = await methods.create({ kind: "pickup_point" });
      await cartWith(2_000);
      const noAddress = await place(2_500, {
        shippingAddress: undefined,
        shipping: { methodCode: address.code },
      });
      expect(noAddress.body.errors).toEqual([
        { path: "shippingAddress", code: "shipping_address_required" },
      ]);
      const refNotApplicable = await place(2_500, {
        shipping: { methodCode: address.code, pickupPointRef: POINT },
      });
      expect(refNotApplicable.body.errors).toEqual([
        { path: "shipping.pickupPointRef", code: "not_applicable" },
      ]);
      const refRequired = await place(2_500, {
        shippingAddress: undefined,
        shipping: { methodCode: point.code },
      });
      expect(refRequired.body.errors).toEqual([
        { path: "shipping.pickupPointRef", code: "required" },
      ]);
      const addressNotApplicable = await place(2_500, {
        shipping: { methodCode: point.code, pickupPointRef: POINT },
      });
      expect(addressNotApplicable.body.errors).toEqual([
        { path: "shippingAddress", code: "not_applicable" },
      ]);
    });

    it("the member is strict and judged by core", async () => {
      await cartWith(2_000);
      const result = await place(2_500, {
        shipping: { methodCode: "Bad Code", pickupPointRef: "has space", extra: 1 },
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual(
        expect.arrayContaining([{ path: "shipping.extra", code: "unknown_field" }]),
      );
    });
  });

  describe("pickup points and store pickup", () => {
    it("a pickup point order stores the point and a readable address, and needs no address", async () => {
      const method = await methods.create({
        kind: "pickup_point",
        title: { uk: "Відділення", en: "Branch" },
        pricing: { type: "flat", amount: 450 },
      });
      await cartWith(2_000);
      const result = await place(2_450, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: POINT },
      });
      expect(result.status).toBe(201);
      expect(result.body.order).toMatchObject({
        shippingAddress: {
          countryCode: "UA",
          city: "Київ",
          line1: "Відділення №1, вул. Тестова, 1",
        },
        shipping: {
          kind: "pickup_point",
          providerCode: "fake",
          destination: {
            providerRef: POINT,
            number: "1",
            kind: "branch",
            cityRef: "test-city-kyiv",
            cityName: "Київ",
            description: "Відділення №1, вул. Тестова, 1",
          },
        },
        adjustments: [{ code: method.code, label: "Відділення", amount: { amount: 450 } }],
      });
      const row = await orderRow(pool, result.body.order?.number ?? "");
      expect((await adjustmentsOf(row.id))[0]?.source).toBe("fake");
    });

    it("an unknown point is 400 unknown_pickup_point", async () => {
      const method = await methods.create({ kind: "pickup_point" });
      await cartWith(2_000);
      const result = await place(2_500, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: "no-such-point" },
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        { path: "shipping.pickupPointRef", code: "unknown_pickup_point" },
      ]);
    });

    it("a carrier that cannot be reached with the point not cached is 503 with Retry-After; a cached point still works", async () => {
      const method = await methods.create({ kind: "pickup_point" });
      const other = await methods.create({ kind: "address" });
      const { variantId } = await cartWith(2_000);
      provider.failLookup("findPickupPoint");
      const before = await orderTableCounts(pool, [variantId]);
      const down = await place(2_500, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: LOCKER },
      });
      expect(down.status).toBe(503);
      expect(down.body.code).toBe("shipping_provider_unavailable");
      expect(down.headers.get("retry-after")).toBe("30");
      expect(await orderTableCounts(pool, [variantId])).toEqual(before);
      // Only that method fails: the address method works meanwhile.
      provider.failLookup("findPickupPoint", { times: 100 });
      expect((await place(2_500, { shipping: { methodCode: other.code } })).status).toBe(201);

      // The shopper's lookup filled the cache before the carrier went down: the checkout uses it.
      provider.reset();
      await cartWith(2_000);
      const listed = await shopper.get(
        "/store/shipping/providers/fake/pickup-points?cityRef=test-city-kyiv",
      );
      expect(listed.status).toBe(200);
      provider.failLookup("findPickupPoint", { times: 100 });
      provider.failLookup("listPickupPoints", { times: 100 });
      const cached = await place(2_500, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: LOCKER },
      });
      expect(cached.status).toBe(201);
      expect(provider.calls.findPickupPoint).toBe(0);
    });

    it("store pickup needs no address and offers the method's description", async () => {
      const method = await methods.create({
        kind: "store_pickup",
        pricing: { type: "flat", amount: 0 },
        description: { uk: "Забрати в магазині", en: "Collect at the shop" },
      });
      await cartWith(2_000);
      const option = await optionOf(method.code, {});
      expect(option).toMatchObject({ available: true, description: "Забрати в магазині" });
      const result = await place(2_000, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code },
      });
      expect(result.status).toBe(201);
      expect(result.body.order).toMatchObject({
        shippingAddress: null,
        shipping: { kind: "store_pickup", destination: null },
      });
    });
  });

  describe("the snapshot is immutable", () => {
    it("keeps title and amount when the method changes later, refuses an UPDATE and survives the method's deletion", async () => {
      const method = await methods.create({ pricing: { type: "flat", amount: 500 } });
      await cartWith(2_000);
      const placed = await place(2_500, { shipping: { methodCode: method.code } });
      const number = placed.body.order?.number ?? "";
      const row = await orderRow(pool, number);
      await methods.update(method.id, {
        pricing: { type: "flat", amount: 9_999 },
        title: { uk: "Інше", en: "Other" },
      });
      await expect(
        pool.query("update order_shipping set amount = 1 where order_id = $1", [row.id]),
      ).rejects.toThrow();
      await pool.query("delete from shipping_method where id = $1", [method.id]);
      const snapshot = await shippingOf(row.id);
      expect(snapshot).toMatchObject({
        method_id: null,
        amount: "500",
        title: { uk: "Кур'єр", en: "Courier" },
      });
      // The admin view and the plugins' OrderReadPort show the snapshot as it was.
      const readPort = running.app.get<OrderReadPort>(ORDER_READ_PORT);
      const view = await readPort.getOrder(row.id);
      expect(view?.shipping).toEqual({
        methodId: null,
        methodCode: method.code,
        kind: "address",
        providerCode: null,
        providerService: null,
        title: { uk: "Кур'єр", en: "Courier" },
        amount: { amount: 500, currency: "UAH" },
        payer: "shop_charge",
        estimatedCarrierAmount: null,
        destination: null,
      });
      expect(view?.total).toEqual({ amount: 2_500, currency: "UAH" });
    });
  });

  describe("idempotency (fingerprint version 2)", () => {
    it("a replay answers the same order without pricing again or calling the provider", async () => {
      const method = await methods.create({ kind: "pickup_point" });
      await cartWith(2_000);
      const key = randomUUID();
      const body = {
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: POINT },
      };
      const first = await place(2_500, body, key);
      expect(first.status).toBe(201);
      const calls = provider.calls.findPickupPoint;
      // Repricing the method and taking the carrier down change nothing for a replay.
      await methods.update(method.id, { pricing: { type: "flat", amount: 1 } });
      provider.failLookup("findPickupPoint", { hang: true, times: 100 });
      clock.advanceMinutes(5 * 24 * 60);
      const started = Date.now();
      const replay = await place(2_500, body, key);
      expect(replay.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(replay.body.order?.number).toBe(first.body.order?.number);
      expect(replay.body.order?.total.amount).toBe(2_500);
      expect(provider.calls.findPickupPoint).toBe(calls);
    });

    it("the same key with another shipping member is idempotency_key_reused", async () => {
      const one = await methods.create();
      const two = await methods.create();
      await cartWith(2_000);
      const key = randomUUID();
      expect((await place(2_500, { shipping: { methodCode: one.code } }, key)).status).toBe(201);
      const other = await place(2_500, { shipping: { methodCode: two.code } }, key);
      expect(other.status).toBe(409);
      expect(other.body.code).toBe("idempotency_key_reused");
    });

    it("a replay of an order stored with a version 1 fingerprint is refused (accepted across the deploy)", async () => {
      const method = await methods.create();
      await cartWith(2_000);
      const key = randomUUID();
      const placed = await place(2_500, { shipping: { methodCode: method.code } }, key);
      const row = await orderRow(pool, placed.body.order?.number ?? "");
      const cart = await pool.query<{ id: string }>("select id from cart where token_hash = $1", [
        hashSessionToken(shopper.cookie("fluxkit_cart") ?? ""),
      ]);
      const version1 = createHash("sha256")
        .update(
          canonicalJson({
            v: 1,
            cartId: cart.rows[0]?.id ?? "",
            email: "buyer@example.test",
            phone: "+380501234567",
            firstName: "Іван",
            lastName: "Петренко",
            shippingAddress: ADDRESS,
            billingAddress: null,
            locale: "uk",
            expectedTotal: { amount: 2_500, currency: "UAH" },
          }),
        )
        .digest("hex");
      await pool.query("update sales_order set request_fingerprint = $2 where id = $1", [
        row.id,
        version1,
      ]);
      const replay = await place(2_500, { shipping: { methodCode: method.code } }, key);
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe("idempotency_key_reused");
    });
  });

  describe("no network inside the transaction", () => {
    it("a hanging provider holds no lock: the cart and stock rows stay free while the checkout waits, then 503", async () => {
      const method = await methods.create({ kind: "pickup_point" });
      const { variantId } = await cartWith(2_000);
      provider.failLookup("findPickupPoint", { hang: true });
      const pending = place(2_500, {
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: LOCKER },
      });
      // Wait until the provider is being called.
      for (let attempt = 0; attempt < 100 && provider.calls.findPickupPoint === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(provider.calls.findPickupPoint).toBe(1);
      const probe = await pool.connect();
      try {
        await probe.query("begin");
        // NOWAIT: an error here would mean the checkout holds the row while it waits for the carrier.
        await probe.query("select 1 from inventory_level where variant_id = $1 for update nowait", [
          variantId,
        ]);
        await probe.query("select 1 from cart where token_hash = $1 for update nowait", [
          hashSessionToken(shopper.cookie("fluxkit_cart") ?? ""),
        ]);
        await probe.query("rollback");
        const idle = await probe.query<{ count: number }>(
          `select count(*)::int as count from pg_stat_activity
            where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
        );
        expect(idle.rows[0]?.count).toBe(0);
      } finally {
        probe.release();
      }
      const result: { status: number; body: CheckoutResult } = await pending;
      expect(result.status).toBe(503);
      expect(result.body.code).toBe("shipping_provider_unavailable");
    }, 20_000);
  });

  describe("logs", () => {
    it("never carry the shopper's name or phone, a provider's message or a key", async () => {
      const method = await methods.create({ kind: "pickup_point" });
      await cartWith(2_000);
      const secret = "Іван Петренко +380501234567 apiKey=SECRET-PROVIDER-KEY-123";
      const logs = captureLogs();
      try {
        provider.failLookup("findPickupPoint", { message: secret, times: 2 });
        provider.failLookup("estimate", { message: secret });
        provider.failLookup("listPickupPoints", { message: secret });
        await shopper.get("/store/shipping/providers/fake/pickup-points?cityRef=test-city-kyiv");
        await shippingOptions(shopper, { pickupPointRef: LOCKER });
        const down = await place(2_500, {
          shippingAddress: undefined,
          shipping: { methodCode: method.code, pickupPointRef: LOCKER },
        });
        expect(down.status).toBe(503);
        expect(JSON.stringify(down.body)).not.toContain("SECRET");
        const placed = await place(2_500, {
          shippingAddress: undefined,
          shipping: { methodCode: method.code, pickupPointRef: POINT },
        });
        expect(placed.status).toBe(201);
      } finally {
        logs.stop();
      }
      const text = logs.text();
      expect(text).toContain('Shipping provider "fake" findPickupPoint failed (error)');
      for (const forbidden of [
        "SECRET",
        "Іван",
        "Петренко",
        "380501234567",
        "apiKey",
        "buyer@example.test",
      ]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    });
  });
});
