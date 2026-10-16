import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  INTERNAL_SUPPLIER_MARKER,
  catalogSeed,
  type SeedCategory,
  type SeedProduct,
  type SeedVariantCommerce,
} from "@fluxkit/seeds";
import type { Page } from "../common/pagination.js";
import { ProblemException } from "../common/problem.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import type { ProductDetailResponse } from "../catalog/admin/products/products.schemas.js";
import type { InventoryResponse, MovementResponse } from "../inventory/admin/inventory.schemas.js";
import type {
  StoreConfig,
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

/** The default LOW_STOCK_THRESHOLD of @fluxkit/config; the test app runs with the default pricing config. */
const LOW_STOCK_THRESHOLD = 5;

type Availability = "in_stock" | "low_stock" | "out_of_stock";

interface PairLike {
  optionCode: string;
  valueCode: string;
}

/** Identifies a variant by its option values, for the seed data and for API responses alike. */
function variantKey(optionValues: Readonly<Record<string, string>>): string {
  return Object.entries(optionValues)
    .map(([optionCode, valueCode]) => `${optionCode}=${valueCode}`)
    .sort()
    .join(";");
}

function keyOfPairs(pairs: readonly PairLike[]): string {
  return variantKey(Object.fromEntries(pairs.map((pair) => [pair.optionCode, pair.valueCode])));
}

function commerceOf(product: SeedProduct, key: string): SeedVariantCommerce {
  const found = product.variants.find((candidate) => variantKey(candidate.optionValues) === key);
  if (found === undefined) {
    throw new Error(`The seed data of ${product.slug} has no variant ${key}.`);
  }
  return found;
}

/** What the store must say about a variant of the seed data (the stock rules of core applied to the seed numbers). */
function expectedAvailability(commerce: SeedVariantCommerce): Availability {
  if (commerce.stock === undefined || commerce.allowBackorder === true) {
    return "in_stock";
  }
  if (commerce.stock === 0) {
    return "out_of_stock";
  }
  return commerce.stock <= LOW_STOCK_THRESHOLD ? "low_stock" : "in_stock";
}

function bestAvailability(states: readonly Availability[]): Availability {
  if (states.includes("in_stock")) {
    return "in_stock";
  }
  return states.includes("low_stock") ? "low_stock" : "out_of_stock";
}

function stockedVariantCount(): number {
  return products.reduce(
    (sum, product) => sum + product.variants.filter((commerce) => (commerce.stock ?? 0) > 0).length,
    0,
  );
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

  /** Rows of a per-variant table that belong to the demo products. */
  async function seedRowCount(
    table: "price" | "inventory_level" | "stock_movement",
  ): Promise<number> {
    const result = await pool.query<{ count: number }>(
      `select count(*)::int as count from ${table}
        where variant_id in (select v.id from variant v join product p on p.id = v.product_id where p.slug = any($1))`,
      [products.map((product) => product.slug)],
    );
    return result.rows[0]?.count ?? -1;
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

  it("writes one price per variant in the shop currency, and a level and a journal row per stocked variant", async () => {
    const variantCount = products.reduce((sum, product) => sum + product.variants.length, 0);
    const prices = await pool.query<{ currency: string; count: number }>(
      `select currency, count(*)::int as count from price
        where variant_id in (select v.id from variant v join product p on p.id = v.product_id where p.slug = any($1))
        group by currency`,
      [products.map((product) => product.slug)],
    );
    expect(prices.rows).toEqual([{ currency: "UAH", count: variantCount }]);
    expect(await seedRowCount("inventory_level")).toBe(stockedVariantCount());
    expect(await seedRowCount("stock_movement")).toBe(stockedVariantCount());
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

    it("shows the seeded prices and compare-at prices on every variant, in the shop currency", async () => {
      for (const product of products) {
        const detail = await http<StoreProductDetail>(
          running.baseUrl,
          "GET",
          `/store/products/${product.slug}`,
        );
        expect(detail.status, product.slug).toBe(200);
        expect(detail.body.variants, product.slug).toHaveLength(product.variants.length);
        for (const variant of detail.body.variants) {
          const key = keyOfPairs(variant.optionValues);
          const commerce = commerceOf(product, key);
          expect(variant.price, `${product.slug} ${key}`).toEqual({
            amount: commerce.amount,
            currency: "UAH",
            compareAtAmount: commerce.compareAtAmount ?? null,
          });
        }
      }
    });

    it("shows each availability state of the seed data per variant, per product and in the list", async () => {
      const seen = new Set<Availability>();
      const list = await http<Page<StoreProductListItem>>(
        running.baseUrl,
        "GET",
        `/store/products?brand=${brands[0]?.slug}&limit=100&locale=en`,
      );
      for (const product of products) {
        const detail = await http<StoreProductDetail>(
          running.baseUrl,
          "GET",
          `/store/products/${product.slug}`,
        );
        const states: Availability[] = [];
        for (const variant of detail.body.variants) {
          const key = keyOfPairs(variant.optionValues);
          const expected = expectedAvailability(commerceOf(product, key));
          expect(variant.availability, `${product.slug} ${key}`).toBe(expected);
          states.push(expected);
          seen.add(expected);
        }
        expect(detail.body.availability, product.slug).toBe(bestAvailability(states));
        const item = list.body.items.find((candidate) => candidate.title === product.title.en);
        expect(item?.availability, product.slug).toBe(bestAvailability(states));
        const amounts = product.variants.map((commerce) => commerce.amount);
        expect(item?.price, product.slug).toEqual({
          from: Math.min(...amounts),
          to: Math.max(...amounts),
          currency: "UAH",
        });
      }
      expect([...seen].sort()).toEqual(["in_stock", "low_stock", "out_of_stock"]);
    });

    it("shows the backorder variant and the untracked digital products as in stock", async () => {
      const backorder = products.flatMap((product) =>
        product.variants
          .filter((commerce) => commerce.allowBackorder === true)
          .map((commerce) => ({ product, commerce })),
      );
      expect(backorder.length).toBeGreaterThan(0);
      for (const { product, commerce } of backorder) {
        expect(commerce.stock).toBe(0);
        const detail = await http<StoreProductDetail>(
          running.baseUrl,
          "GET",
          `/store/products/${product.slug}`,
        );
        const variant = detail.body.variants.find(
          (candidate) => keyOfPairs(candidate.optionValues) === variantKey(commerce.optionValues),
        );
        expect(variant?.availability).toBe("in_stock");
      }
      const digital = products.filter((product) => product.productTypeCode === "digital_product");
      expect(digital.length).toBeGreaterThan(0);
      for (const product of digital) {
        const detail = await http<StoreProductDetail>(
          running.baseUrl,
          "GET",
          `/store/products/${product.slug}`,
        );
        expect(detail.body.availability, product.slug).toBe("in_stock");
        expect(detail.body.variants.map((variant) => variant.availability)).toEqual(["in_stock"]);
      }
      const tracked = await pool.query<{ track_inventory: boolean; levels: number }>(
        `select v.track_inventory, (select count(*)::int from inventory_level l where l.variant_id = v.id) as levels
           from variant v join product p on p.id = v.product_id where p.slug = any($1)`,
        [digital.map((product) => product.slug)],
      );
      expect(tracked.rows).toHaveLength(digital.length);
      expect(tracked.rows.every((row) => !row.track_inventory && row.levels === 0)).toBe(true);
    });

    it("serves the store settings", async () => {
      const config = await http<StoreConfig>(running.baseUrl, "GET", "/store/config");
      expect(config.status).toBe(200);
      expect(config.body.currency).toBe("UAH");
    });

    it("never shows a stock quantity to the public", async () => {
      for (const product of products) {
        const detail = await http(running.baseUrl, "GET", `/store/products/${product.slug}`);
        expect(JSON.stringify(detail.body), product.slug).not.toMatch(
          /onHand|on_hand|reserved|quantity|"stock"/,
        );
      }
    });
  });

  describe("admin inventory (read through the real admin routes)", () => {
    async function adminIds(
      product: SeedProduct,
      commerce: SeedVariantCommerce,
    ): Promise<{ productId: string; variantId: string }> {
      const row = await pool.query<{ id: string }>("select id from product where slug = $1", [
        product.slug,
      ]);
      const productId = row.rows[0]?.id;
      if (productId === undefined) {
        throw new Error(`Product ${product.slug} was not seeded.`);
      }
      const detail = await http<ProductDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/products/${productId}`,
      );
      const variant = detail.body.variants.find(
        (candidate) => keyOfPairs(candidate.optionValues) === variantKey(commerce.optionValues),
      );
      if (variant === undefined) {
        throw new Error(
          `Variant ${variantKey(commerce.optionValues)} of ${product.slug} is missing.`,
        );
      }
      return { productId, variantId: variant.id };
    }

    it("shows the seeded level, a receipt in the journal without an actor, and the flags", async () => {
      for (const product of products) {
        for (const commerce of product.variants) {
          const where = `${product.slug} ${variantKey(commerce.optionValues)}`;
          const { productId, variantId } = await adminIds(product, commerce);
          const base = `/admin/products/${productId}/variants/${variantId}/inventory`;
          const inventory = await http<InventoryResponse>(running.baseUrl, "GET", base);
          const movements = await http<Page<MovementResponse>>(
            running.baseUrl,
            "GET",
            `${base}/movements`,
          );
          expect(inventory.status, where).toBe(200);
          expect(inventory.body.trackInventory, where).toBe(commerce.stock !== undefined);
          expect(inventory.body.allowBackorder, where).toBe(commerce.allowBackorder === true);
          if ((commerce.stock ?? 0) > 0) {
            expect(inventory.body.levels, where).toHaveLength(1);
            expect(inventory.body.levels[0], where).toMatchObject({
              locationCode: "main",
              onHand: commerce.stock,
              reserved: 0,
              available: commerce.stock,
            });
            expect(movements.body.items, where).toHaveLength(1);
            expect(movements.body.items[0], where).toMatchObject({
              kind: "receipt",
              delta: commerce.stock,
              onHandAfter: commerce.stock,
              reason: "Demo seed",
              actorId: null,
            });
          } else {
            expect(inventory.body.levels, where).toEqual([]);
            expect(movements.body.items, where).toEqual([]);
          }
        }
      }
    });
  });

  describe("idempotency", () => {
    it("runs a second time without errors, duplicates or new rows", async () => {
      const before = await tableCounts();
      const demoRows = async () => ({
        price: await seedRowCount("price"),
        inventory_level: await seedRowCount("inventory_level"),
        stock_movement: await seedRowCount("stock_movement"),
      });
      const rowsBefore = await demoRows();
      const second = await runSeedCommand([], env);
      const after = await tableCounts();

      expect(after).toEqual(before);
      // Named explicitly: a second run adds no price, no level and no journal row for the demo variants.
      expect(rowsBefore.price).toBeGreaterThan(0);
      expect(rowsBefore.inventory_level).toBeGreaterThan(0);
      expect(rowsBefore.stock_movement).toBeGreaterThan(0);
      expect(await demoRows()).toEqual(rowsBefore);
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

    it.each(["Production", "PRODUCTION", " production ", "\tProduction\n"])(
      "compares NODE_ENV case-insensitively and trimmed (%j)",
      (nodeEnv) => {
        expect(() => assertSeedAllowed({ NODE_ENV: nodeEnv }, [])).toThrow(/Refusing to seed/);
        expect(() =>
          assertSeedAllowed({ NODE_ENV: nodeEnv }, [ALLOW_PRODUCTION_FLAG]),
        ).not.toThrow();
      },
    );

    it.each([
      "postgres://u:p@127.0.0.1:5432/shop_prod",
      "postgres://u:p@127.0.0.1:5432/fluxkit",
      "postgres://u:p@127.0.0.1:5432/shop_test_backup",
      "postgres://u:p@127.0.0.1:5432/",
      "not a url",
    ])("refuses database %s unless the explicit flag is given", (databaseUrl) => {
      expect(() => assertSeedAllowed({ DATABASE_URL: databaseUrl }, [])).toThrow(
        /Refusing to seed/,
      );
      expect(() =>
        assertSeedAllowed({ DATABASE_URL: databaseUrl }, [ALLOW_PRODUCTION_FLAG]),
      ).not.toThrow();
    });

    it.each(["shop_test", "shop_dev", "shop_demo", "shop_local", "SHOP_DEMO"])(
      "accepts a database named %s in a non-production environment",
      (name) => {
        const databaseUrl = `postgres://u:p@127.0.0.1:5432/${name}?sslmode=disable`;
        expect(() => assertSeedAllowed({ DATABASE_URL: databaseUrl }, [])).not.toThrow();
      },
    );

    it("does not let a safe database name override NODE_ENV=production", () => {
      const env = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://u:p@127.0.0.1:5432/shop_dev",
      };
      expect(() => assertSeedAllowed(env, [])).toThrow(/Refusing to seed/);
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
