import { SEARCH_DOCUMENT_VERSION } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DRIZZLE, PG_POOL, type Database } from "../../database/database.module.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { insertAdminUserRow, ownerAuthenticator } from "../../test/inventory-fixtures.js";
import { createListingFixture, type ListingFixture } from "../../test/listing-fixture.js";
import { ensureMigrated } from "../../test/migrate.js";
import { allDocuments, indexSettings, listIndexUids } from "../../test/search-engine.js";
import { budgetOf, SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { SearchEngine } from "../engine/index.js";
import { SearchIndexer } from "../indexer/index.js";
import { SearchIndexStateRepository } from "../indexer/search-index-state.repository.js";
import { SearchQueueRepository } from "../queue/search-queue.repository.js";
import { SEARCH_ENGINE } from "../search.module.js";
import type { StoreSearchResponse } from "./store-search.schemas.js";

describe("listing search v5 (real Postgres, Redis and Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let fx: ListingFixture;
  let world: SearchWorld;
  let app: RunningApp;
  let indexer: SearchIndexer;
  let engine: SearchEngine;
  let adminId: string;
  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    fx = await createListingFixture(pool);
    world = await SearchWorld.create("listing");
    adminId = await insertAdminUserRow(pool);
    app = await startApp({
      search: world.env,
      adminAuthenticator: ownerAuthenticator(adminId),
      rateLimits: { search: { maxAttempts: 10000, windowMinutes: 1 } },
    });
    indexer = world.indexer(app.app.get<Database>(DRIZZLE));
    engine = app.app.get<SearchEngine>(SEARCH_ENGINE);
    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      swapped: 2,
      failures: [],
    });
  }, 120000);
  afterAll(async () => {
    await fx?.cleanup();
    await world?.dispose(pool);
    await app?.app.close();
    if (adminId !== undefined) await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });
  const url = (extra = "", mode = "listing") =>
    `/store/search?groupBy=${mode}&f=brand:${fx.brandSlug}${extra}`;
  async function search(extra = "", mode = "listing") {
    const result = await http<StoreSearchResponse>(app.baseUrl, "GET", url(extra, mode));
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  }
  async function setSplit(enabled: boolean) {
    const result = await http(
      app.baseUrl,
      "PUT",
      `/admin/product-types/${fx.splitType}/options/${fx.colorId}`,
      { body: { splitsListing: enabled } },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }
  async function sync() {
    // Postgres keeps microseconds; this test tick must include the just-committed marks.
    const result = await indexer.sync(new Date(Date.now() + 1000), UNLIMITED_BUDGET);
    expect(result).toMatchObject({ paused: false, failures: [] });
    return result;
  }
  async function splitDocuments(locale = "uk") {
    return (await allDocuments(world.liveUid(locale))).filter(
      (doc) => doc["productId"] === fx.splitProduct,
    );
  }

  /** Replaces documents AND applied settings with the pre-listing v3 format on the real engine. */
  async function makeV3Index(uid: string) {
    const documents = (await allDocuments(uid)).map((doc) =>
      Object.fromEntries(Object.entries(doc).filter(([key]) => key !== "listingKey")),
    );
    if (documents.length > 0)
      await engine.waitForTask(await engine.addDocuments(uid, documents), 10000);
    const settings = await indexSettings(uid);
    for (const field of ["filterableAttributes", "sortableAttributes", "displayedAttributes"])
      await engine.waitForTask(
        await engine.updateSettings(uid, {
          [field]: (settings[field] as string[]).filter((name) => name !== "listingKey"),
        }),
        10000,
      );
    expect((await allDocuments(uid)).every((doc) => !("listingKey" in doc))).toBe(true);
    const applied = await indexSettings(uid);
    for (const field of ["filterableAttributes", "sortableAttributes", "displayedAttributes"])
      expect(applied[field]).not.toContain("listingKey");
  }

  async function assertLiveCurrent() {
    for (const locale of ["uk", "en"]) {
      const documents = await allDocuments(world.liveUid(locale));
      expect(documents.length).toBeGreaterThan(0);
      expect(documents.every((doc) => typeof doc["listingKey"] === "string")).toBe(true);
    }
    expect(
      (await pool.query("select document_version, build_index_uid from search_index_state")).rows,
    ).toEqual([
      { document_version: SEARCH_DOCUMENT_VERSION, build_index_uid: null },
      { document_version: SEARCH_DOCUMENT_VERSION, build_index_uid: null },
    ]);
    expect((await search("", "product")).total).toBe(3);
    expect((await search()).total).toBe(4);
  }

  it("keeps one document per variant with type-local keys, group totals and counted facets", async () => {
    const documents = await allDocuments(world.liveUid("uk"));
    expect(
      documents
        .filter((doc) => doc["productId"] === fx.splitProduct)
        .map((doc) => doc["listingKey"])
        .sort(),
    ).toEqual([
      `${fx.splitProduct}:${fx.colorCode}:blue`,
      `${fx.splitProduct}:${fx.colorCode}:blue`,
      `${fx.splitProduct}:${fx.colorCode}:red`,
      `${fx.splitProduct}:${fx.colorCode}:red`,
    ]);
    expect(
      documents
        .filter((doc) => doc["productId"] === fx.plainProduct)
        .every((doc) => doc["listingKey"] === fx.plainProduct),
    ).toBe(true);
    const result = await search();
    expect(result.total).toBe(4);
    expect(new Set(result.items.map((item) => item.listingKey)).size).toBe(4);
    expect((await search("", "product")).total).toBe(3);
    const brand = result.facets.find((facet) => facet.key === "brand");
    expect(brand?.values.find((value) => value.code === fx.brandSlug)?.count).toBe(4);
    const colors = result.facets.find((facet) => facet.key === `opt.${fx.colorCode}`);
    expect(colors?.counted).toBe(false);
    expect(colors?.values.map((value) => [value.code, value.count])).toEqual([
      ["blue", null],
      ["red", null],
    ]);
    expect(result.price).toEqual({ min: 0, max: 4500 });
  });

  it("removes corrupt split products from documents, listing totals and facets and restores repaired text", async () => {
    const saved = await pool.query<{ title: object }>("select title from product where id = $1", [
      fx.splitProduct,
    ]);
    try {
      await pool.query("update product set title = $2::jsonb where id = $1", [
        fx.splitProduct,
        JSON.stringify({ uk: " ", en: "\t\u00a0" }),
      ]);
      // A full rebuild must omit all sibling listing documents even without a queue mark.
      await pool.query("update search_index_state set rebuild_requested_at = now()");
      expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
        swapped: 2,
        failures: [],
      });
      for (const locale of ["uk", "en"]) expect(await splitDocuments(locale)).toEqual([]);
      const result = await search();
      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).not.toContain(fx.splitProduct);
      expect(
        result.facets
          .find((facet) => facet.key === "brand")
          ?.values.find((value) => value.code === fx.brandSlug)?.count,
      ).toBe(2);
    } finally {
      await pool.query("update product set title = $2::jsonb where id = $1", [
        fx.splitProduct,
        JSON.stringify(saved.rows[0]?.title),
      ]);
      await pool.query("update search_index_state set rebuild_requested_at = now()");
      expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
        swapped: 2,
        failures: [],
      });
    }
    expect((await search()).total).toBe(4);
    expect(await splitDocuments()).toHaveLength(4);
  });

  it("keeps same-SKU intersections, disjunctive values and group-local matches separate from the group offer", async () => {
    const result = await search(`&f=opt.${fx.sizeCode}:m&f=opt.${fx.colorCode}:red&price=..2000`);
    expect(result.total).toBe(2);
    const split = result.items.find((item) => item.id === fx.splitProduct);
    expect(split).toMatchObject({
      defaultVariantId: null,
      listingOption: { valueCode: "red" },
      price: { from: 0, to: 1200 },
      match: { variantCount: 1, price: { from: 1200, to: 1200 } },
    });
    const small = await search(`&f=opt.${fx.sizeCode}:s`);
    const blue = small.items.find(
      (item) => item.id === fx.splitProduct && item.listingOption?.valueCode === "blue",
    );
    expect(blue?.match).toMatchObject({ variantCount: 1, price: { from: 3000, to: 3000 } });
    const impossible = await search(
      `&f=opt.${fx.sizeCode}:s&f=opt.${fx.colorCode}:blue&price=..2000`,
    );
    expect(impossible.total).toBe(0);
    expect(impossible.items).toEqual([]);
  });

  it("matches SQL newest order and deterministic equal-price ordering, paging every group exactly once", async () => {
    const sql = await http<{ items: { listingKey: string }[] }>(
      app.baseUrl,
      "GET",
      `/store/products?brand=${fx.brandSlug}&groupBy=listing`,
    );
    const newest = await search();
    expect(newest.items.map((item) => item.listingKey)).toEqual(
      sql.body.items.map((item) => item.listingKey),
    );
    const pages = await Promise.all([1, 2, 3, 4].map((page) => search(`&limit=1&page=${page}`)));
    expect(pages.flatMap((page) => page.items.map((item) => item.listingKey))).toEqual(
      newest.items.map((item) => item.listingKey),
    );
    // Equal group prices use the same product/key order, whichever variant represents each group.
    await pool.query(
      "update price set amount = 800 where currency = 'UAH' and variant_id = any($1::uuid[])",
      [fx.variants.map((variant) => variant.id)],
    );
    await pool.query(
      "insert into search_sync_queue (product_id, reason) select id, 'price_changed' from product where brand_id = $1 on conflict (product_id) do nothing",
      [fx.brandId],
    );
    await sync();
    for (const sort of ["price_asc", "price_desc"]) {
      expect((await search(`&sort=${sort}`)).items.map((item) => item.listingKey)).toEqual(
        newest.items.map((item) => item.listingKey),
      );
    }
    for (const variant of fx.variants)
      await pool.query("update price set amount = $2 where variant_id = $1 and currency = 'UAH'", [
        variant.id,
        variant.amount,
      ]);
    await pool.query(
      "insert into search_sync_queue (product_id, reason) select id, 'price_changed' from product where brand_id = $1 on conflict (product_id) do nothing",
      [fx.brandId],
    );
    await sync();
  });

  it("uses listing distinct in strict and relaxed federation without increasing engine request cost", async () => {
    const spy = vi.spyOn(SearchEngine.prototype, "multiSearch");
    try {
      for (const [extra, expectedCalls] of [
        ["", 1],
        ["&q=shirt&locale=en", 2],
        [`&q=${encodeURIComponent("сорочку неіснуючеслово")}`, 6],
      ] as const) {
        spy.mockClear();
        await search(extra);
        // brand selection adds its disjunctive query. Ukrainian has three planned queries in both passes.
        expect(spy.mock.calls.length).toBe(expectedCalls);
        for (const [body] of spy.mock.calls) {
          const request = body as {
            federation?: { distinct?: string };
            queries: { distinct?: string }[];
          };
          if (request.federation?.distinct !== undefined)
            expect(request.federation.distinct).toBe("listingKey");
          for (const query of request.queries)
            if (query.distinct !== undefined) expect(query.distinct).toBe("listingKey");
        }
      }
    } finally {
      spy.mockRestore();
    }
    // Real matching text through Ukrainian federation, with the same four groups.
    const result = await search(`&q=${encodeURIComponent(fx.title)}`);
    expect(result.total).toBe(4);
    expect((await search(`&q=${encodeURIComponent(fx.title)}%20qqqq`)).relaxed).toBe(true);
  });

  it("hydrates current prices and stock, and keeps match null when a surviving group stops fitting", async () => {
    const blueSmall = fx.variants.find(
      (v) => v.productId === fx.splitProduct && v.color === "blue" && v.size === "s",
    );
    await pool.query("update price set amount = 9000 where variant_id = $1 and currency = 'UAH'", [
      blueSmall?.id,
    ]);
    await pool.query("update variant set track_inventory = false where id = $1", [blueSmall?.id]);
    const result = await search(`&f=opt.${fx.sizeCode}:s&price=2000..4000`);
    const blue = result.items.find((item) => item.id === fx.splitProduct);
    expect(blue).toMatchObject({
      listingOption: { valueCode: "blue" },
      price: { from: 4500, to: 9000 },
      availability: "in_stock",
      match: null,
    });
    expect(
      (
        await pool.query("select reason from search_sync_queue where product_id = $1", [
          fx.splitProduct,
        ])
      ).rows,
    ).toEqual([{ reason: "stale_hit" }]);
    await pool.query("update price set amount = 3000 where variant_id = $1 and currency = 'UAH'", [
      blueSmall?.id,
    ]);
    await pool.query("update variant set track_inventory = true where id = $1", [blueSmall?.id]);
    await sync();
  });

  it("drops stale split groups and queues stale_hit when a flag is disabled, never substituting a base card", async () => {
    await setSplit(false);
    await pool.query("delete from search_sync_queue");
    const result = await search();
    expect(result.items.filter((item) => item.id === fx.splitProduct)).toEqual([]);
    expect(result.total).toBe(4);
    expect(
      (
        await pool.query("select reason from search_sync_queue where product_id = $1", [
          fx.splitProduct,
        ])
      ).rows,
    ).toEqual([{ reason: "stale_hit" }]);
    await sync();
    expect((await search()).total).toBe(3);
    await setSplit(true);
    await sync();
    expect((await search()).total).toBe(4);
  });

  it("reads flags after claiming queue rows and retains a newer change_seq during sync", async () => {
    await setSplit(false);
    const original = SearchQueueRepository.prototype.claimDue;
    const claim = vi
      .spyOn(SearchQueueRepository.prototype, "claimDue")
      .mockImplementationOnce(async function (this: SearchQueueRepository, ...args) {
        const claimed = await original.apply(this, args);
        await setSplit(true);
        return claimed;
      });
    try {
      await sync();
    } finally {
      claim.mockRestore();
    }
    expect(
      (await splitDocuments()).every(
        (doc) => typeof doc["listingKey"] === "string" && doc["listingKey"] !== fx.splitProduct,
      ),
    ).toBe(true);
    expect(
      (await pool.query("select 1 from search_sync_queue where product_id = $1", [fx.splitProduct]))
        .rowCount,
    ).toBe(1);
    await sync();
    expect(
      (await pool.query("select 1 from search_sync_queue where product_id = $1", [fx.splitProduct]))
        .rowCount,
    ).toBe(0);
  });

  it("retains flag changes made during a paused rebuild and reapplies them after swap", async () => {
    await pool.query("update search_index_state set rebuild_requested_at = now()");
    expect(await indexer.rebuild(new Date(), budgetOf(1))).toMatchObject({
      truncated: true,
      swapped: 0,
      failures: [],
    });
    await setSplit(false);
    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      swapped: 2,
      failures: [],
    });
    await sync();
    for (const locale of ["uk", "en"])
      expect((await splitDocuments(locale)).map((doc) => doc["listingKey"])).toEqual(
        Array.from({ length: 4 }, () => fx.splitProduct),
      );
    await setSplit(true);
    await sync();
  });

  it("keeps product search available on a real v3 live index until the v5 rebuild enables listing search", async () => {
    for (const locale of ["uk", "en"]) await makeV3Index(world.liveUid(locale));
    await pool.query("update search_index_state set document_version = 3");
    const refused = await http<ProblemBody>(app.baseUrl, "GET", url());
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe("search_unavailable");
    expect((await search("", "product")).total).toBe(3);
    const sql = await http<{ total: number }>(
      app.baseUrl,
      "GET",
      `/store/products?brand=${fx.brandSlug}&groupBy=listing`,
    );
    expect(sql.status).toBe(200);
    expect(sql.body.total).toBe(4);
    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      started: 2,
      swapped: 2,
      failures: [],
    });
    await assertLiveCurrent();
  });

  it("fences overlapping runs at the same completed v5 build so they cannot swap v3 back in", async () => {
    for (const locale of ["uk", "en"]) await makeV3Index(world.liveUid(locale));
    await pool.query("update search_index_state set document_version = 3");
    const now = new Date(Date.now() + 2000);
    // Finish both locales' documents, but leave their builds recorded for two independent runs to resume.
    expect(await indexer.rebuild(now, budgetOf(3))).toMatchObject({
      truncated: true,
      swapped: 0,
      failures: [],
    });
    const builds = await pool.query<{ locale: string; build_index_uid: string }>(
      "select locale, build_index_uid from search_index_state",
    );
    for (const state of builds.rows) {
      const live = await allDocuments(world.liveUid(state.locale));
      const build = await allDocuments(state.build_index_uid);
      expect(live.length).toBeGreaterThan(0);
      expect(build).toHaveLength(live.length);
      expect(live.every((doc) => !("listingKey" in doc))).toBe(true);
      expect(build.every((doc) => typeof doc["listingKey"] === "string")).toBe(true);
    }
    const firstCaptured = swapGate();
    const secondCaptured = swapGate();
    const releaseFirst = swapGate();
    const releaseSecond = swapGate();
    const winnerSwapped = swapGate();
    const releaseCompletion = swapGate();
    const originalMark = SearchIndexStateRepository.prototype.markSwapPending;
    const originalComplete = SearchIndexStateRepository.prototype.completeSwap;
    const mark = vi
      .spyOn(SearchIndexStateRepository.prototype, "markSwapPending")
      .mockImplementationOnce(async function (this: SearchIndexStateRepository, ...args) {
        firstCaptured.resolve();
        await releaseFirst.promise;
        return originalMark.apply(this, args);
      })
      .mockImplementationOnce(async function (this: SearchIndexStateRepository, ...args) {
        secondCaptured.resolve();
        await releaseSecond.promise;
        return originalMark.apply(this, args);
      });
    const completion = vi
      .spyOn(SearchIndexStateRepository.prototype, "completeSwap")
      .mockImplementationOnce(async function (this: SearchIndexStateRepository, ...args) {
        winnerSwapped.resolve();
        await releaseCompletion.promise;
        return originalComplete.apply(this, args);
      });
    const swap = vi.spyOn(SearchEngine.prototype, "swapIndexes");
    const runs: Promise<unknown>[] = [];
    try {
      const first = world.indexer(app.app.get<Database>(DRIZZLE)).rebuild(now, UNLIMITED_BUDGET);
      runs.push(first);
      await firstCaptured.promise;
      const second = world.indexer(app.app.get<Database>(DRIZZLE)).rebuild(now, UNLIMITED_BUDGET);
      runs.push(second);
      await secondCaptured.promise;
      releaseFirst.resolve();
      await winnerSwapped.promise;
      // The loser already captured the same builds. Resume it after the engine swap, before DB completion/cleanup.
      releaseSecond.resolve();
      const lost = await second;
      releaseCompletion.resolve();
      const won = await first;
      expect(swap).toHaveBeenCalledTimes(1);
      expect(lost).toMatchObject({ swapped: 0, failures: [] });
      expect(won).toMatchObject({ swapped: 2, failures: [] });
      expect(completion).toHaveBeenCalledTimes(1);
      await assertLiveCurrent();
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      releaseCompletion.resolve();
      await Promise.allSettled(runs);
      mark.mockRestore();
      completion.mockRestore();
      swap.mockRestore();
    }
  });

  it("fences a claimed run after recovery rebuilds in the same second and swaps before completion", async () => {
    for (const locale of ["uk", "en"]) await makeV3Index(world.liveUid(locale));
    await pool.query("update search_index_state set document_version = 3");
    // Identical run-start times must still produce different build generations.
    const now = new Date(Date.now() + 2000);
    const firstClaimed = swapGate();
    const releaseFirst = swapGate();
    const recoveredSwapped = swapGate();
    const releaseCompletion = swapGate();
    const originalMark = SearchIndexStateRepository.prototype.markSwapPending;
    const originalComplete = SearchIndexStateRepository.prototype.completeSwap;
    const mark = vi
      .spyOn(SearchIndexStateRepository.prototype, "markSwapPending")
      .mockImplementationOnce(async function (this: SearchIndexStateRepository, ...args) {
        const claimed = await originalMark.apply(this, args);
        expect(claimed).toBe(true);
        firstClaimed.resolve();
        await releaseFirst.promise;
        return claimed;
      });
    const completion = vi
      .spyOn(SearchIndexStateRepository.prototype, "completeSwap")
      .mockImplementationOnce(async function (this: SearchIndexStateRepository, ...args) {
        recoveredSwapped.resolve();
        await releaseCompletion.promise;
        return originalComplete.apply(this, args);
      });
    const runs: Promise<unknown>[] = [];
    try {
      const first = world.indexer(app.app.get<Database>(DRIZZLE)).rebuild(now, UNLIMITED_BUDGET);
      runs.push(first);
      await firstClaimed.promise;
      const claimed = await pool.query<{ locale: string; build_index_uid: string }>(
        "select locale, build_index_uid from search_index_state where build_rebuild_key is null",
      );
      expect(claimed.rows).toHaveLength(2);
      const recovered = world
        .indexer(app.app.get<Database>(DRIZZLE))
        .rebuild(now, UNLIMITED_BUDGET);
      runs.push(recovered);
      await recoveredSwapped.promise;
      const pending = await pool.query<{
        locale: string;
        build_index_uid: string;
        build_rebuild_key: string | null;
        document_version: number;
      }>(
        "select locale, build_index_uid, build_rebuild_key, document_version from search_index_state order by locale",
      );
      for (const state of pending.rows) {
        const live = await allDocuments(world.liveUid(state.locale));
        const old = await allDocuments(state.build_index_uid);
        expect(live.length).toBeGreaterThan(0);
        expect(old).toHaveLength(live.length);
        expect(live.every((doc) => typeof doc["listingKey"] === "string")).toBe(true);
        expect(old.every((doc) => !("listingKey" in doc))).toBe(true);
        expect(state.document_version).toBe(3);
        expect(state.build_rebuild_key).toBeNull();
      }
      releaseFirst.resolve();
      // A's stale swap must not change the live documents or complete B's generation, even with equal counts.
      expect(await first).toMatchObject({ swapped: 0, failures: [] });
      expect(
        (
          await pool.query(
            "select locale, build_index_uid, build_rebuild_key, document_version from search_index_state order by locale",
          )
        ).rows,
      ).toEqual(pending.rows);
      for (const state of pending.rows) {
        expect(state.build_index_uid).not.toBe(
          claimed.rows.find((row) => row.locale === state.locale)?.build_index_uid,
        );
        expect(
          (await allDocuments(world.liveUid(state.locale))).every(
            (doc) => typeof doc["listingKey"] === "string",
          ),
        ).toBe(true);
      }
      releaseCompletion.resolve();
      expect(await recovered).toMatchObject({ started: 2, swapped: 2, failures: [] });
      await assertLiveCurrent();
      expect(await listIndexUids(world.prefix)).toEqual(
        [world.liveUid("en"), world.liveUid("uk")].sort(),
      );
    } finally {
      releaseFirst.resolve();
      releaseCompletion.resolve();
      await Promise.allSettled(runs);
      mark.mockRestore();
      completion.mockRestore();
    }
  });

  it("rebuilds safely after the engine swaps v5 in but Postgres completion fails", async () => {
    for (const locale of ["uk", "en"]) await makeV3Index(world.liveUid(locale));
    await pool.query("update search_index_state set document_version = 3");
    const now = new Date(Date.now() + 2000);
    const crash = new Error("Test crash before recording the completed swap");
    const completion = vi
      .spyOn(SearchIndexStateRepository.prototype, "completeSwap")
      .mockImplementationOnce(async () => {
        // The engine really swapped: live holds v5 and the build uid now holds v3 with equal document counts.
        const states = await pool.query<{
          locale: string;
          build_index_uid: string;
          document_version: number;
        }>("select locale, build_index_uid, document_version from search_index_state");
        for (const state of states.rows) {
          const live = await allDocuments(world.liveUid(state.locale));
          const old = await allDocuments(state.build_index_uid);
          expect(live.length).toBeGreaterThan(0);
          expect(old).toHaveLength(live.length);
          expect(live.every((doc) => typeof doc["listingKey"] === "string")).toBe(true);
          expect(old.every((doc) => !("listingKey" in doc))).toBe(true);
          expect(state.document_version).toBe(3);
        }
        throw crash;
      });
    try {
      await expect(indexer.rebuild(now, UNLIMITED_BUDGET)).rejects.toThrow(crash);
    } finally {
      completion.mockRestore();
    }
    const refused = await http<ProblemBody>(app.baseUrl, "GET", url());
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe("search_unavailable");
    expect((await search("", "product")).total).toBe(3);
    // A fresh process has only persisted state, not knowledge of the successful engine swap.
    const recovered = world.indexer(app.app.get<Database>(DRIZZLE));
    expect(await recovered.rebuild(new Date(now.getTime() + 2000), UNLIMITED_BUDGET)).toMatchObject(
      {
        started: 2,
        swapped: 2,
        failures: [],
      },
    );
    await assertLiveCurrent();
  });

  it("leaves a lost batch claim unchanged and refuses completion for an unclaimed or replaced build", async () => {
    for (const locale of ["uk", "en"]) await makeV3Index(world.liveUid(locale));
    await pool.query("update search_index_state set document_version = 3");
    const now = new Date(Date.now() + 2000);
    expect(await indexer.rebuild(now, budgetOf(3))).toMatchObject({
      truncated: true,
      failures: [],
    });
    const database = app.app.get<Database>(DRIZZLE);
    const states = new SearchIndexStateRepository();
    const before = await states.loadAll(database);
    const builds = [...before.values()].map((state) => {
      if (state.buildIndexUid === null || state.buildRebuildKey === null)
        throw new Error("Test setup: missing current build");
      return {
        locale: state.locale,
        buildIndexUid: state.buildIndexUid,
        buildRebuildKey: state.buildRebuildKey,
        liveIndexUid: world.liveUid(state.locale),
        settingsHash: "test-completion",
        documentVersion: SEARCH_DOCUMENT_VERSION,
        currency: "UAH",
        documentsCount: state.buildDocumentsCount,
      };
    });
    // The other locale still matches: a failed batch must not consume even that locale's key.
    for (const field of ["buildIndexUid", "buildRebuildKey"] as const) {
      const mismatched = builds.map((build, index) =>
        index === 0 ? { ...build, [field]: `${build[field]}_stale` } : build,
      );
      expect(await states.markSwapPending(database, mismatched, now)).toBe(false);
      expect(await states.loadAll(database)).toEqual(before);
    }
    expect(await states.completeSwap(database, builds, now)).toEqual([]);
    expect(await states.loadAll(database)).toEqual(before);
    expect(await states.markSwapPending(database, builds, now)).toBe(true);
    const pending = await states.loadAll(database);
    expect([...pending.values()].every((state) => state.buildRebuildKey === null)).toBe(true);
    expect(await states.markSwapPending(database, builds, now)).toBe(false);
    expect(
      await states.completeSwap(
        database,
        builds.map((build) => ({
          ...build,
          buildIndexUid: `${build.buildIndexUid}_stale`,
        })),
        now,
      ),
    ).toEqual([]);
    expect(await states.loadAll(database)).toEqual(pending);
    expect([...pending.values()].every((state) => state.documentVersion === 3)).toBe(true);
    // Pending without a recorded engine outcome still takes the conservative serialized-crash recovery path.
    expect(await indexer.rebuild(new Date(now.getTime() + 2000), UNLIMITED_BUDGET)).toMatchObject({
      started: 2,
      swapped: 2,
      failures: [],
    });
    await assertLiveCurrent();
  });

  it("restarts an inherited paused v3 build and never labels its old documents as v5", async () => {
    await pool.query("update search_index_state set rebuild_requested_at = now()");
    // A real paused build after its first page, then the on-disk state/documents of a pre-upgrade v3 process.
    const now = new Date(Date.now() + 2000);
    expect(await indexer.rebuild(now, budgetOf(1))).toMatchObject({
      truncated: true,
      failures: [],
    });
    const builds = (
      await pool.query<{ build_index_uid: string }>(
        "select build_index_uid from search_index_state",
      )
    ).rows.map((row) => row.build_index_uid);
    expect(
      (await Promise.all(builds.map((uid) => allDocuments(uid)))).flat().length,
    ).toBeGreaterThan(0);
    for (const uid of builds) await makeV3Index(uid);
    await pool.query(
      "update search_index_state set document_version = 3, build_rebuild_key = null",
    );
    expect(await indexer.rebuild(new Date(now.getTime() + 2000), UNLIMITED_BUDGET)).toMatchObject({
      started: 2,
      swapped: 2,
      failures: [],
    });
    const remaining = await listIndexUids(world.prefix);
    for (const uid of builds) expect(remaining).not.toContain(uid);
    await assertLiveCurrent();
  });

  it("requires applied filterable, sortable and displayed listing fields even on a live v5 locale", async () => {
    const uid = world.liveUid("uk");
    const fields = ["filterableAttributes", "sortableAttributes", "displayedAttributes"] as const;
    const original = {
      filterableAttributes: await engine.filterableAttributes(uid),
      sortableAttributes: await engine.sortableAttributes(uid),
      displayedAttributes: await engine.displayedAttributes(uid),
    };
    for (const field of fields) {
      const cold = await startApp({ search: world.env });
      try {
        await engine.waitForTask(
          await engine.updateSettings(uid, {
            [field]: original[field].filter((name) => name !== "listingKey"),
          }),
          10000,
        );
        const result = await http<ProblemBody>(cold.baseUrl, "GET", url());
        expect(result.status, field).toBe(503);
        expect(result.body.code).toBe("search_unavailable");
        expect((await http(cold.baseUrl, "GET", url("", "product"))).status).toBe(200);
      } finally {
        await engine.waitForTask(
          await engine.updateSettings(uid, { [field]: original[field] }),
          10000,
        );
        await cold.app.close();
      }
    }
  });

  it("keeps hydration statements bounded for one or several sibling groups and rejects invalid grouping", async () => {
    async function count(limit: number) {
      const spy = vi.spyOn(app.app.get<pg.Pool>(PG_POOL), "query");
      try {
        await search(`&limit=${limit}&f=opt.${fx.sizeCode}:s`);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }
    expect(await count(1)).toBe(await count(48));
    const bad = await http<ProblemBody>(app.baseUrl, "GET", "/store/search?groupBy=unknown");
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toContainEqual(
      expect.objectContaining({ path: "groupBy", code: "invalid_value" }),
    );
  });
});

/** A test-only pause at an engine/database boundary; the actual calls still run against the real services. */
function swapGate(): { promise: Promise<void>; resolve: () => void } {
  let release: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    resolve: () => release(),
  };
}
