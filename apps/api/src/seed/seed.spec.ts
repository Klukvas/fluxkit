import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERNAL_SUPPLIER_MARKER, catalogSeed, type SeedCategory } from "@fluxkit/seeds";
import type { Page } from "../common/pagination.js";
import { ProblemException } from "../common/problem.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import type {
  StoreCategoryNode,
  StoreProductDetail,
  StoreProductListItem,
} from "../catalog/store/store.schemas.js";
import { SEED_ENTITY_KINDS, type SeedSummary } from "./catalog-seeder.js";
import {
  ALLOW_PRODUCTION_FLAG,
  assertSeedAllowed,
  formatSummary,
  runSeedCommand,
} from "./seed-command.js";

const { attributes, options, productTypes, brands, categories, products } = catalogSeed;

function allCategories(tree: readonly SeedCategory[]): SeedCategory[] {
  return tree.flatMap((node) => [node, ...allCategories(node.children ?? [])]);
}

function expectedCounts(): Record<(typeof SEED_ENTITY_KINDS)[number], number> {
  return {
    attributes: attributes.length,
    options: options.length,
    productTypes: productTypes.length,
    brands: brands.length,
    categories: allCategories(categories).length,
    products: products.length,
  };
}

describe("catalog seed (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const env = { DATABASE_URL: requireTestDatabaseUrl() };
  let running: RunningApp;
  let firstRun: SeedSummary;

  /** Row counts of every table in the public schema, so a second run proves "no new rows anywhere". */
  async function tableCounts(): Promise<Record<string, number>> {
    const tables = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    const counts: Record<string, number> = {};
    for (const { tablename } of tables.rows) {
      const result = await pool.query<{ count: number }>(
        `select count(*)::int as count from "${tablename.replaceAll('"', '""')}"`,
      );
      counts[tablename] = result.rows[0]?.count ?? -1;
    }
    return counts;
  }

  /** Removes only what the seed creates, found by its stable codes and slugs, children before parents. */
  async function removeSeedRows(): Promise<void> {
    const productSlugs = products.map((product) => product.slug);
    const where = "product_id in (select id from product where slug = any($1))";
    await pool.query(`delete from media where ${where}`, [productSlugs]);
    await pool.query(`delete from variant where ${where}`, [productSlugs]);
    await pool.query("delete from product where slug = any($1)", [productSlugs]);
    const levels: (readonly SeedCategory[])[] = [
      categories.flatMap((root) => root.children ?? []),
      categories,
    ];
    for (const level of levels) {
      await pool.query("delete from category where slug = any($1)", [
        level.map((node) => node.slug),
      ]);
    }
    await pool.query("delete from brand where slug = any($1)", [brands.map((b) => b.slug)]);
    await pool.query("delete from product_type where code = any($1)", [
      productTypes.map((type) => type.code),
    ]);
    await pool.query("delete from attribute where code = any($1)", [
      attributes.map((attribute) => attribute.code),
    ]);
    await pool.query('delete from "option" where code = any($1)', [
      options.map((option) => option.code),
    ]);
  }

  beforeAll(async () => {
    await ensureMigrated();
    // A crashed earlier run must not leave rows that make the "created" counts lie.
    await removeSeedRows();
    firstRun = await runSeedCommand([], env);
    running = await startApp();
  });

  afterAll(async () => {
    await running?.app.close();
    await removeSeedRows();
    await pool.end();
  });

  it("creates the whole demo catalog on an empty database", () => {
    const expected = expectedCounts();
    expect(firstRun.created).toEqual(expected);
    expect(firstRun.existing).toEqual({
      attributes: 0,
      options: 0,
      productTypes: 0,
      brands: 0,
      categories: 0,
      products: 0,
    });
    // 3 + 8 + 4 clothing variants, one default variant for each of the 5 products without options.
    expect(firstRun.variantsCreated).toBe(9 + 8 + 4 + 5);
    expect(formatSummary(firstRun)).toContain("products      created   8");
  });

  describe("store API", () => {
    it("returns the demo category tree in uk and en", async () => {
      for (const locale of ["uk", "en"] as const) {
        const result = await http<{ items: StoreCategoryNode[] }>(
          running.baseUrl,
          "GET",
          `/store/categories?locale=${locale}`,
        );
        expect(result.status).toBe(200);
        for (const root of categories) {
          const node = result.body.items.find((candidate) => candidate.slug === root.slug);
          expect(node?.name, root.slug).toBe(root.name[locale]);
          expect(node?.children.map((child) => child.slug)).toEqual(
            (root.children ?? []).map((child) => child.slug),
          );
          expect(node?.children.map((child) => child.name)).toEqual(
            (root.children ?? []).map((child) => child.name[locale]),
          );
        }
      }
    });

    it("lists exactly the demo products in uk and en", async () => {
      for (const locale of ["uk", "en"] as const) {
        const result = await http<Page<StoreProductListItem>>(
          running.baseUrl,
          "GET",
          `/store/products?brand=${brands[0]?.slug}&limit=100&locale=${locale}`,
        );
        expect(result.status).toBe(200);
        expect(result.body.total).toBe(products.length);
        expect(result.body.items.map((item) => item.title).sort()).toEqual(
          products.map((product) => product.title[locale]).sort(),
        );
        expect(
          result.body.items.every((item) => item.brand?.name === brands[0]?.name[locale]),
        ).toBe(true);
        expect(
          result.body.items.every((item) => item.image?.url.startsWith("https://example.com/")),
        ).toBe(true);
      }
    });

    it("counts products per top-level category including descendants, and paginates", async () => {
      const perCategory: Record<string, number> = {
        "demo-clothing": 3,
        "demo-tools": 3,
        "demo-digital-goods": 2,
      };
      for (const [slug, total] of Object.entries(perCategory)) {
        const result = await http<Page<StoreProductListItem>>(
          running.baseUrl,
          "GET",
          `/store/products?category=${slug}`,
        );
        expect(result.body.total, slug).toBe(total);
        expect(result.body.items, slug).toHaveLength(total);
      }
      const firstPage = await http<Page<StoreProductListItem>>(
        running.baseUrl,
        "GET",
        `/store/products?brand=${brands[0]?.slug}&limit=3&offset=0`,
      );
      const lastPage = await http<Page<StoreProductListItem>>(
        running.baseUrl,
        "GET",
        `/store/products?brand=${brands[0]?.slug}&limit=3&offset=6`,
      );
      expect(firstPage.body.items).toHaveLength(3);
      expect(lastPage.body.items).toHaveLength(products.length - 6);
    });

    it("gives a clothing product its option values and one variant per color and size", async () => {
      const result = await http<StoreProductDetail>(
        running.baseUrl,
        "GET",
        "/store/products/demo-t-shirt?locale=en",
      );
      expect(result.status).toBe(200);
      const detail = result.body;
      expect(detail.title).toBe("Demo T-shirt");
      expect(detail.options.map((entry) => [entry.code, entry.values.map((v) => v.code)])).toEqual([
        ["color", ["black", "white", "red"]],
        ["size", ["s", "m", "l"]],
      ]);
      expect(detail.variants).toHaveLength(3 * 3);
      const combinations = detail.variants.map((variant) =>
        variant.optionValues
          .map((pair) => `${pair.optionCode}=${pair.valueCode}`)
          .sort()
          .join(";"),
      );
      expect(new Set(combinations).size).toBe(9);
      expect(detail.attributes["material"]).toEqual({ code: "cotton", label: "Cotton" });
      expect(detail.media.some((item) => item.optionValueId !== null)).toBe(true);

      const hoodie = await http<StoreProductDetail>(
        running.baseUrl,
        "GET",
        "/store/products/demo-hoodie",
      );
      expect(hoodie.body.variants).toHaveLength(2 * 4);
    });

    it("gives a hand tool exactly one default variant and its typed attributes", async () => {
      const result = await http<StoreProductDetail>(
        running.baseUrl,
        "GET",
        "/store/products/demo-hammer?locale=uk",
      );
      expect(result.status).toBe(200);
      expect(result.body.options).toEqual([]);
      expect(result.body.variants).toHaveLength(1);
      expect(result.body.variants[0]?.optionValues).toEqual([]);
      expect(result.body.attributes["length"]).toEqual({ value: 330, unit: "mm" });
      expect(result.body.attributes["head_type"]).toEqual({ code: "claw", label: "Цвяходер" });
    });

    it("never returns the internal demo attribute, in any product, locale or list", async () => {
      const bodies: string[] = [];
      for (const locale of ["uk", "en"] as const) {
        const list = await http(
          running.baseUrl,
          "GET",
          `/store/products?brand=${brands[0]?.slug}&limit=100&locale=${locale}`,
        );
        bodies.push(JSON.stringify(list.body));
        for (const product of products) {
          const detail = await http(
            running.baseUrl,
            "GET",
            `/store/products/${product.slug}?locale=${locale}`,
          );
          expect(detail.status, product.slug).toBe(200);
          bodies.push(JSON.stringify(detail.body));
        }
      }
      const storedInternal = await pool.query(
        "select count(*)::int as count from product where attributes::text like $1",
        [`%${INTERNAL_SUPPLIER_MARKER}%`],
      );
      // The value really is stored, so its absence from the responses is the rule at work.
      expect(storedInternal.rows[0]?.count).toBe(3);
      for (const body of bodies) {
        expect(body).not.toContain(INTERNAL_SUPPLIER_MARKER);
        expect(body).not.toContain("supplier_reference");
      }
    });
  });

  describe("idempotency", () => {
    it("runs a second time without errors, duplicates or new rows", async () => {
      const before = await tableCounts();
      const second = await runSeedCommand([], env);
      const after = await tableCounts();

      expect(after).toEqual(before);
      expect(second.created).toEqual({
        attributes: 0,
        options: 0,
        productTypes: 0,
        brands: 0,
        categories: 0,
        products: 0,
      });
      expect(second.existing).toEqual(expectedCounts());
      expect(second.variantsCreated).toBe(0);
    });

    it("leaves an entity that exists alone, even when its content differs from the seed", async () => {
      await pool.query(
        `update brand set name = '{"uk":"Змінено","en":"Edited"}'::jsonb where slug = $1`,
        [brands[0]?.slug],
      );
      await runSeedCommand([], env);
      const row = await pool.query<{ name: Record<string, string> }>(
        "select name from brand where slug = $1",
        [brands[0]?.slug],
      );
      expect(row.rows[0]?.name).toEqual({ uk: "Змінено", en: "Edited" });
    });
  });

  describe("failures are loud", () => {
    it("rejects invalid seed data with the validation errors of the admin API and creates nothing", async () => {
      const [template] = products;
      if (template === undefined) {
        throw new Error("The demo seed has no products.");
      }
      const before = await tableCounts();
      const broken = {
        ...catalogSeed,
        products: [
          {
            ...template,
            slug: "demo-broken-product",
            attributes: { material: "no_such_material" },
          },
        ],
      };
      const failure = await runSeedCommand([], env, { seed: broken }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ProblemException);
      expect((failure as ProblemException).code).toBe("validation_failed");
      expect(JSON.stringify((failure as ProblemException).errors)).toContain("material");
      expect(await tableCounts()).toEqual(before);
    });

    it("fails when seed data refers to something that does not exist", async () => {
      const [template] = products;
      if (template === undefined) {
        throw new Error("The demo seed has no products.");
      }
      const broken = {
        ...catalogSeed,
        products: [{ ...template, slug: "demo-broken-reference", brandSlug: "no-such-brand" }],
      };
      await expect(runSeedCommand([], env, { seed: broken })).rejects.toThrow(
        'Seed data refers to a brand "no-such-brand" that does not exist.',
      );
    });

    it("does not invent a default for a missing DATABASE_URL", async () => {
      await expect(runSeedCommand([], {})).rejects.toThrow(/DATABASE_URL/);
    });
  });

  describe("production guard", () => {
    it("refuses NODE_ENV=production unless the explicit flag is given", () => {
      expect(() => assertSeedAllowed({ NODE_ENV: "production" }, [])).toThrow(/Refusing to seed/);
      expect(() => assertSeedAllowed({ NODE_ENV: "production" }, ["--other"])).toThrow(
        /Refusing to seed/,
      );
      expect(() =>
        assertSeedAllowed({ NODE_ENV: "production" }, [ALLOW_PRODUCTION_FLAG]),
      ).not.toThrow();
      expect(() => assertSeedAllowed({ NODE_ENV: "development" }, [])).not.toThrow();
      expect(() => assertSeedAllowed({}, [])).not.toThrow();
    });

    it("stops the command before it touches the database", async () => {
      const before = await tableCounts();
      await expect(runSeedCommand([], { ...env, NODE_ENV: "production" })).rejects.toThrow(
        /Refusing to seed/,
      );
      // A guard that ran too late would fail on the missing DATABASE_URL instead.
      await expect(runSeedCommand([], { NODE_ENV: "production" })).rejects.toThrow(
        /Refusing to seed/,
      );
      expect(await tableCounts()).toEqual(before);
    });
  });
});
