import type pg from "pg";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { PG_POOL } from "../../../database/database.module.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import {
  caller,
  createCatalogFixture,
  newRunId,
  type Call,
  type CatalogFixture,
} from "../../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { ensureMigrated } from "../../../test/migrate.js";
import type { Page } from "../../../common/pagination.js";
import { product } from "../../../database/schema/index.js";
import { productSearchCondition, type ProductSearch } from "./products.repository.js";
import type { ProductDetailResponse, ProductResponse } from "./products.schemas.js";

describe("GET /admin/products?q= (real app, real Postgres)", () => {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl() });
  const runId = newRunId();
  let running: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  const ids: Record<string, string> = {};
  let categoryId = "";
  let brandId = "";

  /** Slugs are `<runId>-<name>` so one run never meets another run's rows. */
  const slug = (name: string) => `s${runId}-${name}`;
  const sku = (name: string) => `K${runId.toUpperCase()}-${name.toUpperCase()}`;

  async function createProduct(name: string, extra: Record<string, unknown> = {}) {
    const result = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: fx.teeTypeId,
      title: { uk: `Пошук ${runId} ${name}` },
      slug: slug(name),
      ...extra,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    ids[name] = result.body.id;
    const defaultVariant = result.body.variants[0];
    expect(defaultVariant).toBeDefined();
    const patched = await call(
      "PATCH",
      `/admin/products/${result.body.id}/variants/${defaultVariant?.id}`,
      {
        sku: sku(name),
      },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    return result.body;
  }

  async function addVariant(name: string, extraSku: string) {
    const put = await call<ProductDetailResponse>("PUT", `/admin/products/${ids[name]}/options`, {
      options: [
        { optionId: fx.color.id, valueIds: [fx.color.values["red"], fx.color.values["blue"]] },
      ],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    // Two generated variants; give the second one a known SKU.
    const second =
      put.body.variants.find((entry) => entry.sku !== sku(name)) ?? put.body.variants[1];
    expect(second).toBeDefined();
    const patched = await call("PATCH", `/admin/products/${ids[name]}/variants/${second?.id}`, {
      sku: extraSku,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  }

  async function search(query: string): Promise<Page<ProductResponse>> {
    const result = await call<Page<ProductResponse>>("GET", `/admin/products?${query}`);
    expect(result.status, `${query}: ${JSON.stringify(result.body)}`).toBe(200);
    return result.body;
  }

  const slugsOf = (page: Page<ProductResponse>) => page.items.map((item) => item.slug).sort();

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call, runId);
    const brand = await call<{ id: string }>("POST", "/admin/brands", {
      name: { uk: `Бренд ${runId}` },
    });
    brandId = brand.body.id;
    const category = await call<{ id: string }>("POST", "/admin/categories", {
      name: { uk: `Категорія ${runId}` },
    });
    categoryId = category.body.id;

    await createProduct("alpha-one", { brandId });
    await createProduct("alpha-two");
    await createProduct("beta-alpha");
    await createProduct("axb");
    await createProduct("gamma");
    await addVariant("gamma", `EXTRA-${runId.toUpperCase()}-G2`);
    const assign = await call("PUT", `/admin/products/${ids["alpha-one"]}/categories`, {
      categories: [{ categoryId }],
    });
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);
    // alpha-two is archived-able? keep it draft; publish nothing: status filter uses draft vs archived below.
    const archived = await call("POST", `/admin/products/${ids["alpha-two"]}/archive`);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.query("delete from product where slug like $1", [`s${runId}-%`]);
    await pool.query("delete from brand where id = $1", [brandId]);
    await pool.query("delete from category where id = $1", [categoryId]);
    await pool.end();
  });

  describe("slug prefix", () => {
    it("matches the start of the slug, not the middle", async () => {
      const page = await search(`q=${slug("alpha")}`);
      expect(slugsOf(page)).toEqual([slug("alpha-one"), slug("alpha-two")]);
      expect(page.total).toBe(2);
    });

    it("ignores case and surrounding spaces of the typed text (slugs are lower case)", async () => {
      const page = await search(`q=${encodeURIComponent(`  ${slug("ALPHA").toUpperCase()} `)}`);
      expect(slugsOf(page)).toEqual([slug("alpha-one"), slug("alpha-two")]);
    });

    it("matches a whole slug too", async () => {
      expect(slugsOf(await search(`q=${slug("gamma")}`))).toEqual([slug("gamma")]);
    });

    it("finds nothing for a text that starts no slug and is no SKU", async () => {
      const page = await search(`q=${slug("nothing")}`);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it("treats an underscore as a plain character, not a one-letter wildcard", async () => {
      // `s<run>-a_b` would match `s<run>-axb` if `_` were a LIKE wildcard.
      expect((await search(`q=${slug("a_b")}`)).items).toEqual([]);
      expect(slugsOf(await search(`q=${slug("axb")}`))).toEqual([slug("axb")]);
    });
  });

  describe("exact SKU of any variant", () => {
    it("finds the product of the default variant's SKU", async () => {
      expect(slugsOf(await search(`q=${sku("alpha-one")}`))).toEqual([slug("alpha-one")]);
    });

    it("finds the product of a non-default variant's SKU", async () => {
      expect(slugsOf(await search(`q=EXTRA-${runId.toUpperCase()}-G2`))).toEqual([slug("gamma")]);
    });

    it("normalizes the typed SKU like the SKU rules do (trim, upper case)", async () => {
      const typed = encodeURIComponent(` ${sku("alpha-one").toLowerCase()} `);
      expect(slugsOf(await search(`q=${typed}`))).toEqual([slug("alpha-one")]);
    });

    it("never matches a SKU by prefix", async () => {
      const page = await search(`q=${encodeURIComponent(sku("alpha-on"))}`);
      expect(page.items).toEqual([]);
    });

    it("lists a product once when both its slug and a variant's SKU match", async () => {
      // `gamma` has two variants and the slug prefix matches too: still one row, one count.
      const page = await search(`q=${slug("gamma")}`);
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
    });
  });

  describe("bad input is a 400 on q", () => {
    it.each([
      ["empty", ""],
      ["only spaces", "%20%20"],
      ["too long (161 characters)", "a".repeat(161)],
      ["a space inside", "red%20shirt"],
      ["a LIKE wildcard", "100%25"],
      ["a backslash", "a%5Cb"],
      ["a NUL byte", "a%00b"],
      ["a non-ASCII letter", "%D0%BA%D1%83%D1%80%D1%82%D0%BA%D0%B0"],
    ])("rejects %s", async (_label, value) => {
      const result = await call<ProblemBody>("GET", `/admin/products?q=${value}`);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "validation_failed" });
      expect(result.body.errors?.map((entry) => entry.path)).toContain("q");
    });

    it("rejects q given twice", async () => {
      const result = await call<ProblemBody>("GET", "/admin/products?q=a&q=b");
      expect(result.status).toBe(400);
    });

    it("accepts the longest slug (160 characters)", async () => {
      const page = await search(`q=${"a".repeat(160)}`);
      expect(page.items).toEqual([]);
    });
  });

  describe("combined with the other filters and pagination", () => {
    it("ANDs with status", async () => {
      const active = await search(`q=${slug("alpha")}&status=archived`);
      expect(slugsOf(active)).toEqual([slug("alpha-two")]);
      const draft = await search(`q=${slug("alpha")}&status=draft`);
      expect(slugsOf(draft)).toEqual([slug("alpha-one")]);
    });

    it("ANDs with brandId and categoryId", async () => {
      expect(slugsOf(await search(`q=${slug("alpha")}&brandId=${brandId}`))).toEqual([
        slug("alpha-one"),
      ]);
      expect(slugsOf(await search(`q=${slug("alpha")}&categoryId=${categoryId}`))).toEqual([
        slug("alpha-one"),
      ]);
      expect((await search(`q=${slug("gamma")}&categoryId=${categoryId}`)).items).toEqual([]);
    });

    it("pages the matches in slug order with the total of all of them", async () => {
      const first = await search(`q=${slug("alpha")}&limit=1&offset=0`);
      const second = await search(`q=${slug("alpha")}&limit=1&offset=1`);
      expect(first.total).toBe(2);
      expect(second.total).toBe(2);
      expect(first.items.map((item) => item.slug)).toEqual([slug("alpha-one")]);
      expect(second.items.map((item) => item.slug)).toEqual([slug("alpha-two")]);
      expect((await search(`q=${slug("alpha")}&limit=1&offset=2`)).items).toEqual([]);
    });

    it("leaves a request without q exactly as it was (no filter)", async () => {
      const page = await search(`limit=100`);
      expect(page.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe("statement count", () => {
    async function statements(query: string): Promise<number> {
      const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
      const spy = vi.spyOn(poolOfApp, "query");
      try {
        await search(query);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }

    it("issues the same number of statements with q, with a matching SKU and without q", async () => {
      const without = await statements("limit=100");
      expect(without).toBe(2);
      expect(await statements(`q=${slug("alpha")}`)).toBe(without);
      expect(await statements(`q=${sku("alpha-one")}`)).toBe(without);
      expect(await statements(`q=${slug("alpha")}&limit=1&status=draft&brandId=${brandId}`)).toBe(
        without,
      );
    });
  });

  describe("the query plan (SKU by index, no text search)", () => {
    /** The statement the repository really runs, planned with sequential scans off: a missing index shows as a failure. */
    async function plan(search: ProductSearch): Promise<string> {
      const { sql: text, params } = drizzle(pool)
        .select({ id: product.id })
        .from(product)
        .where(productSearchCondition(search))
        .toSQL();
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local enable_seqscan = off");
        const result = await client.query(`explain ${text}`, params);
        return result.rows.map((row: { "QUERY PLAN": string }) => row["QUERY PLAN"]).join("\n");
      } finally {
        await client.query("rollback");
        client.release();
      }
    }

    it("reads the SKU arm from variant_sku_key", async () => {
      // The slug arm is a prefix scan of `product` today (no `text_pattern_ops` index, which would be a migration);
      // see `productSearchCondition`. Only the SKU arm is asserted to be index-served.
      const text = await plan({ slugPrefix: slug("alpha"), sku: sku("alpha-one") });
      expect(text).toContain("variant_sku_key");
      expect(text).toContain("product_pkey");
    });

    it("uses no text search (no ILIKE, no similarity, no full-text operator)", async () => {
      const { sql: text } = drizzle(pool)
        .select({ id: product.id })
        .from(product)
        .where(productSearchCondition({ slugPrefix: "a", sku: "A" }))
        .toSQL();
      expect(text.toLowerCase()).not.toMatch(/ilike|similarity|to_tsvector|@@|~\*/);
    });

    it("escapes LIKE wildcards in the pattern it sends", async () => {
      const { params } = drizzle(pool)
        .select({ id: product.id })
        .from(product)
        .where(productSearchCondition({ slugPrefix: "a_b%c\\d", sku: "A" }))
        .toSQL();
      expect(params).toContain("a\\_b\\%c\\\\d%");
    });
  });
});
