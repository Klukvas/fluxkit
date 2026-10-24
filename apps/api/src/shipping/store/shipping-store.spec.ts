import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ShippingProviderRegistry } from "../registry/index.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { CartCatalog } from "../../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { FakeClock } from "../../test/fake-clock.js";
import { ensureMigrated } from "../../test/migrate.js";
import {
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

const START = new Date("2034-06-01T08:00:00.000Z");
const HOUR_MINUTES = 60;

interface PageForTest<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  stale: boolean;
  code?: string;
  errors?: { path: string; code: string }[];
}

describe("store shipping routes (ADR 0029 decisions 5 and 6; real app, real Postgres)", () => {
  const clock = new FakeClock(START);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  const methods = new ShippingMethods(pool);
  let running: RunningApp;
  let limited: RunningApp;
  let shopper: Shopper;
  let provider: TestShippingProvider;

  const add = (variantId: string, quantity = 1) =>
    shopper.post("/store/cart/items", { variantId, quantity });
  const cities = (query: string, app: RunningApp = running) =>
    new Shopper(app.baseUrl).get<PageForTest<{ ref: string; name: string; region: string | null }>>(
      `/store/shipping/providers/fake/cities?${query}`,
    );
  const points = (query: string) =>
    shopper.get<PageForTest<{ ref: string; kind: string; countryCode: string }>>(
      `/store/shipping/providers/fake/pickup-points?${query}`,
    );

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      clock,
      extraShippingProviders: testShippingProviders(),
      rateLimits: {
        shippingOptions: { maxAttempts: 1000, windowMinutes: 1 },
        shippingLookup: { maxAttempts: 1000, windowMinutes: 1 },
      },
    });
    limited = await startApp({
      extraShippingProviders: testShippingProviders(),
      rateLimits: {
        shippingOptions: { maxAttempts: 2, windowMinutes: 1 },
        shippingLookup: { maxAttempts: 2, windowMinutes: 1 },
      },
    });
    provider = running.app.get(ShippingProviderRegistry).get("fake") as TestShippingProvider;
    await catalog.init();
  });

  beforeEach(async () => {
    await expectNoActiveMethods(pool);
    clock.advanceMinutes(5 * 24 * HOUR_MINUTES);
    provider.reset();
    shopper = new Shopper(running.baseUrl);
  });

  afterEach(async () => {
    await methods.cleanup();
  });

  afterAll(async () => {
    await running.app.close();
    await limited.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  describe("GET /store/shipping/options", () => {
    it("answers an empty list for an empty cart without creating one, no-store", async () => {
      await methods.create();
      const result = await shippingOptions(shopper, { country: "UA" });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ subtotal: { amount: 0, currency: "UAH" }, options: [] });
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.headers.getSetCookie()).toEqual([]);
    });

    it("answers an empty list for a cart that ships nothing", async () => {
      await methods.create();
      const digital = await catalog.simple({ digital: true, price: 1_000 });
      await add(digital.variantId);
      const result = await shippingOptions(shopper, { country: "UA" });
      expect(result.body).toEqual({ subtotal: { amount: 1_000, currency: "UAH" }, options: [] });
    });

    it("lists the active methods in the shop currency in order, priced by the server, with the reason of an unavailable one", async () => {
      const courier = await methods.create({
        position: 1,
        pricing: { type: "free_over", amount: 700, freeFrom: 5_000 },
        title: { uk: "Кур'єр", en: "Courier" },
      });
      const poland = await methods.create({ position: 2, countryCodes: ["PL"] });
      await methods.create({ position: 3, isActive: false });
      await methods.create({ position: 4, currency: "USD" });
      const made = await catalog.simple({ price: 2_000 });
      await add(made.variantId, 2);
      const result = await shippingOptions(shopper, { country: "UA", locale: "en" });
      expect(result.status).toBe(200);
      expect(result.body.subtotal).toEqual({ amount: 4_000, currency: "UAH" });
      expect(result.body.options.map((option) => option.methodCode)).toEqual([
        courier.code,
        poland.code,
      ]);
      expect(result.body.options[0]).toEqual({
        methodCode: courier.code,
        kind: "address",
        title: "Courier",
        description: null,
        providerCode: null,
        countryCodes: ["UA"],
        available: true,
        price: { amount: 700, currency: "UAH" },
        payer: "shop_charge",
        total: { amount: 4_700, currency: "UAH" },
        estimate: null,
      });
      expect(result.body.options[1]).toMatchObject({
        available: false,
        reason: "country_not_served",
        price: null,
        total: null,
      });
    });

    it("needs a country for an address method, and takes a pickup point's country from the point", async () => {
      const address = await methods.create({ kind: "address" });
      const branch = await methods.create({ kind: "pickup_point" });
      const made = await catalog.simple({ price: 2_000 });
      await add(made.variantId);
      const noCountry = await shippingOptions(shopper);
      expect(noCountry.body.options.map((option) => option.reason)).toEqual([
        "country_required",
        "country_required",
      ]);
      const withPoint = await shippingOptions(shopper, {
        pickupPointRef: "test-city-lviv-point-1",
      });
      expect(withPoint.body.options.find((o) => o.methodCode === branch.code)).toMatchObject({
        available: true,
        estimate: { amount: TEST_ESTIMATE_MINOR_UNITS, currency: "UAH" },
      });
      expect(withPoint.body.options.find((o) => o.methodCode === address.code)?.reason).toBe(
        "country_required",
      );
    });

    it("a pickup point method of a provider the shop does not run is provider_not_enabled", async () => {
      const method = await methods.create({ kind: "pickup_point", providerCode: "gone_provider" });
      const made = await catalog.simple({ price: 2_000 });
      await add(made.variantId);
      const result = await shippingOptions(shopper, { country: "UA" });
      expect(result.body.options.find((o) => o.methodCode === method.code)).toMatchObject({
        available: false,
        reason: "provider_not_enabled",
      });
    });

    it("an estimate failure is estimate null, never an error; estimates are cached 10 minutes per subtotal band", async () => {
      const method = await methods.create({ providerCode: "fake" });
      const made = await catalog.simple({ price: 2_000 });
      await add(made.variantId);
      provider.failLookup("estimate", { reason: "unavailable" });
      const failed = await shippingOptions(shopper, { country: "UA", cityRef: "test-city-kyiv" });
      expect(failed.status).toBe(200);
      expect(failed.body.options[0]).toMatchObject({ available: true, estimate: null });

      const first = await shippingOptions(shopper, { country: "UA", cityRef: "test-city-kyiv" });
      expect(first.body.options[0]?.estimate).toEqual({
        amount: TEST_ESTIMATE_MINOR_UNITS,
        currency: "UAH",
      });
      const calls = provider.calls.estimate;
      provider.estimateAmount = 1;
      await shippingOptions(shopper, { country: "UA", cityRef: "test-city-kyiv" });
      expect(provider.calls.estimate).toBe(calls);
      clock.advanceMinutes(10);
      const later = await shippingOptions(shopper, { country: "UA", cityRef: "test-city-kyiv" });
      expect(later.body.options[0]?.estimate?.amount).toBe(1);
      // A hanging carrier: still 200 with estimate null after the 5 s limit.
      provider.failLookup("estimate", { hang: true });
      clock.advanceMinutes(10);
      const hanging = await shippingOptions(shopper, {
        country: "UA",
        cityRef: "test-city-kyiv",
      });
      expect(hanging.status).toBe(200);
      expect(hanging.body.options[0]).toMatchObject({ methodCode: method.code, estimate: null });
    }, 15_000);

    it("refuses unknown and malformed query parameters", async () => {
      expect((await shippingOptions(shopper, { country: "ua" })).status).toBe(400);
      expect((await shippingOptions(shopper, { pickupPointRef: "has space" })).status).toBe(400);
      expect((await shippingOptions(shopper, { cartId: "x" })).status).toBe(400);
    });

    it("is rate limited per address (shippingOptions)", async () => {
      const guest = new Shopper(limited.baseUrl);
      expect((await shippingOptions(guest)).status).toBe(200);
      expect((await shippingOptions(guest)).status).toBe(200);
      const third = await shippingOptions(guest);
      expect(third.status).toBe(429);
      expect(third.headers.get("retry-after")).not.toBeNull();
    });
  });

  describe("GET /store/shipping/providers/{code}/cities and /pickup-points", () => {
    it("searches cities through the cache: public, max-age 300, paged", async () => {
      const result = await cities("q=%D0%9A%D0%B8%D1%97&limit=1");
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("public, max-age=300");
      expect(result.body).toEqual({
        items: [{ ref: "test-city-kyiv", name: "Київ", region: "Київська" }],
        total: 1,
        limit: 1,
        offset: 0,
        stale: false,
      });
      // Normalized query (case, spaces): the second search is a cache hit.
      await cities("q=%20%D0%BA%D0%B8%D1%97%20");
      expect(provider.calls.searchCities).toBe(1);
    });

    it("lists the points of a city, filtered by kind and text, fetched once per city", async () => {
      const all = await points("cityRef=test-city-kyiv");
      expect(all.status).toBe(200);
      expect(all.body.items.map((point) => [point.ref, point.kind, point.countryCode])).toEqual([
        ["test-city-kyiv-point-1", "branch", "UA"],
        ["test-city-kyiv-point-2", "locker", "UA"],
      ]);
      const lockers = await points("cityRef=test-city-kyiv&kinds=locker");
      expect(lockers.body.items.map((point) => point.ref)).toEqual(["test-city-kyiv-point-2"]);
      const text = await points("cityRef=test-city-kyiv&q=%E2%84%961");
      expect(text.body.items.map((point) => point.ref)).toEqual(["test-city-kyiv-point-1"]);
      const paged = await points("cityRef=test-city-kyiv&limit=1&offset=1");
      expect(paged.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
      expect(provider.calls.listPickupPoints).toBe(1);
    });

    it("serves stale data marked stale when the carrier is down, up to 72 h past expiry, then 503 with Retry-After (no-store)", async () => {
      expect((await points("cityRef=test-city-lviv")).body.stale).toBe(false);
      provider.failLookup("listPickupPoints", { times: 100 });
      clock.advanceMinutes(12 * HOUR_MINUTES + 72 * HOUR_MINUTES - 1);
      const stale = await points("cityRef=test-city-lviv");
      expect(stale.status).toBe(200);
      expect(stale.body.stale).toBe(true);
      expect(stale.body.items).toHaveLength(1);
      clock.advanceMinutes(2);
      const gone = await points("cityRef=test-city-lviv");
      expect(gone.status).toBe(503);
      expect(gone.body.code).toBe("shipping_provider_unavailable");
      expect(gone.headers.get("retry-after")).toBe("30");
      expect(gone.headers.get("cache-control")).toBe("no-store");
    });

    it("coalesces concurrent lookups of one city into one provider call", async () => {
      const release = provider.hold("listPickupPoints");
      const pending = [1, 2, 3, 4, 5].map(() => points("cityRef=test-city-kyiv"));
      for (let attempt = 0; attempt < 50 && provider.calls.listPickupPoints === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();
      const results = await Promise.all(pending);
      expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200]);
      expect(provider.calls.listPickupPoints).toBe(1);
    });

    it("answers 404 for a provider the shop does not run and 400 for bad input", async () => {
      expect(
        (await new Shopper(running.baseUrl).get("/store/shipping/providers/nope/cities?q=ab"))
          .status,
      ).toBe(404);
      expect(
        (await new Shopper(running.baseUrl).get("/store/shipping/providers/Bad-Code/cities?q=ab"))
          .status,
      ).toBe(400);
      const short = await cities("q=%D0%9A");
      expect(short.status).toBe(400);
      expect(short.body.errors).toEqual([
        expect.objectContaining({ path: "q", code: "too_short" }),
      ]);
      expect((await cities(`q=${"a".repeat(51)}`)).status).toBe(400);
      expect((await cities("q=ab&limit=51")).status).toBe(400);
      expect((await points("cityRef=has%20space")).status).toBe(400);
      expect((await points("cityRef=x&kinds=courier")).status).toBe(400);
      expect((await points("cityRef=x&limit=201")).status).toBe(400);
      expect((await points("")).status).toBe(400);
    });

    it("never returns a provider's message or a key, and is limited per address (shippingLookup)", async () => {
      provider.failLookup("searchCities", { message: "apiKey=SECRET-KEY +380501234567" });
      const failed = await cities("q=zzz");
      expect(failed.status).toBe(503);
      expect(JSON.stringify(failed.body)).not.toContain("SECRET");
      const guest = new Shopper(limited.baseUrl);
      const path = "/store/shipping/providers/fake/cities?q=ab";
      expect((await guest.get(path)).status).toBe(200);
      expect((await guest.get(path)).status).toBe(200);
      expect((await guest.get(path)).status).toBe(429);
    });
  });
});
