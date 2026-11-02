import {
  buildSearchFilter,
  buildSearchFilterDocuments,
  matchesSearchSelection,
  type SearchSelection,
} from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PRICING_CONFIG } from "../../common/pricing-config.js";
import type { Database } from "../../database/database.module.js";
import { DRIZZLE } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  caller,
  createCatalogFixture,
  type Call,
  type CatalogFixture,
} from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { insertAdminUserRow, ownerAuthenticator } from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { meiliUrl } from "../../test/search-engine.js";
import { SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { StockWorld } from "../../test/stock-world.js";
import {
  buildContextFor,
  readSearchDefinitions,
  readSearchProducts,
  SearchIndexer,
} from "../indexer/index.js";

interface Match {
  variantId: string;
  variantCount: number;
  price: { from: number; to: number; currency: string };
  availability: string;
  optionValues: { optionCode: string; valueCode: string }[];
}
interface Item {
  id: string;
  slug: string;
  price: { from: number; to: number; currency: string };
  availability: string;
  match?: Match | null;
}
interface SearchBody {
  items: Item[];
  total: number;
}

/**
 * `match` of `GET /store/search` items (plan 2026-11-02-api-matched-variant-and-stock-hints): which sellable variants
 * fit the variant-level part of the selection, computed from Postgres with the same filter fields the engine indexes.
 * Real Postgres, the real Meilisearch with a scoped key, the index built by the real indexer.
 */
describe("store search: the matched variant of an item (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let search: SearchWorld;
  let app: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let world: StockWorld;
  let brandSlug: string;
  let adminId: string;
  let colorKey: string;
  let sizeKey: string;
  /** The colour x size product: variant ids by `<color>-<size>`. */
  let shirt: { id: string; slug: string; variants: Record<string, string> };
  let backorder: { productId: string; variantId: string };
  let digital: { productId: string; variantId: string };
  /** red priced in UAH, blue only in EUR (not sellable in the UAH shop). */
  let twoCurrencies: { id: string; red: string; blue: string };

  const get = (path: string) => http<SearchBody>(app.baseUrl, "GET", path);
  const itemOf = (body: SearchBody, id: string) => body.items.find((item) => item.id === id);
  const ours = (body: SearchBody) => body.items.map((item) => item.id);

  async function syncIndex(): Promise<void> {
    const indexer = app.app.get(SearchIndexer);
    await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
    for (let run = 0; run < 5; run++) {
      const result = await indexer.sync(new Date(), UNLIMITED_BUDGET);
      expect(result.failures).toEqual([]);
      if (result.scanned === 0) return;
    }
  }

  async function setStock(variantId: string, productId: string, onHand: number): Promise<void> {
    if (onHand > 0) {
      await world.receive({ productId, variantId }, onHand);
    }
  }

  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    search = await SearchWorld.create("match");
    adminId = await insertAdminUserRow(pool);
    app = await startApp({
      search: search.env,
      adminAuthenticator: ownerAuthenticator(adminId),
      rateLimits: {
        search: { maxAttempts: 10_000, windowMinutes: 1 },
        searchSuggest: { maxAttempts: 10_000, windowMinutes: 1 },
      },
    });
    call = caller(() => app.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    colorKey = `opt.${fx.color.code}`;
    sizeKey = `opt.${fx.size.code}`;

    const createdBrand = await call<{ id: string; slug: string }>("POST", "/admin/brands", {
      name: { uk: "Матч", en: "Match" },
      slug: `match-${fx.runId}`,
    });
    expect(createdBrand.status, JSON.stringify(createdBrand.body)).toBe(201);
    brandSlug = createdBrand.body.slug;
    const brandId = createdBrand.body.id;

    // red-s 599 stock 10 (in stock), red-l 629 stock 0 (out), blue-s 549 stock 0 (out), blue-l 599 stock 3 (low).
    const product = await world.createProduct();
    const patched = await call("PATCH", `/admin/products/${product.id}`, {
      title: { uk: "Сорочка матчова", en: "Match shirt" },
      brandId,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const options = await call("PUT", `/admin/products/${product.id}/options`, {
      options: [
        { optionId: fx.color.id, valueIds: [fx.color.values["red"], fx.color.values["blue"]] },
        { optionId: fx.size.id, valueIds: [fx.size.values["s"], fx.size.values["l"]] },
      ],
    });
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    const rows = await pool.query<{ id: string; option_id: string; code: string }>(
      `select v.id, vov.option_id, ov.code from variant v
       join variant_option_value vov on vov.variant_id = v.id
       join option_value ov on ov.id = vov.option_value_id
       where v.product_id = $1`,
      [product.id],
    );
    const variants: Record<string, string> = {};
    const byVariant = new Map<string, { color?: string; size?: string }>();
    for (const row of rows.rows) {
      const entry = byVariant.get(row.id) ?? {};
      if (row.option_id === fx.color.id) entry.color = row.code;
      if (row.option_id === fx.size.id) entry.size = row.code;
      byVariant.set(row.id, entry);
    }
    for (const [id, entry] of byVariant) {
      variants[`${entry.color ?? "?"}-${entry.size ?? "?"}`] = id;
    }
    const plan: Record<string, { price: number; stock: number }> = {
      "red-s": { price: 599, stock: 10 },
      "red-l": { price: 629, stock: 0 },
      "blue-s": { price: 549, stock: 0 },
      "blue-l": { price: 599, stock: 3 },
    };
    for (const [key, { price, stock }] of Object.entries(plan)) {
      const id = variants[key];
      if (id === undefined) throw new Error(`Test setup: no variant ${key}`);
      await pool.query("insert into price (variant_id, currency, amount) values ($1, 'UAH', $2)", [
        id,
        price,
      ]);
      await setStock(id, product.id, stock);
    }
    expect((await call("POST", `/admin/products/${product.id}/publish`)).status).toBe(200);
    shirt = { id: product.id, slug: product.slug, variants };

    // Backorder (stock 0, may be sold) and untracked (digital) single-variant products, same brand.
    backorder = await world.variant({ onHand: 0, allowBackorder: true });
    digital = await world.variant({ trackInventory: false });
    for (const id of [backorder.productId, digital.productId]) {
      expect((await call("PATCH", `/admin/products/${id}`, { brandId })).status).toBe(200);
    }

    // red priced in UAH, blue only in EUR.
    const multi = await world.createProduct();
    await call("PATCH", `/admin/products/${multi.id}`, { brandId });
    await call("PUT", `/admin/products/${multi.id}/options`, {
      options: [
        { optionId: fx.color.id, valueIds: [fx.color.values["red"], fx.color.values["blue"]] },
      ],
    });
    const multiRows = await pool.query<{ id: string; code: string }>(
      `select v.id, ov.code from variant v
       join variant_option_value vov on vov.variant_id = v.id
       join option_value ov on ov.id = vov.option_value_id
       where v.product_id = $1`,
      [multi.id],
    );
    const red = multiRows.rows.find((row) => row.code === "red")?.id ?? "";
    const blue = multiRows.rows.find((row) => row.code === "blue")?.id ?? "";
    await pool.query("insert into price (variant_id, currency, amount) values ($1, 'UAH', 500)", [
      red,
    ]);
    await pool.query("insert into price (variant_id, currency, amount) values ($1, 'UAH', 500)", [
      blue,
    ]);
    await world.receive({ productId: multi.id, variantId: red }, 10);
    await world.receive({ productId: multi.id, variantId: blue }, 10);
    expect((await call("POST", `/admin/products/${multi.id}/publish`)).status).toBe(200);
    // Publishing needs a shop price on every variant; afterwards blue loses it and keeps only EUR.
    await pool.query("delete from price where variant_id = $1", [blue]);
    await pool.query("insert into price (variant_id, currency, amount) values ($1, 'EUR', 20)", [
      blue,
    ]);
    twoCurrencies = { id: multi.id, red, blue };

    await syncIndex();
  }, 180_000);

  afterAll(async () => {
    await fx.cleanup(pool);
    await pool.query("delete from brand where slug = $1", [brandSlug]);
    await search.dispose(pool);
    await app.app.close();
    // An owner left behind would change the last-owner rule for later spec files of the shared database.
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  const v = (key: string): string => {
    const id = shirt.variants[key];
    if (id === undefined) throw new Error(`no variant ${key}`);
    return id;
  };
  const pairs = (color: string, size: string) => [
    { optionCode: fx.color.code, valueCode: color },
    { optionCode: fx.size.code, valueCode: size },
  ];

  it("names the one matching variant: red L is out of stock at 629 while the product is 'from 549, in stock'", async () => {
    const result = await get(`/store/search?f=${colorKey}:red&f=${sizeKey}:l&locale=uk`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const item = itemOf(result.body, shirt.id);
    expect(item?.price).toEqual({ from: 549, to: 629, currency: "UAH" });
    expect(item?.availability).toBe("in_stock");
    expect(item?.match).toEqual({
      variantId: v("red-l"),
      variantCount: 1,
      price: { from: 629, to: 629, currency: "UAH" },
      availability: "out_of_stock",
      optionValues: pairs("red", "l"),
    });
  });

  it("summarizes several matching variants and picks the in-stock one over a cheaper sold-out one", async () => {
    const red = itemOf((await get(`/store/search?f=${colorKey}:red`)).body, shirt.id);
    expect(red?.match).toEqual({
      variantId: v("red-s"),
      variantCount: 2,
      price: { from: 599, to: 629, currency: "UAH" },
      availability: "in_stock",
      optionValues: pairs("red", "s"),
    });
    // size S: blue-s 549 is sold out, red-s 599 in stock: the representative is red-s, the range still starts at 549.
    const small = itemOf((await get(`/store/search?f=${sizeKey}:s`)).body, shirt.id);
    expect(small?.match).toMatchObject({
      variantId: v("red-s"),
      variantCount: 2,
      price: { from: 549, to: 599 },
      availability: "in_stock",
    });
    // Values of one key are OR: red or blue, size L.
    const either = itemOf(
      (await get(`/store/search?f=${colorKey}:red&f=${colorKey}:blue&f=${sizeKey}:l`)).body,
      shirt.id,
    );
    expect(either?.match).toMatchObject({
      variantId: v("blue-l"),
      variantCount: 2,
      availability: "low_stock",
    });
  });

  it("follows the availability filter: inStock false lists the sold-out variants, inStock true the others", async () => {
    const soldOut = itemOf((await get(`/store/search?f=inStock:false`)).body, shirt.id);
    expect(soldOut?.match).toEqual({
      variantId: v("blue-s"),
      variantCount: 2,
      price: { from: 549, to: 629, currency: "UAH" },
      availability: "out_of_stock",
      optionValues: pairs("blue", "s"),
    });
    const available = itemOf((await get(`/store/search?f=inStock:true`)).body, shirt.id);
    expect(available?.match).toMatchObject({
      variantId: v("red-s"),
      variantCount: 2,
      price: { from: 599, to: 599 },
      availability: "in_stock",
    });
    const lowOnly = itemOf(
      (await get(`/store/search?f=inStock:true&f=${sizeKey}:l`)).body,
      shirt.id,
    );
    expect(lowOnly?.match).toMatchObject({ variantId: v("blue-l"), availability: "low_stock" });
  });

  it("counts backorder and untracked (digital) variants as in stock", async () => {
    const result = await get(`/store/search?f=inStock:true&f=brand:${brandSlug}`);
    for (const target of [backorder, digital]) {
      expect(itemOf(result.body, target.productId)?.match).toMatchObject({
        variantId: target.variantId,
        variantCount: 1,
        availability: "in_stock",
        optionValues: [],
      });
    }
    const soldOut = await get(`/store/search?f=inStock:false&f=brand:${brandSlug}`);
    expect(ours(soldOut.body)).not.toContain(backorder.productId);
    expect(ours(soldOut.body)).not.toContain(digital.productId);
  });

  it("applies the price range to the variants", async () => {
    const cheap = itemOf((await get(`/store/search?price=..560`)).body, shirt.id);
    expect(cheap?.match).toMatchObject({
      variantId: v("blue-s"),
      variantCount: 1,
      price: { from: 549, to: 549 },
    });
  });

  it("lists nothing for a selection no variant fits", async () => {
    const result = await get(`/store/search?f=${colorKey}:red&price=..500&f=brand:${brandSlug}`);
    expect(result.status).toBe(200);
    expect(ours(result.body)).not.toContain(shirt.id);
  });

  it("leaves `match` out without a variant-level selection (words, browsing, brand)", async () => {
    for (const path of [
      `/store/search?q=${encodeURIComponent("матчова")}`,
      `/store/search?f=brand:${brandSlug}`,
      `/store/search`,
    ]) {
      const result = await get(path);
      expect(result.status).toBe(200);
      expect(result.body.items.length).toBeGreaterThan(0);
      for (const item of result.body.items) {
        expect(Object.keys(item), path).not.toContain("match");
      }
    }
  });

  it("gives the same match in both locales (codes, not labels)", async () => {
    const path = `/store/search?f=${colorKey}:red&f=${sizeKey}:l`;
    const uk = itemOf((await get(`${path}&locale=uk`)).body, shirt.id)?.match;
    const en = itemOf((await get(`${path}&locale=en`)).body, shirt.id)?.match;
    expect(uk).toBeDefined();
    expect(en).toEqual(uk);
  });

  it("never matches a variant without a price in the shop currency", async () => {
    const blue = await get(`/store/search?f=${colorKey}:blue&f=brand:${brandSlug}`);
    expect(ours(blue.body)).not.toContain(twoCurrencies.id);
    const both = await get(
      `/store/search?f=${colorKey}:red&f=${colorKey}:blue&f=brand:${brandSlug}`,
    );
    expect(itemOf(both.body, twoCurrencies.id)?.match).toMatchObject({
      variantId: twoCurrencies.red,
      variantCount: 1,
      price: { from: 500, to: 500, currency: "UAH" },
    });
  });

  it("holds public data only: exactly the documented keys, no SKU, no quantity", async () => {
    const result = await get(`/store/search?f=${colorKey}:red`);
    const match = itemOf(result.body, shirt.id)?.match;
    expect(Object.keys(match ?? {}).sort()).toEqual(
      ["availability", "optionValues", "price", "variantCount", "variantId"].sort(),
    );
    const skus = await pool.query<{ sku: string }>(
      "select sku from variant where product_id = $1",
      [shirt.id],
    );
    const text = JSON.stringify(result.body);
    for (const row of skus.rows) {
      expect(text).not.toContain(row.sku);
    }
  });

  it("answers `match: null` and queues the product when the index is behind Postgres", async () => {
    // A direct write (no queue mark): the engine still has red-s at 599 under 600, Postgres says 900.
    await pool.query("update price set amount = 900 where variant_id = $1 and currency = 'UAH'", [
      v("red-s"),
    ]);
    await pool.query("delete from search_sync_queue where product_id = $1", [shirt.id]);
    try {
      const result = await get(`/store/search?f=${colorKey}:red&price=..600`);
      expect(result.status).toBe(200);
      const item = itemOf(result.body, shirt.id);
      expect(item).toBeDefined();
      expect(item?.match).toBeNull();
      const queued = await pool.query<{ reason: string }>(
        "select reason from search_sync_queue where product_id = $1",
        [shirt.id],
      );
      expect(queued.rows.map((row) => row.reason)).toEqual(["stale_hit"]);
    } finally {
      await pool.query("update price set amount = 599 where variant_id = $1 and currency = 'UAH'", [
        v("red-s"),
      ]);
      await syncIndex();
    }
  });

  it("matches exactly the variant documents the engine filters (parity of the two implementations)", async () => {
    const selections: SearchSelection[] = [
      { options: { [fx.color.code]: ["red"] } },
      { options: { [fx.color.code]: ["red"], [fx.size.code]: ["l"] } },
      { options: { [fx.size.code]: ["s", "l"] }, inStock: true },
      { inStock: false },
      { inStock: true },
      { price: { min: 550, max: 600 } },
      { price: { max: 549 } },
      { options: { [fx.color.code]: ["blue"] }, inStock: false, price: { min: 1 } },
      { brands: [brandSlug], inStock: true },
    ];
    const productIds = [shirt.id, backorder.productId, digital.productId, twoCurrencies.id];
    const database = app.app.get<Database>(DRIZZLE);
    const definitions = await readSearchDefinitions(database);
    const records = await readSearchProducts(database, productIds, definitions, {
      shopCurrency: DEFAULT_PRICING_CONFIG.shopCurrency,
      lowStockThreshold: DEFAULT_PRICING_CONFIG.lowStockThreshold,
    });
    const documents = records.flatMap((record) =>
      buildSearchFilterDocuments(
        record.facts,
        buildContextFor(definitions, record.productTypeId, "uk", "uk"),
      ),
    );
    let nonEmpty = 0;
    for (const selection of selections) {
      const filter = buildSearchFilter(selection);
      const scoped = `productId IN [${productIds.map((id) => `"${id}"`).join(", ")}]`;
      const response = await fetch(`${meiliUrl()}/indexes/${search.liveUid("uk")}/search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${search.key}`,
        },
        body: JSON.stringify({
          q: "",
          filter: filter === null ? scoped : `${scoped} AND ${filter}`,
          limit: 1000,
          attributesToRetrieve: ["id"],
        }),
      });
      expect(response.status).toBe(200);
      const answer = (await response.json()) as { hits: { id: string }[] };
      const engine = answer.hits.map((hit) => hit.id).sort();
      const matcher = documents
        .filter((document) => matchesSearchSelection(document, selection))
        .map((document) => document.id)
        .sort();
      expect(matcher, JSON.stringify(selection)).toEqual(engine);
      nonEmpty += engine.length > 0 ? 1 : 0;
    }
    // The comparison is not vacuous: most selections find variants.
    expect(nonEmpty).toBeGreaterThanOrEqual(selections.length - 1);
  });

  it("gives the SQL listing and search the same items for the same plain list (fallback parity)", async () => {
    const listing = await http<{ items: Item[] }>(
      app.baseUrl,
      "GET",
      `/store/products?brand=${brandSlug}&locale=en`,
    );
    const searched = await get(`/store/search?f=brand:${brandSlug}&sort=newest&locale=en`);
    expect(listing.status).toBe(200);
    expect(searched.status).toBe(200);
    expect(searched.body.items).toEqual(listing.body.items);
    for (const item of [...listing.body.items, ...searched.body.items]) {
      expect(Object.keys(item)).not.toContain("match");
    }
  });
});
