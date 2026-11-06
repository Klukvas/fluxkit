import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coffeeCatalogSeed } from "@fluxkit/seeds";
import { runSeedCommand } from "../../seed/seed-command.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { allDocuments, meiliUrl } from "../../test/search-engine.js";
import { SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { removeSeedRows } from "../../test/seed-rows.js";
import { SearchIndexer } from "../indexer/index.js";

/**
 * The coffee demo of `pnpm seed` (the default dataset) with search on: the seed marks every product, the real indexer builds
 * the indexes of the real Meilisearch (scoped key, own prefix), and the demo synonym groups are applied.
 */
const SEED_TIMEOUT = 240_000;

describe("search on the coffee demo (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const variantCount = coffeeCatalogSeed.products.reduce(
    (sum, product) => sum + product.variants.length,
    0,
  );
  let world: SearchWorld;
  let app: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    await removeSeedRows(pool, coffeeCatalogSeed);
    world = await SearchWorld.create("coffee");
    await pool.query("delete from search_index_state");
    await runSeedCommand([], {
      DATABASE_URL: requireTestDatabaseUrl(),
      MEDIA_STORAGE_DRIVER: "none",
      SEARCH_ENABLED: "true",
      MEILI_URL: meiliUrl(),
      MEILI_API_KEY: world.key,
      MEILI_INDEX_PREFIX: world.prefix,
    });
    app = await startApp({
      search: world.env,
      rateLimits: { search: { maxAttempts: 10_000, windowMinutes: 1 } },
    });
    const result = await app.app.get(SearchIndexer).rebuild(new Date(), UNLIMITED_BUDGET);
    expect(result.failures, JSON.stringify(result)).toEqual([]);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    await app?.app.close();
    await world?.dispose(pool);
    await removeSeedRows(pool, coffeeCatalogSeed);
    await pool.end();
  }, SEED_TIMEOUT);

  it("indexes one document per variant of the coffee catalog in each locale", async () => {
    for (const locale of ["uk", "en"]) {
      const documents = await allDocuments(world.liveUid(locale));
      expect(documents, locale).toHaveLength(variantCount);
    }
  });

  it("finds products by a title word and by a demo synonym (кофемашина -> кавомашина)", async () => {
    expect(
      coffeeCatalogSeed.synonymGroups.some((group) => group.terms.includes("кофемашина")),
    ).toBe(true);
    for (const query of ["кавомашина", "кофемашина"]) {
      const found = await http<{ items: { slug: string }[] }>(
        app.baseUrl,
        "GET",
        `/store/search?locale=uk&q=${encodeURIComponent(query)}&limit=24`,
      );
      expect(found.status, JSON.stringify(found.body)).toBe(200);
      expect(
        found.body.items.map((item) => item.slug),
        query,
      ).toContain("espresso-machine-1-group");
    }
  });
});
