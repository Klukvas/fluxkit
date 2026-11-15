import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { createListingFixture, type ListingFixture } from "../../test/listing-fixture.js";
import { ensureMigrated } from "../../test/migrate.js";
import { PG_POOL } from "../../database/database.module.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { StoreService } from "./store.service.js";
import type { Page } from "../../common/pagination.js";
import type { StoreProductListItem } from "./store.schemas.js";

describe("listing groups (real store API)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let app: RunningApp;
  let fx: ListingFixture;
  beforeAll(async () => {
    await ensureMigrated();
    app = await startApp();
    fx = await createListingFixture(pool);
  });
  afterAll(async () => {
    await fx?.cleanup();
    await app?.app.close();
    await pool.end();
  });
  it("prices each group independently, retaining zero prices, shop currency and sold-out groups", async () => {
    const result = await http<Page<StoreProductListItem>>(
      app.baseUrl,
      "GET",
      `/store/products?brand=${fx.brandSlug}&groupBy=listing`,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.total).toBe(4);
    const split = result.body.items.filter((item) => item.id === fx.splitProduct);
    expect(split.map((item) => item.price)).toEqual([
      { from: 3000, to: 4500, currency: "UAH" },
      { from: 0, to: 1200, currency: "UAH" },
    ]);
    expect(split.map((item) => item.availability)).toEqual(["out_of_stock", "in_stock"]);
    expect(split.map((item) => item.defaultVariantId)).toEqual([null, null]);
  });
  async function page(query = "") {
    const result = await http<Page<StoreProductListItem>>(
      app.baseUrl,
      "GET",
      `/store/products?brand=${fx.brandSlug}${query}`,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  }

  it("preserves product mode exactly apart from its two additive summary fields", async () => {
    const implicit = await page();
    expect(await page("&groupBy=product")).toEqual(implicit);
    expect(implicit.total).toBe(3);
    const item = implicit.items.find((item) => item.id === fx.splitProduct);
    expect(item).toMatchObject({
      listingKey: fx.splitProduct,
      listingOption: null,
      defaultVariantId: null,
      price: { from: 0, to: 4500, currency: "UAH" },
      image: { url: "https://img.test/general.jpg" },
    });
    const listing = await page("&groupBy=listing");
    for (const id of [fx.plainProduct, fx.noAxisProduct]) {
      expect(listing.items.find((item) => item.id === id)).toEqual(
        implicit.items.find((item) => item.id === id),
      );
    }
  });

  it("counts and pages groups without duplicates or omissions, with SQL byte-order tie breakers", async () => {
    const all = await page("&groupBy=listing");
    const expected = [fx.splitProduct, fx.plainProduct, fx.noAxisProduct]
      .sort()
      .reverse()
      .flatMap((id) =>
        id === fx.splitProduct ? [`${id}:${fx.colorCode}:blue`, `${id}:${fx.colorCode}:red`] : [id],
      );
    expect(all.items.map((item) => item.listingKey)).toEqual(expected);
    const paged = await Promise.all(
      [0, 1, 2, 3].map((offset) => page(`&groupBy=listing&limit=1&offset=${offset}`)),
    );
    expect(paged.flatMap((part) => part.items.map((item) => item.listingKey))).toEqual(expected);
    expect(paged.map((part) => part.total)).toEqual([4, 4, 4, 4]);
    expect((await page("&groupBy=listing&offset=4")).items).toEqual([]);
    const category = await http<Page<StoreProductListItem>>(
      app.baseUrl,
      "GET",
      `/store/products?category=${fx.brandSlug}&groupBy=listing`,
    );
    expect(category.body).toEqual(all);
  });

  it("resolves option labels per field and picks a value image, then general image, then placeholder", async () => {
    const result = await page("&groupBy=listing&locale=en");
    const split = result.items.filter((item) => item.id === fx.splitProduct);
    expect(split.map((item) => item.listingOption)).toEqual([
      { optionCode: fx.colorCode, valueCode: "blue", optionName: "Color", valueName: "Синій" },
      { optionCode: fx.colorCode, valueCode: "red", optionName: "Color", valueName: "Red" },
    ]);
    expect(split.map((item) => item.image?.url)).toEqual([
      "https://img.test/general.jpg",
      "https://img.test/red.jpg",
    ]);
    await pool.query("delete from media where product_id = $1 and option_value_id is null", [
      fx.splitProduct,
    ]);
    expect(
      (await page("&groupBy=listing")).items.find(
        (item) => item.listingOption?.valueCode === "blue",
      )?.image,
    ).toBeNull();
  });

  it("uses current prices, activity and group membership for defaultVariantId and stale references", async () => {
    const redSmall = fx.variants.find(
      (variant) =>
        variant.productId === fx.splitProduct && variant.color === "red" && variant.size === "s",
    );
    const redMedium = fx.variants.find(
      (variant) =>
        variant.productId === fx.splitProduct && variant.color === "red" && variant.size === "m",
    );
    await pool.query("update variant set is_active = false where id = $1", [redMedium?.id]);
    await pool.query("update price set amount = 700 where variant_id = $1 and currency = 'UAH'", [
      redSmall?.id,
    ]);
    const red = (await page("&groupBy=listing")).items.find(
      (item) => item.listingOption?.valueCode === "red",
    );
    expect(red).toMatchObject({ defaultVariantId: redSmall?.id, price: { from: 700, to: 700 } });
    await pool.query("delete from price where variant_id = $1 and currency = 'UAH'", [
      redSmall?.id,
    ]);
    expect((await page("&groupBy=listing")).total).toBe(3);
    const hydrated = await app.app.get(StoreService).listItemsByListingReferences(
      [
        { productId: fx.splitProduct, listingKey: `${fx.splitProduct}:${fx.colorCode}:red` },
        { productId: fx.splitProduct, listingKey: `${fx.splitProduct}:${fx.colorCode}:blue` },
      ],
      "uk",
    );
    expect(hydrated.items.map((item) => item.listingOption?.valueCode)).toEqual(["blue"]);
    expect(hydrated.missing).toEqual([fx.splitProduct]);
    await pool.query("update variant set is_active = true where id = $1", [redMedium?.id]);
    await pool.query("insert into price (variant_id, currency, amount) values ($1, 'UAH', 0)", [
      redSmall?.id,
    ]);
  });

  it("keeps a fixed batched statement budget as products and groups increase", async () => {
    async function statements(limit: number) {
      const spy = vi.spyOn(app.app.get<pg.Pool>(PG_POOL), "query");
      try {
        await page(`&groupBy=listing&limit=${limit}`);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }
    expect(await statements(1)).toBe(6);
    expect(await statements(100)).toBe(6);
    const queues = await pool.query(
      "select * from search_sync_queue where product_id = any($1::uuid[])",
      [[fx.splitProduct, fx.plainProduct, fx.noAxisProduct]],
    );
    expect(queues.rows).toEqual([]);
  });

  it("excludes invalid money at the database boundary before it can enter a listing range", async () => {
    const variantId = fx.variants[0]?.id;
    for (const amount of [-1, "1.5"]) {
      await expect(
        pool.query("update price set amount = $2 where variant_id = $1 and currency = 'UAH'", [
          variantId,
          amount,
        ]),
      ).rejects.toThrow();
    }
    expect(
      (await page("&groupBy=listing")).items.find(
        (item) => item.id === fx.splitProduct && item.listingOption?.valueCode === "red",
      )?.price,
    ).toEqual({ from: 0, to: 1200, currency: "UAH" });
  });

  it("rejects unknown grouping values with invalid_value", async () => {
    for (const value of ["unknown", "", "LISTING"]) {
      const result = await http<ProblemBody>(
        app.baseUrl,
        "GET",
        `/store/products?groupBy=${value}`,
      );
      expect(result.status).toBe(400);
      expect(result.body.errors).toContainEqual(
        expect.objectContaining({ path: "groupBy", code: "invalid_value" }),
      );
    }
  });
});
