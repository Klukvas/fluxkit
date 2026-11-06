import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coffeeCatalogSeed, type SeedCategory } from "@fluxkit/seeds";
import type { Page } from "../common/pagination.js";
import type { StoreProductDetail, StoreProductListItem } from "../catalog/store/store.schemas.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { http } from "../test/http.js";
import { filesUnder, TEST_MEDIA_BASE_URL } from "../test/media-app.js";
import { ensureMigrated } from "../test/migrate.js";
import { removeSeedRows } from "../test/seed-rows.js";
import { formatSummary, runSeedCommand } from "./seed-command.js";

/**
 * The coffee demo of `pnpm seed` (the default dataset) through the real runner: real app module, real Postgres, real media
 * service. The test fixture dataset has its own spec (`seed.spec.ts`); search on the coffee catalog:
 * `src/search/store/coffee-demo-search.spec.ts`.
 */

const { products, categories, banners } = coffeeCatalogSeed;
const slugs = products.map((product) => product.slug);
const variantCount = products.reduce((sum, product) => sum + product.variants.length, 0);
const mediaCount = products.reduce((sum, product) => sum + product.media.length, 0);
const bannerUploads = banners.reduce(
  (sum, banner) => sum + 1 + (banner.localeImages ?? []).length,
  0,
);
const categoryCount = (function count(nodes: readonly SeedCategory[]): number {
  return nodes.reduce((sum, node) => sum + 1 + count(node.children ?? []), 0);
})(categories);
/** The seed runs a few hundred admin writes and about a hundred uploads. */
const SEED_TIMEOUT = 240_000;

describe("coffee demo seed (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const env: Record<string, string> = {
    DATABASE_URL: requireTestDatabaseUrl(),
    MEDIA_STORAGE_DRIVER: "local",
    MEDIA_PUBLIC_BASE_URL: TEST_MEDIA_BASE_URL,
  };
  let mediaDir: string;
  let running: RunningApp;

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

  beforeAll(async () => {
    await ensureMigrated();
    mediaDir = await mkdtemp(join(tmpdir(), "fluxkit-seed-coffee-"));
    env["MEDIA_DIR"] = mediaDir;
    await removeSeedRows(pool, coffeeCatalogSeed);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    await running?.app.close();
    await removeSeedRows(pool, coffeeCatalogSeed);
    await pool.end();
    await rm(mediaDir, { recursive: true, force: true });
  }, SEED_TIMEOUT);

  it(
    "is the default dataset: pnpm seed without --dataset creates the whole coffee catalog with its pictures",
    async () => {
      const summary = await runSeedCommand([], env);
      expect(summary.created.products).toBe(products.length);
      expect(summary.created.categories).toBe(categoryCount);
      expect(summary.created.brands).toBe(coffeeCatalogSeed.brands.length);
      expect(summary.created.banners).toBe(banners.length);
      expect(summary.variantsCreated).toBe(variantCount);
      expect(summary.images).toEqual({
        uploadsEnabled: true,
        uploaded: mediaCount + bannerUploads,
        existingWithoutImages: [],
      });
      expect(formatSummary(summary, "coffee")).toMatch(/^Seed finished \(dataset coffee\)\./);
      expect(await filesUnder(mediaDir)).toHaveLength(mediaCount + bannerUploads);
      running = await startApp({
        mediaStorageDriver: "local",
        mediaDir,
        mediaPublicBaseUrl: TEST_MEDIA_BASE_URL,
      });
    },
    SEED_TIMEOUT,
  );

  it("stores the systematic SKUs of the data on the variants", async () => {
    const rows = await pool.query<{ sku: string }>(
      "select v.sku from variant v join product p on p.id = v.product_id where p.slug = any($1)",
      [slugs],
    );
    const expected = products.flatMap((product) => product.variants.map((variant) => variant.sku));
    expect(rows.rows.map((row) => row.sku).sort()).toEqual([...expected].sort());
  });

  it("lists every product in the store, published and priced, without internal attributes", async () => {
    // One list per coffee brand (the shared test database may hold other specs' products): every coffee product, each
    // under its own brand, and nothing else under these brands.
    const listed: string[] = [];
    for (const brand of coffeeCatalogSeed.brands) {
      const expected = products.filter((product) => product.brandSlug === brand.slug);
      expect(expected.length, brand.slug).toBeLessThanOrEqual(100);
      const list = await http<Page<StoreProductListItem>>(
        running.baseUrl,
        "GET",
        `/store/products?brand=${brand.slug}&locale=uk&limit=100`,
      );
      expect(list.status, brand.slug).toBe(200);
      expect(list.body.total, brand.slug).toBe(expected.length);
      expect(list.body.items.map((item) => item.slug).sort(), brand.slug).toEqual(
        expected.map((product) => product.slug).sort(),
      );
      listed.push(...list.body.items.map((item) => item.slug));
    }
    expect(listed.sort()).toEqual([...slugs].sort());
    const machine = await http<StoreProductDetail>(
      running.baseUrl,
      "GET",
      "/store/products/espresso-machine-1-group?locale=en",
    );
    expect(machine.status).toBe(200);
    expect(JSON.stringify(machine.body)).not.toContain("SUP-CW");
    expect(machine.body.media).toHaveLength(2);
  });

  it("shows the stock states: a sold-out product, a low-stock one, a backorder one", async () => {
    const detail = async (slug: string): Promise<StoreProductDetail> =>
      (await http<StoreProductDetail>(running.baseUrl, "GET", `/store/products/${slug}?locale=uk`))
        .body;
    expect((await detail("grinder-blade")).availability).toBe("out_of_stock");
    expect((await detail("espresso-machine-2-group")).availability).toBe("low_stock");
    // Stock 0 with backorder: sold beyond stock, so not out of stock.
    expect((await detail("espresso-machine-1-group")).availability).not.toBe("out_of_stock");
  });

  it(
    "is idempotent: a second run creates nothing and writes no row",
    async () => {
      const before = await tableCounts();
      const second = await runSeedCommand(["--dataset", "coffee"], env);
      expect(second.created.products).toBe(0);
      expect(second.existing.products).toBe(products.length);
      expect(second.created.banners).toBe(0);
      expect(second.images.uploaded).toBe(0);
      expect(await tableCounts()).toEqual(before);
    },
    SEED_TIMEOUT,
  );

  it(
    "with MEDIA_STORAGE_DRIVER=none creates the products without pictures and no banner",
    async () => {
      await running.app.close();
      await removeSeedRows(pool, coffeeCatalogSeed);
      const summary = await runSeedCommand(["--dataset=coffee"], {
        DATABASE_URL: requireTestDatabaseUrl(),
        MEDIA_STORAGE_DRIVER: "none",
      });
      expect(summary.created.products).toBe(products.length);
      expect(summary.created.banners).toBe(0);
      expect(summary.images).toEqual({
        uploadsEnabled: false,
        uploaded: 0,
        existingWithoutImages: [],
      });
    },
    SEED_TIMEOUT,
  );
});
