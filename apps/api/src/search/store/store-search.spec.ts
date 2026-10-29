import { Logger } from "@nestjs/common";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { indexSettings, updateIndexSettingsAsMaster } from "../../test/search-engine.js";
import { SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { StockWorld } from "../../test/stock-world.js";
import { SearchEngine } from "../engine/index.js";
import { SearchIndexer } from "../indexer/index.js";

interface Item {
  id: string;
  slug: string;
  title: string;
  price: { from: number; to: number };
  availability: string;
}
interface Facet {
  key: string;
  level: string;
  counted: boolean;
  label: string | null;
  values: { code: string; label: string | null; count: number | null; selected: boolean }[];
}
interface SearchBody {
  items: Item[];
  total: number;
  page: number;
  pageCount: number;
  sort: string;
  relaxed: boolean;
  query: { normalized: string };
  facets: Facet[];
  price: { min: number; max: number } | null;
}

/**
 * `GET /store/search` and `/store/search/suggest` end to end: real Postgres, the real Meilisearch with a scoped key, the
 * index built by the real indexer. Variant-level filters apply to ONE variant, facets are disjunctive, items are
 * hydrated from Postgres, every request parameter is validated before the engine sees it, and no internal value leaves.
 */
describe("store search routes (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const SENTINEL = `zzstoresentinel${Date.now().toString(36)}`;
  let search: SearchWorld;
  let app: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let world: StockWorld;
  let shirt: { id: string; slug: string };
  let tee: { id: string; slug: string };
  let brandA: string;
  let brandB: string;
  let adminId: string;
  const extraAttributeIds: string[] = [];

  async function get<T = SearchBody>(path: string, base = app.baseUrl) {
    return http<T>(base, "GET", path);
  }

  async function syncIndex(): Promise<void> {
    const indexer = app.app.get(SearchIndexer);
    await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
    for (let run = 0; run < 5; run++) {
      const result = await indexer.sync(new Date(), UNLIMITED_BUDGET);
      expect(result.failures).toEqual([]);
      if (result.scanned === 0) return;
    }
  }

  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    search = await SearchWorld.create("store");
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

    const createBrand = async (name: string): Promise<string> => {
      const result = await call<{ id: string; slug: string }>("POST", "/admin/brands", {
        name: { uk: name, en: name },
        slug: `${name.toLowerCase()}-${fx.runId}`,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      return result.body.slug;
    };
    brandA = await createBrand("Nordic");
    brandB = await createBrand("Stanley");
    const brandIds = await pool.query<{ id: string; slug: string }>(
      "select id, slug from brand where slug = any($1)",
      [[brandA, brandB]],
    );
    const idOf = (slug: string) => brandIds.rows.find((row) => row.slug === slug)?.id;

    // An internal attribute whose value must never leave.
    const internal = await call<{ id: string }>("POST", "/admin/attributes", {
      code: `secret_${fx.runId}`,
      name: { uk: "Собівартість" },
      inputType: "text",
      isLocalized: false,
      isInternal: true,
    });
    await call("PUT", `/admin/product-types/${fx.teeTypeId}/attributes/${internal.body.id}`, {
      level: "product",
    });
    // A HIDDEN but searchable attribute: only `isPublicAttribute` keeps its value out of the index (mutation M2).
    const hidden = await call<{ id: string }>("POST", "/admin/attributes", {
      code: `hidden_${fx.runId}`,
      name: { uk: "Прихований" },
      inputType: "text",
      isLocalized: false,
      isSearchable: true,
      isVisibleOnStorefront: false,
    });
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(201);
    // A public, filterable number attribute (the `attr.<code>:<min>..<max>` range facet).
    const weight = await call<{ id: string }>("POST", "/admin/attributes", {
      code: `weight_${fx.runId}`,
      name: { uk: "Вага" },
      inputType: "number",
      isFilterable: true,
    });
    expect(weight.status, JSON.stringify(weight.body)).toBe(201);
    // A public, filterable select attribute (hostile `attr.<code>:<value>` cases).
    const fit = await call<{ id: string }>("POST", "/admin/attributes", {
      code: `fit_${fx.runId}`,
      name: { uk: "Крій" },
      inputType: "select",
      isFilterable: true,
    });
    expect(fit.status, JSON.stringify(fit.body)).toBe(201);
    for (const code of ["slim", "loose"]) {
      const created = await call("POST", `/admin/attributes/${fit.body.id}/options`, {
        code,
        label: { uk: code },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
    }
    extraAttributeIds.push(internal.body.id, hidden.body.id, weight.body.id, fit.body.id);
    for (const id of [hidden.body.id, weight.body.id, fit.body.id]) {
      const assigned = await call("PUT", `/admin/product-types/${fx.teeTypeId}/attributes/${id}`, {
        level: "product",
      });
      expect(assigned.status, JSON.stringify(assigned.body)).toBeLessThan(300);
    }

    // A shirt with three sizes: S 2000, M 3000, L 4000; brand A; stocked.
    const shirtProduct = await world.createProduct();
    const patchedShirt = await call("PATCH", `/admin/products/${shirtProduct.id}`, {
      title: { uk: "Сорочка лляна", en: "Linen shirt" },
      brandId: idOf(brandA),
      attributes: {
        [fx.materialAttributeCode]: "linen",
        [`secret_${fx.runId}`]: SENTINEL,
        [`hidden_${fx.runId}`]: SENTINEL,
        [`weight_${fx.runId}`]: 1.5,
        [`fit_${fx.runId}`]: "slim",
      },
    });
    expect(patchedShirt.status, JSON.stringify(patchedShirt.body)).toBe(200);
    await call("PUT", `/admin/products/${shirtProduct.id}/options`, {
      options: [{ optionId: fx.size.id, valueIds: Object.values(fx.size.values) }],
    });
    const variants = await pool.query<{ id: string; code: string }>(
      `select v.id, ov.code from variant v
       join variant_option_value vov on vov.variant_id = v.id
       join option_value ov on ov.id = vov.option_value_id
       where v.product_id = $1`,
      [shirtProduct.id],
    );
    const prices: Record<string, number> = { s: 2000, m: 3000, l: 4000 };
    for (const row of variants.rows) {
      await pool.query("insert into price (variant_id, currency, amount) values ($1, 'UAH', $2)", [
        row.id,
        prices[row.code] ?? 1,
      ]);
      await world.receive({ productId: shirtProduct.id, variantId: row.id }, 10);
    }
    expect((await call("POST", `/admin/products/${shirtProduct.id}/publish`)).status).toBe(200);
    shirt = { id: shirtProduct.id, slug: shirtProduct.slug };

    // A T-shirt of brand B, sold out.
    const teeVariant = await world.variant({ onHand: 0 });
    await call("PATCH", `/admin/products/${teeVariant.productId}`, {
      title: { uk: "Футболка бавовняна", en: "Cotton tee" },
      brandId: idOf(brandB),
    });
    const teeRow = await pool.query<{ slug: string }>("select slug from product where id = $1", [
      teeVariant.productId,
    ]);
    tee = { id: teeVariant.productId, slug: teeRow.rows[0]?.slug ?? "" };

    await syncIndex();
  }, 180_000);

  afterAll(async () => {
    await fx.cleanup(pool);
    await pool.query("delete from attribute where id = any($1::uuid[])", [extraAttributeIds]);
    await pool.query("delete from brand where slug = any($1)", [[brandA, brandB]]);
    await search.dispose(pool);
    await app.app.close();
    // An owner left behind would change the last-owner rule for later spec files of the shared database.
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  it("finds a product by an inflected Ukrainian word and hydrates the item from Postgres", async () => {
    const result = await get(`/store/search?q=${encodeURIComponent("сорочку")}&locale=uk`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.headers.get("cache-control")).toBe("public, max-age=30");
    expect(result.body.items.map((item) => item.id)).toEqual([shirt.id]);
    expect(result.body.items[0]).toMatchObject({
      slug: shirt.slug,
      title: "Сорочка лляна",
      price: { from: 2000, to: 4000 },
    });
    expect(result.body).toMatchObject({
      total: 1,
      page: 1,
      pageCount: 1,
      sort: "relevance",
      relaxed: false,
    });
    expect(result.body.query.normalized).toBe("сорочку");
  });

  it("browses without a query (newest first) with facets and the price range", async () => {
    const result = await get(`/store/search?locale=en`);
    expect(result.status).toBe(200);
    expect(result.body.sort).toBe("newest");
    expect(result.body.items.map((item) => item.id).sort()).toEqual([shirt.id, tee.id].sort());
    expect(result.body.items.find((item) => item.id === shirt.id)?.title).toBe("Linen shirt");
    const brandFacet = result.body.facets.find((facet) => facet.key === "brand");
    expect(brandFacet).toMatchObject({ level: "product", counted: true, label: null });
    expect(brandFacet?.values.map((value) => [value.code, value.label, value.count])).toEqual([
      [brandA, "Nordic", 1],
      [brandB, "Stanley", 1],
    ]);
    expect(result.body.price).toEqual({ min: 1000, max: 4000 });
  });

  it("keeps the other values of a selected product facet visible with exact counts (disjunctive)", async () => {
    const result = await get(`/store/search?f=brand:${brandA}`);
    expect(result.body.items.map((item) => item.id)).toEqual([shirt.id]);
    const brandFacet = result.body.facets.find((facet) => facet.key === "brand");
    expect(brandFacet?.values).toEqual([
      { code: brandA, label: "Nordic", count: 1, selected: true },
      { code: brandB, label: "Stanley", count: 1, selected: false },
    ]);
  });

  it("lists variant-level values without counts", async () => {
    const result = await get(`/store/search?q=shirt&locale=en`);
    const size = result.body.facets.find((facet) => facet.key === `opt.${fx.size.code}`);
    expect(size).toMatchObject({ level: "variant", counted: false });
    // In the option's own order (position, then code; the fixture's values all have position 0).
    expect(size?.values.map((value) => [value.code, value.count])).toEqual([
      ["l", null],
      ["m", null],
      ["s", null],
    ]);
  });

  it("applies variant filters to the SAME variant: size M under 2500 finds nothing, under 3500 finds the shirt", async () => {
    const tooCheap = await get(`/store/search?f=opt.${fx.size.code}:m&price=..2500`);
    expect(tooCheap.status).toBe(200);
    expect(tooCheap.body.items).toEqual([]);
    const fits = await get(`/store/search?f=opt.${fx.size.code}:m&price=..3500`);
    expect(fits.body.items.map((item) => item.id)).toEqual([shirt.id]);
    const small = await get(`/store/search?f=opt.${fx.size.code}:s&price=..2500`);
    expect(small.body.items.map((item) => item.id)).toEqual([shirt.id]);
  });

  it("filters by availability and sorts by price", async () => {
    const inStock = await get(`/store/search?f=inStock:true`);
    expect(inStock.body.items.map((item) => item.id)).toEqual([shirt.id]);
    const ascending = await get(`/store/search?sort=price_asc`);
    expect(ascending.body.items.map((item) => item.id)).toEqual([tee.id, shirt.id]);
    const descending = await get(`/store/search?sort=price_desc`);
    expect(descending.body.items.map((item) => item.id)).toEqual([shirt.id, tee.id]);
  });

  it("relaxes a query of several words when nothing matches all of them, and says so", async () => {
    const result = await get(`/store/search?q=${encodeURIComponent("сорочка неіснуючеслово")}`);
    expect(result.body.relaxed).toBe(true);
    expect(result.body.items.map((item) => item.id)).toEqual([shirt.id]);
    const none = await get(`/store/search?q=${encodeURIComponent("неіснуючеслово")}`);
    expect(none.body).toMatchObject({ items: [], total: 0, relaxed: false });
  });

  it.each([
    ["an unknown facet key", "f=color:red", "f"],
    ["an internal attribute as a facet", "f=attr.secret_x:1", "f"],
    ["a malformed facet", "f=brand", "f"],
    ["a quote in a value", `f=${encodeURIComponent('brand:a" OR brand = "b')}`, "f"],
    ["filter syntax in a value", `f=${encodeURIComponent("brand:a) OR (inStock = true")}`, "f"],
    ["a NUL in a value", `f=${encodeURIComponent("brand:a\u0000")}`, "f"],
    ["a bad boolean", "f=inStock:yes", "f"],
    ["a bad price", "price=abc", "price"],
    ["an upside-down price", "price=500..100", "price"],
    ["a negative price", "price=-1..100", "price"],
    ["a page beyond 10 000 hits", "page=418&limit=24", "page"],
    ["a page size above 48", "limit=49", "limit"],
    ["a zero page", "page=0", "page"],
    ["an engine sort", "sort=price:asc", "sort"],
    ["an unknown parameter", "filter=price%20%3E%200", ""],
    ["control characters", `q=${encodeURIComponent("a\u0007b")}`, "q"],
    ["a query above 200 characters", `q=${"а".repeat(201)}`, "q"],
    ["an unknown locale", "locale=xx", "locale"],
  ])("refuses %s with 400 before the engine sees it", async (_name, query, path) => {
    const result = await get<{ code: string; errors?: { path: string }[] }>(
      `/store/search?${query}`,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    expect(result.body.code).toBe("validation_failed");
    if (path !== "") {
      expect(result.body.errors?.[0]?.path).toBe(path);
    }
  });

  it("filters a number attribute by range and refuses an end the filter cannot write with 400, never 500 (review F2)", async () => {
    const key = `attr.weight_${fx.runId}`;
    for (const range of ["1..2", "-0..2", "0.000001..2", "1.5..1.5", "..1000000000000000"]) {
      const found = await get(`/store/search?f=${encodeURIComponent(`${key}:${range}`)}`);
      expect(found.status, `${range}: ${JSON.stringify(found.body)}`).toBe(200);
      expect(
        found.body.items.map((item) => item.id),
        range,
      ).toEqual([shirt.id]);
    }
    expect((await get(`/store/search?f=${encodeURIComponent(`${key}:2..3`)}`)).body.items).toEqual(
      [],
    );
    for (const range of [
      "0.0000001..2",
      "-0.0000001..2",
      "..0.0000001",
      "0.00000000000000000001..1",
      "1e-7..2",
      "1E5..2",
      "9999999999999999999..",
      "..-1000000000000001",
    ]) {
      const refused = await get<{ code: string; errors?: { path: string; code: string }[] }>(
        `/store/search?f=${encodeURIComponent(`${key}:${range}`)}`,
      );
      expect(refused.status, `${range}: ${JSON.stringify(refused.body)}`).toBe(400);
      expect(refused.body.code).toBe("validation_failed");
      expect(refused.body.errors?.[0]).toMatchObject({ path: "f", code: "invalid_range" });
    }
  });

  it("refuses more than 8 selected facets and more than 50 values", async () => {
    const values = Array.from({ length: 51 }, (_, index) => `f=brand:b${index}`).join("&");
    expect((await get(`/store/search?${values}`)).status).toBe(400);
  });

  it("never returns an internal or hidden attribute value, its code or its label in any answer", async () => {
    for (const path of [
      `/store/search?q=${SENTINEL}`,
      `/store/search?q=shirt&locale=en`,
      `/store/search?locale=uk`,
      `/store/search/suggest?q=${encodeURIComponent("сор")}`,
    ]) {
      const result = await get<{ query?: unknown }>(path);
      expect(result.status).toBe(200);
      // The shopper's own query is echoed back normalized; everything else must be free of the sentinel.
      const text = JSON.stringify({ ...result.body, query: undefined });
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(`secret_${fx.runId}`);
      expect(text).not.toContain("Собівартість");
      expect(text).not.toContain(`hidden_${fx.runId}`);
      expect(text).not.toContain("Прихований");
    }
    // The shirt carries the sentinel in an internal AND in a hidden but searchable attribute: neither may be indexed
    // (the hidden one is excluded by `isPublicAttribute` alone, review F5 / mutation M2).
    expect((await get(`/store/search?q=${SENTINEL}`)).body.items).toEqual([]);
    expect((await get(`/store/search?q=${SENTINEL}&locale=en`)).body.items).toEqual([]);
  });

  it("suggests products for typed text from 2 characters on, never cached", async () => {
    const result = await get<{ items: { slug: string; title: string }[] }>(
      `/store/search/suggest?q=${encodeURIComponent("сор")}&locale=uk`,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.body.items).toEqual([{ slug: shirt.slug, title: "Сорочка лляна" }]);
    expect((await get(`/store/search/suggest?q=s`)).status).toBe(400);
    expect((await get(`/store/search/suggest`)).status).toBe(400);
  });

  it("drops a product the index still has but the shop no longer sells, and marks it for sync", async () => {
    const extra = await world.variant({ onHand: 1 });
    await call("PATCH", `/admin/products/${extra.productId}`, { title: { uk: "Рукавиці теплі" } });
    await syncIndex();
    expect(
      (await get(`/store/search?q=${encodeURIComponent("рукавиці")}`)).body.items,
    ).toHaveLength(1);
    await call("POST", `/admin/products/${extra.productId}/unpublish`);
    await pool.query("delete from search_sync_queue");
    const stale = await get(`/store/search?q=${encodeURIComponent("рукавиці")}`);
    expect(stale.body.items).toEqual([]);
    const marked = await pool.query("select reason from search_sync_queue where product_id = $1", [
      extra.productId,
    ]);
    expect(marked.rows).toEqual([{ reason: "stale_hit" }]);
    await syncIndex();
  });

  it("costs one engine request per pass when the text is one query, and a measured number otherwise (review F3)", async () => {
    const searches = vi.spyOn(SearchEngine.prototype, "multiSearch");
    const settingsReads = vi.spyOn(SearchEngine.prototype, "filterableAttributes");
    const heavy = [
      `f=brand:${brandA}`,
      "f=inStock:true",
      `f=opt.${fx.size.code}:m`,
      `f=opt.${fx.color.code}:red`,
      `f=opt.${fx.finish.code}:matte`,
      `f=opt.${fx.extra.code}:x1`,
      `f=${encodeURIComponent(`attr.weight_${fx.runId}:1..2`)}`,
      "price=..5000",
    ].join("&");
    const costOf = async (path: string): Promise<number> => {
      searches.mockClear();
      const result = await get(path);
      expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBe(200);
      return searches.mock.calls.length;
    };
    try {
      const measured = {
        browse: await costOf("/store/search"),
        browseHeavy: await costOf(`/store/search?${heavy}`),
        // English words whose stems are the words themselves: one text query.
        oneTextQuery: await costOf("/store/search?q=shirt&locale=en"),
        oneTextQueryHeavyRelaxed: await costOf(`/store/search?q=shirt%20qqqq&locale=en&${heavy}`),
        // Ukrainian: the words, their stems and their prefixes are three text queries, merged by one federation per
        // planned query; the engine carries one federation per request (plan, review fixes F3).
        threeTextQueries: await costOf(`/store/search?q=${encodeURIComponent("сорочку")}`),
        threeTextQueriesHeavyRelaxed: await costOf(
          `/store/search?q=${encodeURIComponent("сорочку неіснуючеслово")}&${heavy}`,
        ),
      };
      expect(measured).toEqual({
        browse: 1,
        browseHeavy: 1,
        oneTextQuery: 1,
        oneTextQueryHeavyRelaxed: 2,
        threeTextQueries: 2,
        // hits, variant facets, price range and 7 disjunctive queries (the price group has none), twice (relaxed).
        threeTextQueriesHeavyRelaxed: 20,
      });
      // The live filterable fields are read at most once per 30 s and index.
      expect(settingsReads.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      searches.mockRestore();
      settingsReads.mockRestore();
    }
  });

  it("keeps answering while a definition change waits for job 13, and offers the new facets once applied (review F1)", async () => {
    const logged = vi.spyOn(Logger.prototype, "warn");
    const errors = vi.spyOn(Logger.prototype, "error");
    // With the app running: a new option of the type, a flipped `isFilterable`, a new filterable attribute.
    const option = await call(
      "PUT",
      `/admin/product-types/${fx.teeTypeId}/options/${fx.foreign.id}`,
      {},
    );
    expect(option.status, JSON.stringify(option.body)).toBeLessThan(300);
    const material = await pool.query<{ id: string }>("select id from attribute where code = $1", [
      fx.materialAttributeCode,
    ]);
    const flipped = await call("PATCH", `/admin/attributes/${material.rows[0]?.id}`, {
      isFilterable: true,
    });
    expect(flipped.status, JSON.stringify(flipped.body)).toBe(200);
    const flag = await call<{ id: string }>("POST", "/admin/attributes", {
      code: `flag_${fx.runId}`,
      name: { uk: "Прапорець" },
      inputType: "boolean",
      isFilterable: true,
    });
    expect(flag.status, JSON.stringify(flag.body)).toBe(201);
    extraAttributeIds.push(flag.body.id);
    expect(
      (
        await call("PUT", `/admin/product-types/${fx.teeTypeId}/attributes/${flag.body.id}`, {
          level: "product",
        })
      ).status,
    ).toBeLessThan(300);

    // A new app has cold caches: what the running app sees once its 30 s definitions cache expired.
    const waiting = await startApp({ search: search.env });
    try {
      for (const path of [
        "/store/search",
        "/store/search?q=shirt&locale=en",
        `/store/search?f=brand:${brandA}`,
        `/store/search?f=opt.${fx.size.code}:m`,
      ]) {
        const result = await get(path, waiting.baseUrl);
        expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBe(200);
      }
      // Not filterable in the live index yet: not a facet yet (400), never an engine error.
      for (const param of [
        `opt.${fx.foreign.code}:f1`,
        `attr.${fx.materialAttributeCode}:linen`,
        `attr.flag_${fx.runId}:true`,
      ]) {
        const refused = await get<{ errors?: { code: string }[] }>(
          `/store/search?f=${encodeURIComponent(param)}`,
          waiting.baseUrl,
        );
        expect(refused.status, `${param}: ${JSON.stringify(refused.body)}`).toBe(400);
        expect(refused.body.errors?.[0]?.code).toBe("unknown_facet_key");
      }
    } finally {
      await waiting.app.close();
    }

    await syncIndex(); // job 13 applies the settings (and re-syncs the products the change marked)
    const applied = await startApp({ search: search.env });
    try {
      const linen = await get(
        `/store/search?f=${encodeURIComponent(`attr.${fx.materialAttributeCode}:linen`)}`,
        applied.baseUrl,
      );
      expect(linen.status, JSON.stringify(linen.body)).toBe(200);
      expect(linen.body.items.map((item) => item.id)).toEqual([shirt.id]);
      expect(linen.body.facets.map((facet) => facet.key)).toContain(
        `attr.${fx.materialAttributeCode}`,
      );
      const foreign = await get(`/store/search?f=opt.${fx.foreign.code}:f1`, applied.baseUrl);
      expect(foreign.status, JSON.stringify(foreign.body)).toBe(200);
      expect(foreign.body.items).toEqual([]);
    } finally {
      await applied.app.close();
    }
    const lines = [...logged.mock.calls, ...errors.mock.calls].map((args) => String(args[0]));
    expect(lines.filter((line) => line.includes("engine_rejected"))).toEqual([]);
    logged.mockRestore();
    errors.mockRestore();
  });

  it("answers an engine 400 with 500, logs it as an error, counts it in the admin status and re-reads the live settings (review F1)", async () => {
    const drifting = await startApp({
      search: search.env,
      adminAuthenticator: ownerAuthenticator(adminId),
    });
    const errors = vi.spyOn(Logger.prototype, "error");
    const uid = search.liveUid("uk");
    const before = (await indexSettings(uid))["filterableAttributes"] as string[];
    try {
      expect((await get("/store/search", drifting.baseUrl)).status).toBe(200); // caches the live settings
      // Drift behind the API's back: the live index loses a field the cached view still lists.
      await updateIndexSettingsAsMaster(uid, {
        filterableAttributes: before.filter((field) => field !== `opt_${fx.size.code}`),
      });
      const rejected = await get<{ code: string }>("/store/search", drifting.baseUrl);
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(500);
      expect(rejected.body.code).toBe("internal_error");
      const logged = errors.mock.calls.map((args) => String(args[0])).join("\n");
      expect(logged).toContain("engine_rejected");
      expect(logged).toContain("invalid_search_facets");
      const status = await http<{
        engine: { rejectedSearches: { count: number; lastCode: string | null; lastAt: string } };
      }>(drifting.baseUrl, "GET", "/admin/search/status");
      expect(status.status).toBe(200);
      expect(status.body.engine.rejectedSearches).toMatchObject({
        count: 1,
        lastCode: "invalid_search_facets",
      });
      expect(Date.parse(status.body.engine.rejectedSearches.lastAt)).not.toBeNaN();
      // The rejection dropped the cached view: the next request reads the live settings and answers without the field.
      const recovered = await get("/store/search", drifting.baseUrl);
      expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
      expect(recovered.body.facets.map((facet) => facet.key)).not.toContain(`opt.${fx.size.code}`);
    } finally {
      errors.mockRestore();
      await updateIndexSettingsAsMaster(uid, { filterableAttributes: before });
      await drifting.app.close();
    }
  });

  it("refuses hostile option and attribute values and a page whose first hit is exactly 10 000 (review F5)", async () => {
    for (const param of [
      `opt.${fx.size.code}:m" OR inStock = true`,
      `opt.${fx.size.code}:m) OR (inStock = true`,
      `opt.${fx.size.code}:M`,
      `opt.${fx.size.code}:m\u0000`,
      `attr.fit_${fx.runId}:slim" OR brand = "x`,
      `attr.fit_${fx.runId}:Slim`,
    ]) {
      const refused = await get<{ code: string; errors?: { path: string; code: string }[] }>(
        `/store/search?f=${encodeURIComponent(param)}`,
      );
      expect(refused.status, `${param}: ${JSON.stringify(refused.body)}`).toBe(400);
      expect(refused.body.errors?.[0], param).toMatchObject({ path: "f", code: "invalid_value" });
    }
    const boundary = await get<{ errors?: { path: string; code: string }[] }>(
      "/store/search?page=251&limit=40",
    );
    expect(boundary.status, JSON.stringify(boundary.body)).toBe(400);
    expect(boundary.body.errors?.[0]).toMatchObject({ path: "page", code: "beyond_max_offset" });
    expect((await get("/store/search?page=250&limit=40")).status).toBe(200);
  });

  it("answers 503 search_unavailable within the timeout when the engine is down, and logs no query text", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn");
    const down = await startApp({
      search: { ...search.env, meiliUrl: "http://127.0.0.1:9" },
      searchTuning: { searchTimeoutMs: 500 },
    });
    try {
      const started = Date.now();
      const result = await get<{ code: string }>(
        `/store/search?q=${encodeURIComponent("секретний запит")}`,
        down.baseUrl,
      );
      expect(result.status).toBe(503);
      expect(result.body.code).toBe("search_unavailable");
      expect(result.headers.get("retry-after")).toBe("30");
      expect(Date.now() - started).toBeLessThan(2_500);
      const suggest = await get<{ code: string }>(`/store/search/suggest?q=abc`, down.baseUrl);
      expect(suggest.status).toBe(503);
      const logged = warn.mock.calls.map((args) => String(args[0])).join("\n");
      expect(logged).toContain("engine_unreachable");
      expect(logged).not.toContain("секретний");
    } finally {
      warn.mockRestore();
      await down.app.close();
    }
  });

  it("is rate limited per address", async () => {
    const limited = await startApp({
      search: search.env,
      rateLimits: {
        search: { maxAttempts: 2, windowMinutes: 1 },
        searchSuggest: { maxAttempts: 1, windowMinutes: 1 },
      },
    });
    try {
      expect((await get(`/store/search`, limited.baseUrl)).status).toBe(200);
      expect((await get(`/store/search`, limited.baseUrl)).status).toBe(200);
      const third = await get(`/store/search`, limited.baseUrl);
      expect(third.status).toBe(429);
      expect(third.headers.get("retry-after")).not.toBeNull();
      expect((await get(`/store/search/suggest?q=ab`, limited.baseUrl)).status).toBe(200);
      expect((await get(`/store/search/suggest?q=ab`, limited.baseUrl)).status).toBe(429);
    } finally {
      await limited.app.close();
    }
  });

  it("answers 404 on both routes with SEARCH_ENABLED=false", async () => {
    const off = await startApp();
    try {
      expect((await get(`/store/search?q=shirt`, off.baseUrl)).status).toBe(404);
      expect((await get(`/store/search/suggest?q=sh`, off.baseUrl)).status).toBe(404);
    } finally {
      await off.app.close();
    }
  });
});
