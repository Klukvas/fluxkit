import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogSeed, type SeedCategory } from "@fluxkit/seeds";
import type { Page } from "../../common/pagination.js";
import type { StoreProductListItem } from "../../catalog/store/store.schemas.js";
import { runSeedCommand } from "../../seed/seed-command.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { removeSeedRows } from "../../test/seed-rows.js";
import { SearchIndexer } from "../indexer/index.js";

function allCategories(tree: readonly SeedCategory[]): SeedCategory[] {
  return tree.flatMap((node) => [node, ...allCategories(node.children ?? [])]);
}

type Lists = { list: string; sql: string[]; search: string[] }[];

/**
 * "Newest first" is one order whichever path lists it (search finish review F2): the SQL listing orders by
 * `published_at desc, id desc`, and the search index must give the same order on the seeded demo catalog (its products
 * are published within one second) and for products published at the same instant. Real Postgres, the real seed, the
 * real Meilisearch with a scoped key, the index built by the real indexer.
 */
describe("newest first through search equals the SQL listing (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const slugs = catalogSeed.products.map((product) => product.slug);
  let world: SearchWorld;
  let app: RunningApp;

  async function rebuildIndex(): Promise<void> {
    // The first run builds the missing index; a later one needs an operator's request.
    await pool.query("update search_index_state set rebuild_requested_at = now()");
    const result = await app.app.get(SearchIndexer).rebuild(new Date(), UNLIMITED_BUDGET);
    expect(result.failures, JSON.stringify(result)).toEqual([]);
    expect(result.swapped).toBeGreaterThan(0);
  }

  /** For every demo category and both locales: the slugs of `GET /store/products` and of `GET /store/search`. */
  async function bothOrders(): Promise<Lists> {
    const nodes = allCategories(catalogSeed.categories);
    const rows = await pool.query<{ id: string; slug: string }>(
      "select id, slug from category where slug = any($1) order by slug",
      [nodes.map((node) => node.slug)],
    );
    expect(rows.rows).toHaveLength(nodes.length);
    const lists: Lists = [];
    for (const locale of ["uk", "en"]) {
      for (const row of rows.rows) {
        const sql = await http<Page<StoreProductListItem>>(
          app.baseUrl,
          "GET",
          `/store/products?locale=${locale}&category=${row.slug}&limit=48`,
        );
        expect(sql.status, JSON.stringify(sql.body)).toBe(200);
        const found = await http<{ items: StoreProductListItem[]; sort: string }>(
          app.baseUrl,
          "GET",
          `/store/search?locale=${locale}&f=${encodeURIComponent(`category:${row.id}`)}&limit=48`,
        );
        expect(found.status, JSON.stringify(found.body)).toBe(200);
        expect(found.body.sort).toBe("newest");
        lists.push({
          list: `${locale} ${row.slug}`,
          sql: sql.body.items.map((item) => item.slug),
          search: found.body.items.map((item) => item.slug),
        });
      }
    }
    return lists;
  }

  function expectSameOrder(lists: Lists): void {
    for (const { list, sql, search } of lists) {
      expect(search, list).toEqual(sql);
    }
    // The comparison means something: lists of several products, and every demo product listed.
    expect(lists.filter((entry) => entry.sql.length >= 3).length).toBeGreaterThan(0);
    expect(new Set(lists.flatMap((entry) => entry.sql))).toEqual(new Set(slugs));
  }

  beforeAll(async () => {
    await ensureMigrated();
    await removeSeedRows(pool);
    // No images: this spec reads the order of the list only, and uploads would write into the default MEDIA_DIR.
    await runSeedCommand([], {
      DATABASE_URL: requireTestDatabaseUrl(),
      MEDIA_STORAGE_DRIVER: "none",
    });
    world = await SearchWorld.create("neworder");
    await pool.query("delete from search_index_state");
    app = await startApp({
      search: world.env,
      rateLimits: { search: { maxAttempts: 10_000, windowMinutes: 1 } },
    });
    await rebuildIndex();
  });

  afterAll(async () => {
    await app?.app.close();
    await world?.dispose(pool);
    await removeSeedRows(pool);
    await pool.end();
  });

  it("lists the seeded catalog (published within one second) in the same order in every category and locale", async () => {
    const spread = await pool.query<{ seconds: string }>(
      "select extract(epoch from max(published_at) - min(published_at))::text as seconds from product where slug = any($1)",
      [slugs],
    );
    expect(Number(spread.rows[0]?.seconds)).toBeLessThan(5);
    expectSameOrder(await bothOrders());
  });

  it("breaks a tie of the publish time by the product id, descending, like the SQL listing", async () => {
    await pool.query(
      "update product set published_at = '2026-01-02T03:04:05.678Z' where slug = any($1)",
      [slugs],
    );
    await rebuildIndex();
    const lists = await bothOrders();
    expectSameOrder(lists);
    const ids = await pool.query<{ slug: string }>(
      "select slug from product where slug = any($1) order by id desc",
      [slugs],
    );
    const roots = lists.filter((entry) =>
      catalogSeed.categories.some((root) => entry.list.endsWith(` ${root.slug}`)),
    );
    for (const root of roots) {
      expect(root.search, root.list).toEqual(
        ids.rows.map((row) => row.slug).filter((slug) => root.search.includes(slug)),
      );
    }
  });
});
