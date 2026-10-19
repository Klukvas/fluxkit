import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { PG_POOL } from "../../../database/database.module.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import {
  caller,
  createCatalogFixture,
  type Call,
  type CatalogFixture,
} from "../../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import type { ProductDetailResponse } from "../products/products.schemas.js";
import type { PriceListResponse, PriceResponse } from "./prices.schemas.js";
import { defined } from "../../../test/defined.js";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("GET /admin/products/:id/prices (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let viewer: RunningApp;
  let anonymous: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let counter = 0;

  async function createProduct(): Promise<ProductDetailResponse> {
    counter += 1;
    const result = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: fx.teeTypeId,
      title: { uk: `Ціни ${fx.runId} ${counter}` },
      attributes: { [fx.materialAttributeCode]: "cotton" },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  async function withOptions(options: { optionId: string; valueIds: string[] }[]) {
    const product = await createProduct();
    const put = await call<ProductDetailResponse>("PUT", `/admin/products/${product.id}/options`, {
      options,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    return put.body;
  }

  const withVariants = (valueIds: string[]) => withOptions([{ optionId: fx.color.id, valueIds }]);

  const read = (productId: string) =>
    call<PriceListResponse>("GET", `/admin/products/${productId}/prices`);

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    viewer = await startApp({ adminPrincipal: { role: "viewer" } });
    anonymous = await startApp({ adminAuthenticator: "production-default" });
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
  });

  afterAll(async () => {
    for (const started of [running, viewer, anonymous]) {
      await started.app.close();
    }
    await fx.cleanup(pool);
    await pool.end();
  });

  it("lists every price of every variant in every currency, in variant then currency order", async () => {
    const product = await withVariants([
      defined(fx.color.values["red"]),
      defined(fx.color.values["blue"]),
    ]);
    const [first, second] = product.variants;
    expect(first && second).toBeTruthy();
    const put = await call("PUT", `/admin/products/${product.id}/prices`, {
      items: [
        { variantId: defined(second).id, currency: "USD", amount: 2500 },
        { variantId: defined(first).id, currency: "USD", amount: 1100, compareAtAmount: 1500 },
        { variantId: defined(first).id, currency: "UAH", amount: 40000 },
        { variantId: defined(second).id, currency: "UAH", amount: 99900, compareAtAmount: 120000 },
      ],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const result = await read(product.id);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body)).toEqual(["items"]);
    expect(result.body.items.map((item) => [item.variantId, item.currency, item.amount])).toEqual([
      [defined(first).id, "UAH", 40000],
      [defined(first).id, "USD", 1100],
      [defined(second).id, "UAH", 99900],
      [defined(second).id, "USD", 2500],
    ]);
    expect(result.body.items[1]).toMatchObject({ compareAtAmount: 1500 });
    expect(result.body.items[0]).toMatchObject({ compareAtAmount: null });
  });

  it("gives each item exactly the shape of the per-variant read", async () => {
    const product = await withVariants([
      defined(fx.color.values["red"]),
      defined(fx.color.values["green"]),
    ]);
    for (const variant of product.variants) {
      await call("PUT", `/admin/products/${product.id}/variants/${variant.id}/prices/UAH`, {
        amount: 1000 + variant.position,
        compareAtAmount: 5000,
      });
    }
    const all = (await read(product.id)).body.items;
    for (const variant of product.variants) {
      const own = await call<PriceListResponse>(
        "GET",
        `/admin/products/${product.id}/variants/${variant.id}/prices`,
      );
      expect(all.filter((item) => item.variantId === variant.id)).toEqual(own.body.items);
    }
    const sample: PriceResponse | undefined = all[0];
    expect(Object.keys(sample ?? {}).sort()).toEqual(
      ["amount", "compareAtAmount", "createdAt", "currency", "id", "updatedAt", "variantId"].sort(),
    );
  });

  it("is empty for a product whose variants have no price, and lists only this product's prices", async () => {
    const empty = await withVariants([defined(fx.color.values["red"])]);
    expect((await read(empty.id)).body).toEqual({ items: [] });
    const other = await withVariants([defined(fx.color.values["red"])]);
    await call(
      "PUT",
      `/admin/products/${other.id}/variants/${defined(other.variants[0]).id}/prices/UAH`,
      {
        amount: 7,
      },
    );
    expect((await read(empty.id)).body).toEqual({ items: [] });
    expect((await read(other.id)).body.items).toHaveLength(1);
  });

  it("answers 404 for an unknown product and 400 for a malformed id", async () => {
    const missing = await call<ProblemBody>("GET", `/admin/products/${MISSING_ID}/prices`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "not_found" });
    expect((await call("GET", "/admin/products/xyz/prices")).status).toBe(400);
  });

  it("needs catalog.read: a viewer may read, nobody anonymous may", async () => {
    const product = await withVariants([defined(fx.color.values["red"])]);
    expect((await http(viewer.baseUrl, "GET", `/admin/products/${product.id}/prices`)).status).toBe(
      200,
    );
    expect(
      (await http(anonymous.baseUrl, "GET", `/admin/products/${product.id}/prices`)).status,
    ).toBe(401);
  });

  it("issues the same number of statements for 2 and for 200+ variants", async () => {
    const small = await withVariants([
      defined(fx.color.values["red"]),
      defined(fx.color.values["blue"]),
    ]);
    await call("PUT", `/admin/products/${small.id}/prices`, {
      items: small.variants.map((variant) => ({
        variantId: variant.id,
        currency: "UAH",
        amount: 100,
      })),
    });
    const large = await withOptions([
      { optionId: fx.biga.id, valueIds: Object.values(fx.biga.values) },
      { optionId: fx.bigb.id, valueIds: Object.values(fx.bigb.values).slice(0, 8) },
    ]);
    expect(large.variants.length).toBeGreaterThan(100);

    async function statements(productId: string): Promise<number> {
      const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
      const spy = vi.spyOn(poolOfApp, "query");
      try {
        const result = await read(productId);
        expect(result.status).toBe(200);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }

    // Price every variant of the large product through the bulk route, in two currencies (500 items at most).
    for (let from = 0; from < large.variants.length; from += 250) {
      const slice = large.variants.slice(from, from + 250);
      const put = await call("PUT", `/admin/products/${large.id}/prices`, {
        items: slice.flatMap((variant) => [
          { variantId: variant.id, currency: "UAH", amount: 100 },
          { variantId: variant.id, currency: "USD", amount: 10 },
        ]),
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
    }
    const listed = await read(large.id);
    expect(listed.body.items).toHaveLength(large.variants.length * 2);
    expect(await statements(large.id)).toBe(await statements(small.id));
    expect(await statements(small.id)).toBe(2);
  });
});
