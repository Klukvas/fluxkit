import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { withTransaction } from "../../common/transaction.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  caller,
  createCatalogFixture,
  type Call,
  type CatalogFixture,
} from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { insertAdminUserRow, ownerAuthenticator } from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { allDocuments, indexSettings } from "../../test/search-engine.js";
import { budgetOf, SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { StockWorld, type StockedVariant } from "../../test/stock-world.js";
import { SearchQueue } from "../queue/search-queue.js";
import type { SearchIndexer } from "./index.js";

/**
 * Finding F2 of the search measurements at scale (plan `docs/plans/2026-10-31-search-sync-and-settings.md`), against real
 * Postgres and the real Meilisearch, with a fan-out limit of 1 so every attribute change is "above the limit":
 * - a change of the index settings only (`isFilterable`) is applied in place by job 13 and never rebuilds;
 * - changes that reach no document or setting (`isComparable`, the name, the description) do nothing at all;
 * - document changes requested while a rebuild is due or running give ONE build: a running build starts over from the
 *   first product instead of a second build after its swap, and a request is answered only by a run that read it before
 *   it read the catalog definitions.
 */
describe("search rebuild coalescing and in-place settings (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl(), max: 10 });
  let search: SearchWorld;
  let app: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let world: StockWorld;
  let database: Database;
  let indexer: SearchIndexer;
  let adminId: string;
  let attributeId: string;
  let stocked: StockedVariant;

  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    search = await SearchWorld.create("coal");
    adminId = await insertAdminUserRow(pool);
    app = await startApp({
      search: search.env,
      searchTuning: { fanOutRebuildThreshold: 1 },
      adminAuthenticator: ownerAuthenticator(adminId),
    });
    call = caller(() => app.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    database = app.app.get<Database>(DRIZZLE);
    indexer = search.indexer(database);
    // Two products of the type with the attribute: a fan-out of 2 is above the limit of 1.
    stocked = await world.variant({ onHand: 2 });
    await world.variant({ onHand: 1 });
    const attribute = await pool.query<{ id: string }>("select id from attribute where code = $1", [
      fx.materialAttributeCode,
    ]);
    attributeId = attribute.rows[0]?.id ?? "";
    expect((await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).swapped).toBe(2);
    await syncAll();
  }, 120_000);

  afterAll(async () => {
    await fx.cleanup(pool);
    await search.dispose(pool);
    await app.app.close();
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  beforeEach(async () => {
    // Every case starts from a live index, an empty queue and no request.
    await syncAll();
    expect(await requests()).toEqual([null, null]);
  });

  async function syncAll(): Promise<void> {
    for (let run = 0; run < 10; run++) {
      const result = await indexer.sync(new Date(), UNLIMITED_BUDGET);
      expect(result.failures, JSON.stringify(result)).toEqual([]);
      if (
        !result.paused &&
        (await pool.query("select 1 from search_sync_queue limit 1")).rowCount === 0
      ) {
        return;
      }
      if (result.paused) {
        await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
      }
    }
    throw new Error("The queue did not drain");
  }

  async function requests(): Promise<(string | null)[]> {
    const result = await pool.query<{ requested: string | null }>(
      "select rebuild_requested_at::text as requested from search_index_state order by locale",
    );
    return result.rows.map((row) => row.requested);
  }

  async function queueDepth(): Promise<number> {
    return (
      (await pool.query<{ c: number }>("select count(*)::int as c from search_sync_queue")).rows[0]
        ?.c ?? -1
    );
  }

  async function patchAttribute(body: object): Promise<void> {
    const result = await call("PATCH", `/admin/attributes/${attributeId}`, body);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }

  async function buildDocuments(locale: string): Promise<number> {
    const result = await pool.query<{ count: number }>(
      "select build_documents_count as count from search_index_state where locale = $1",
      [locale],
    );
    return result.rows[0]?.count ?? -1;
  }

  /** The document counts the last swap recorded: what the build that swapped had sent in all. */
  async function liveDocumentsTotal(): Promise<number> {
    const result = await pool.query<{ total: number }>(
      "select sum(documents_count)::int as total from search_index_state",
    );
    return result.rows[0]?.total ?? -1;
  }

  async function attributeTextOf(locale: string): Promise<unknown> {
    const documents = await allDocuments(search.liveUid(locale));
    return documents.find((document) => document["productId"] === stocked.productId)?.[
      "attributeText"
    ];
  }

  it("isFilterable on, off and on within seconds: no rebuild, nothing queued, the settings follow in place", async () => {
    await patchAttribute({ isFilterable: true });
    await patchAttribute({ isFilterable: false });
    await patchAttribute({ isFilterable: true });
    expect(await requests()).toEqual([null, null]);
    expect(await queueDepth()).toBe(0);

    const synced = await indexer.sync(new Date(), UNLIMITED_BUDGET);
    expect(synced).toMatchObject({ paused: false, settingsUpdated: 2, failures: [] });
    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      started: 0,
      swapped: 0,
    });
    const field = `attr_${fx.materialAttributeCode}`;
    for (const locale of ["uk", "en"]) {
      expect((await indexSettings(search.liveUid(locale)))["filterableAttributes"]).toContain(
        field,
      );
    }
    // The documents already carried the value: filtering works at once, without touching a document.
    const documents = await allDocuments(search.liveUid("uk"));
    expect(documents.find((document) => document["productId"] === stocked.productId)?.[field]).toBe(
      "cotton",
    );

    await patchAttribute({ isFilterable: false });
    expect(await indexer.sync(new Date(), UNLIMITED_BUDGET)).toMatchObject({ settingsUpdated: 2 });
    expect((await indexSettings(search.liveUid("uk")))["filterableAttributes"]).not.toContain(
      field,
    );
    expect(await requests()).toEqual([null, null]);
  });

  // isSortable is allowed on number and date attributes only (the core rule spec covers it); the select here takes the rest.
  it("isComparable, the name or the description: no mark, no request, no settings change", async () => {
    const before = await pool.query<{ settings_hash: string }>(
      "select settings_hash from search_index_state order by locale",
    );
    await patchAttribute({ isComparable: true });
    await patchAttribute({ name: { uk: "Матеріал верху" }, description: { uk: "Склад" } });
    expect(await requests()).toEqual([null, null]);
    expect(await queueDepth()).toBe(0);
    expect(await indexer.sync(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      paused: false,
      settingsUpdated: 0,
    });
    const after = await pool.query<{ settings_hash: string }>(
      "select settings_hash from search_index_state order by locale",
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("isSearchable twice within seconds before the build starts: one build, nothing after it", async () => {
    await patchAttribute({ isSearchable: true });
    await patchAttribute({ isSearchable: false });
    await patchAttribute({ isSearchable: true });
    expect((await requests()).every((value) => value !== null)).toBe(true);

    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      started: 2,
      swapped: 2,
    });
    expect(await requests()).toEqual([null, null]);
    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      started: 0,
      swapped: 0,
    });
    expect(await attributeTextOf("uk")).toEqual(["cotton"]);
  });

  it("a change requested while a build runs starts that build over: one swap that includes it, no second build", async () => {
    await patchAttribute({ isSearchable: false });
    // One budget unit: the build of both locales starts and the first locale gets its page (before the change).
    expect(await indexer.rebuild(new Date(), budgetOf(1))).toMatchObject({
      started: 2,
      truncated: true,
    });
    expect(await requests()).toEqual([null, null]);
    expect(await buildDocuments("uk")).toBeGreaterThan(0);

    await patchAttribute({ isSearchable: true });
    expect((await requests()).every((value) => value !== null)).toBe(true);
    expect(await indexer.sync(new Date(), UNLIMITED_BUDGET)).toMatchObject({ paused: true });

    const finished = await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
    expect(finished).toMatchObject({ started: 0, swapped: 2, failures: [] });
    // The page built before the change was built again: this run sent every document of both live indexes.
    expect(finished.documents).toBe(await liveDocumentsTotal());
    expect(await attributeTextOf("uk")).toEqual(["cotton"]);
    expect(await attributeTextOf("en")).toEqual(["cotton"]);
    expect(await requests()).toEqual([null, null]);
    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      started: 0,
      swapped: 0,
    });
  });

  it("a request stamped before the build started but committed after it read the definitions is not lost", async () => {
    await patchAttribute({ isSearchable: false });
    expect(await indexer.rebuild(new Date(), budgetOf(1))).toMatchObject({
      started: 2,
      truncated: true,
    });
    expect(await buildDocuments("uk")).toBeGreaterThan(0);

    // The writer's transaction began before the build (its `now()` is older than build_started_at) and committed after
    // the build's first page: the change and the request become visible together, the stamp is older.
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      await writer.query("update attribute set is_searchable = true where id = $1", [attributeId]);
      await writer.query(
        "update search_index_state set rebuild_requested_at = build_started_at - interval '1 second'",
      );
      await writer.query("commit");
    } finally {
      writer.release();
    }

    const finished = await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
    expect(finished).toMatchObject({ swapped: 2, failures: [] });
    expect(finished.documents).toBe(await liveDocumentsTotal());
    expect(await attributeTextOf("uk")).toEqual(["cotton"]);
    expect(await attributeTextOf("en")).toEqual(["cotton"]);
  });

  it("while a locale has no live index, a request does not delay the build's swap: it is built after it", async () => {
    await pool.query(
      "update search_index_state set live_index_uid = null, documents_count = null where locale = 'en'",
    );
    expect(await indexer.rebuild(new Date(), budgetOf(1))).toMatchObject({
      started: 2,
      truncated: true,
    });
    await patchAttribute({ isSearchable: false });
    const first = await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
    expect(first).toMatchObject({ restarted: 0, swapped: 2, failures: [] });
    expect((await requests()).every((value) => value !== null)).toBe(true);
    expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
      started: 2,
      swapped: 2,
    });
    expect(await requests()).toEqual([null, null]);
    expect(await attributeTextOf("uk")).toEqual([]);
  });

  it("two requests of one transaction get strictly increasing stamps, so a run never answers a newer one by mistake", async () => {
    const queue = new SearchQueue({ locales: ["uk", "en"] });
    const stamps = await withTransaction(database, async (tx) => {
      const read = async (): Promise<string> => {
        const result = await tx.execute<{ requested: string }>(
          // microseconds, as text: a JavaScript Date would round them away
          sql`select rebuild_requested_at::text as requested from search_index_state where locale = 'uk'`,
        );
        return result.rows[0]?.requested ?? "";
      };
      await queue.requestRebuild(tx);
      const first = await read();
      await queue.requestRebuild(tx);
      return [first, await read()];
    });
    expect(stamps[0]).not.toBe("");
    expect(stamps[1]).not.toBe(stamps[0]);
    const ordered = await pool.query<{ ordered: boolean }>(
      "select $1::timestamptz < $2::timestamptz as ordered",
      stamps,
    );
    expect(ordered.rows[0]?.ordered).toBe(true);
    // Leave no request for the next case.
    await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
  });
});
