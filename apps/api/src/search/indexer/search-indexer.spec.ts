import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCH_DOCUMENT_VERSION } from "@fluxkit/core";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { withTransaction } from "../../common/transaction.js";
import { SEARCH_PORT, type SearchPort } from "../../common/search-port.js";
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
import { priceProductVariants } from "../../test/pricing-fixtures.js";
import {
  allDocuments,
  createScopedKey,
  deleteKey,
  indexSettings,
  listIndexUids,
  meiliUrl,
  waitForMasterTask,
} from "../../test/search-engine.js";
import { budgetOf, SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { StockWorld, type StockedVariant } from "../../test/stock-world.js";
import { SearchQueueRepository } from "../queue/search-queue.repository.js";
import type { SearchIndexer } from "./index.js";

/**
 * The indexer against real Postgres and the real Meilisearch with a key scoped to a fresh prefix (ADR 0034 decision 5):
 * rebuild with swap, incremental sync, the change_seq guard, changes during a rebuild, failures with backoff and codes,
 * the key scope, settings in place, and the public-data guarantee (a sentinel scan of every stored field).
 */
describe("SearchIndexer (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl(), max: 20 });
  let search: SearchWorld;
  let app: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let world: StockWorld;
  let database: Database;
  let indexer: SearchIndexer;
  let adminId: string;
  const queue = new SearchQueueRepository();
  const SENTINEL = `zzsentinel${Date.now().toString(36)}`;

  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    search = await SearchWorld.create("idx");
    adminId = await insertAdminUserRow(pool);
    app = await startApp({
      search: search.env,
      adminAuthenticator: ownerAuthenticator(adminId),
    });
    call = caller(() => app.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    database = app.app.get<Database>(DRIZZLE);
    indexer = search.indexer(database);
  }, 120_000);

  afterAll(async () => {
    await fx.cleanup(pool);
    await search.dispose(pool);
    await app.app.close();
    // An owner left behind would change the last-owner rule for later spec files of the shared database.
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  async function queued(): Promise<Record<string, string>> {
    const result = await pool.query<{ product_id: string; reason: string }>(
      "select product_id, reason from search_sync_queue",
    );
    return Object.fromEntries(result.rows.map((row) => [row.product_id, row.reason]));
  }

  async function documentsOf(
    locale: string,
    productId: string,
  ): Promise<Record<string, unknown>[]> {
    return (await allDocuments(search.liveUid(locale))).filter(
      (document) => document["productId"] === productId,
    );
  }

  async function publish(productId: string): Promise<void> {
    await priceProductVariants(pool, productId);
    const result = await call("POST", `/admin/products/${productId}/publish`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }

  async function syncAll(target: SearchIndexer = indexer): Promise<void> {
    for (let run = 0; run < 10; run++) {
      const result = await target.sync(new Date(), UNLIMITED_BUDGET);
      expect(result.failures, JSON.stringify(result)).toEqual([]);
      expect(result.paused).toBe(false);
      if ((await pool.query("select 1 from search_sync_queue limit 1")).rowCount === 0) {
        return;
      }
    }
    throw new Error("The queue did not drain");
  }

  describe("first build", () => {
    let live: StockedVariant;

    beforeAll(async () => {
      live = await world.variant({ onHand: 3 });
    });

    it("sync waits while no live index exists; the rebuild builds every locale and swaps them in", async () => {
      expect(await indexer.sync(new Date(), UNLIMITED_BUDGET)).toMatchObject({
        enabled: true,
        paused: true,
        scanned: 0,
      });
      expect(Object.keys(await queued())).toContain(live.productId);

      const built = await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
      expect(built).toMatchObject({ enabled: true, started: 2, swapped: 2, failures: [] });
      expect(await listIndexUids(search.prefix)).toEqual([
        search.liveUid("en"),
        search.liveUid("uk"),
      ]);
      const states = await pool.query(
        "select locale, live_index_uid, build_index_uid, document_version, currency, documents_count, rebuild_requested_at from search_index_state order by locale",
      );
      expect(states.rows).toEqual([
        expect.objectContaining({
          locale: "en",
          live_index_uid: search.liveUid("en"),
          build_index_uid: null,
          document_version: SEARCH_DOCUMENT_VERSION,
          currency: "UAH",
          rebuild_requested_at: null,
        }),
        expect.objectContaining({ locale: "uk", live_index_uid: search.liveUid("uk") }),
      ]);
      const [document] = await documentsOf("uk", live.productId);
      expect(document).toMatchObject({
        id: live.variantId,
        productId: live.productId,
        inStock: true,
      });

      // Nothing to do afterwards; the queue rows are synced now (idempotent: the documents are rebuilt from the database).
      expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({
        started: 0,
        swapped: 0,
      });
      await syncAll();
      expect(await queued()).toEqual({});
    });
  });

  describe("incremental sync", () => {
    it("applies a title change, a sold-out variant, a price change and an unpublish", async () => {
      const stocked = await world.variant({ onHand: 1 });
      await syncAll();
      expect((await documentsOf("en", stocked.productId))[0]).toMatchObject({ inStock: true });

      await call("PATCH", `/admin/products/${stocked.productId}`, {
        title: { uk: "Зимова куртка", en: "Winter jacket" },
      });
      const sold = await call(
        "POST",
        `/admin/products/${stocked.productId}/variants/${stocked.variantId}/inventory/adjustments`,
        { delta: -1, kind: "adjustment", reason: "sold out" },
      );
      expect(sold.status, JSON.stringify(sold.body)).toBe(201);
      await call(
        "PUT",
        `/admin/products/${stocked.productId}/variants/${stocked.variantId}/prices/UAH`,
        { amount: 4321 },
      );
      expect(Object.keys(await queued())).toEqual([stocked.productId]);
      await syncAll();
      expect((await documentsOf("en", stocked.productId))[0]).toMatchObject({
        title: "Winter jacket",
        inStock: false,
        price: 4321,
      });
      expect((await documentsOf("uk", stocked.productId))[0]).toMatchObject({
        title: "Зимова куртка",
      });

      await call("POST", `/admin/products/${stocked.productId}/unpublish`);
      await syncAll();
      expect(await documentsOf("uk", stocked.productId)).toEqual([]);
      expect(await documentsOf("en", stocked.productId)).toEqual([]);
    });

    it("removes the document of a variant that is switched off and keeps the others", async () => {
      const product = await world.createProduct();
      await call("PUT", `/admin/products/${product.id}/options`, {
        options: [{ optionId: fx.size.id, valueIds: [fx.size.values["s"], fx.size.values["m"]] }],
      });
      await publish(product.id);
      await syncAll();
      const before = await documentsOf("uk", product.id);
      expect(before).toHaveLength(2);
      const rows = await pool.query<{ id: string; is_default: boolean }>(
        "select id, is_default from variant where product_id = $1",
        [product.id],
      );
      const off = rows.rows.find((row) => !row.is_default)?.id ?? "";
      const kept = rows.rows.find((row) => row.is_default)?.id ?? "";
      const patched = await call("PATCH", `/admin/products/${product.id}/variants/${off}`, {
        isActive: false,
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      await syncAll();
      const after = await documentsOf("uk", product.id);
      expect(after.map((document) => document["id"])).toEqual([kept]);
    });

    it("keeps a row that was marked again after its claim (the change_seq guard) and syncs it next time", async () => {
      const stocked = await world.variant({ onHand: 2 });
      const now = new Date();
      const claimed = await queue.claimDue(database, now, 100);
      expect(claimed.map((row) => row.productId)).toContain(stocked.productId);
      // A change commits while the sync is busy with the engine.
      const port = app.app.get<SearchPort>(SEARCH_PORT);
      await withTransaction(database, (tx) =>
        port.productsChanged(tx, [stocked.productId], "price_changed"),
      );
      const deleted = await queue.settleSynced(database, claimed);
      expect(deleted).toBe(claimed.length - 1);
      const kept = await pool.query<{ reason: string; lease_until: Date | null }>(
        "select reason, lease_until from search_sync_queue where product_id = $1",
        [stocked.productId],
      );
      expect(kept.rows).toEqual([{ reason: "price_changed", lease_until: null }]);
      await syncAll();
      expect(await queued()).toEqual({});
    });

    it("drains a backlog deeper than 20 pages in one run, within the budget (sustained 50 changes a second)", async () => {
      // Products that do not exist: each page reads, builds nothing and deletes by filter, the cheapest real page.
      const backlog = Array.from({ length: 2_150 }, () => randomUUID());
      await pool.query(
        "insert into search_sync_queue (product_id, reason) select unnest($1::uuid[]), 'product_changed'",
        [backlog],
      );
      const result = await indexer.sync(new Date(), UNLIMITED_BUDGET);
      expect(result).toMatchObject({
        scanned: 2_150,
        synced: 2_150,
        truncated: false,
        failures: [],
      });
      expect(await queued()).toEqual({});
    });

    it("still stops between pages when the budget is used up, leaving the rest queued and due", async () => {
      const backlog = Array.from({ length: 450 }, () => randomUUID());
      await pool.query(
        "insert into search_sync_queue (product_id, reason) select unnest($1::uuid[]), 'product_changed'",
        [backlog],
      );
      const result = await indexer.sync(new Date(), budgetOf(2));
      expect(result).toMatchObject({ synced: 200, truncated: true, failures: [] });
      const left = await pool.query<{ c: number; leased: number; tried: number }>(
        "select count(*)::int as c, count(lease_until)::int as leased, count(*) filter (where attempts > 0)::int as tried from search_sync_queue",
      );
      expect(left.rows[0]).toEqual({ c: 250, leased: 0, tried: 0 });
      await syncAll();
    });

    it("a run claims only rows due at its start, so a stream of new marks can not keep it running", async () => {
      const start = new Date(Date.now() - 1_000);
      const later = Array.from({ length: 30 }, () => randomUUID());
      await pool.query(
        "insert into search_sync_queue (product_id, reason) select unnest($1::uuid[]), 'product_changed'",
        [later],
      );
      expect(await indexer.sync(start, UNLIMITED_BUDGET)).toMatchObject({
        scanned: 0,
        truncated: false,
      });
      expect(Object.keys(await queued()).sort()).toEqual([...later].sort());
      await syncAll();
    });

    it("loses no change of products edited again and again while a long run syncs them", async () => {
      const products = await Promise.all(
        Array.from({ length: 4 }, () => world.variant({ onHand: 1 })),
      );
      await syncAll();
      const backlog = Array.from({ length: 1_500 }, () => randomUUID());
      await pool.query(
        "insert into search_sync_queue (product_id, reason) select unnest($1::uuid[]), 'product_changed'",
        [backlog],
      );
      for (const product of products) {
        await call("PATCH", `/admin/products/${product.productId}`, {
          title: { uk: "Правка 0", en: "Edit 0" },
        });
      }
      const last = new Map(products.map((product) => [product.productId, 0]));
      let running = true;
      const editor = (async () => {
        let round = 0;
        while (running) {
          round += 1;
          for (const product of products) {
            const result = await call("PATCH", `/admin/products/${product.productId}`, {
              title: { uk: `Правка ${round}`, en: `Edit ${round}` },
            });
            expect(result.status).toBe(200);
            last.set(product.productId, round);
          }
        }
      })();
      const result = await indexer.sync(new Date(), UNLIMITED_BUDGET);
      running = false;
      await editor;
      expect(result.failures).toEqual([]);
      await syncAll();
      for (const product of products) {
        const [document] = await documentsOf("en", product.productId);
        expect(document?.["title"], product.productId).toBe(
          `Edit ${String(last.get(product.productId))}`,
        );
      }
    });

    it("two sync runs at the same time never claim the same row", async () => {
      for (let index = 0; index < 6; index++) {
        await world.variant({ onHand: 1 });
      }
      const rows = Object.keys(await queued());
      expect(rows.length).toBeGreaterThanOrEqual(6);
      const warm = await Promise.all(Array.from({ length: 6 }, () => pool.connect()));
      for (const client of warm) client.release();
      const now = new Date();
      const [first, second] = await Promise.all([
        queue.claimDue(database, now, 4),
        queue.claimDue(database, now, 4),
      ]);
      const both = [...(first ?? []), ...(second ?? [])].map((row) => row.productId);
      expect(new Set(both).size).toBe(both.length);
      // Leased rows are not due for a third run until the lease ends.
      const third = await queue.claimDue(database, now, 100);
      expect(third.map((row) => row.productId).filter((id) => both.includes(id))).toEqual([]);
      await pool.query("update search_sync_queue set lease_until = null");
      await syncAll();
    });
  });

  describe("rebuild", () => {
    it("a change made while a build runs is not lost: sync waits, the build swaps, then sync applies it", async () => {
      const stocked = await world.variant({ onHand: 5 });
      await syncAll();
      await pool.query("update search_index_state set rebuild_requested_at = now()");

      // One budget unit: the build starts and adds one page, then stops (resumable).
      const partial = await indexer.rebuild(new Date(), budgetOf(1));
      expect(partial).toMatchObject({ started: 2, swapped: 0, truncated: true });
      const building = await pool.query<{ build_index_uid: string | null }>(
        "select build_index_uid from search_index_state",
      );
      expect(building.rows.every((row) => row.build_index_uid !== null)).toBe(true);

      await call("PATCH", `/admin/products/${stocked.productId}`, {
        title: { uk: "Під час збирання", en: "During the build" },
      });
      expect(await indexer.sync(new Date(), UNLIMITED_BUDGET)).toMatchObject({ paused: true });
      expect(Object.keys(await queued())).toEqual([stocked.productId]);

      const finished = await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
      expect(finished).toMatchObject({ started: 0, swapped: 2, failures: [] });
      const states = await pool.query(
        "select build_index_uid, rebuild_requested_at from search_index_state",
      );
      expect(states.rows).toEqual([
        { build_index_uid: null, rebuild_requested_at: null },
        { build_index_uid: null, rebuild_requested_at: null },
      ]);
      // Only the live indexes are left (the old ones were deleted after the swap).
      expect(await listIndexUids(search.prefix)).toEqual([
        search.liveUid("en"),
        search.liveUid("uk"),
      ]);
      await syncAll();
      expect((await documentsOf("en", stocked.productId))[0]).toMatchObject({
        title: "During the build",
      });
    });

    it("searches running during the swap never fail and never see an empty index", async () => {
      await world.variant({ onHand: 1 });
      await syncAll();
      await pool.query("update search_index_state set rebuild_requested_at = now()");
      let running = true;
      const answers: { ok: boolean; hits: number }[] = [];
      const searcher = (async () => {
        while (running) {
          const response = await fetch(`${meiliUrl()}/indexes/${search.liveUid("uk")}/search`, {
            method: "POST",
            headers: { authorization: `Bearer ${search.key}`, "content-type": "application/json" },
            body: JSON.stringify({ q: "", limit: 1 }),
          });
          const body = (await response.json()) as { estimatedTotalHits?: number };
          answers.push({ ok: response.ok, hits: body.estimatedTotalHits ?? 0 });
        }
      })();
      const rebuilt = await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
      running = false;
      await searcher;
      expect(rebuilt).toMatchObject({ swapped: 2 });
      expect(answers.length).toBeGreaterThan(3);
      expect(answers.filter((answer) => !answer.ok || answer.hits === 0)).toEqual([]);
    });

    it("rebuilds a live index the engine lost (a wiped volume)", async () => {
      const uid = search.liveUid("en");
      const deleted = await fetch(`${meiliUrl()}/indexes/${uid}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${process.env["MEILI_MASTER_KEY"] ?? ""}` },
      });
      await waitForMasterTask(((await deleted.json()) as { taskUid: number }).taskUid);
      const result = await indexer.rebuild(new Date(), UNLIMITED_BUDGET);
      expect(result).toMatchObject({ swapped: 2, failures: [] });
      expect((await allDocuments(uid)).length).toBeGreaterThan(0);
    });
  });

  describe("settings", () => {
    it("a newly filterable attribute changes the settings in place, without a rebuild", async () => {
      const before = await pool.query<{ settings_hash: string }>(
        "select settings_hash from search_index_state where locale = 'uk'",
      );
      const attribute = await pool.query<{ id: string }>(
        "select id from attribute where code = $1",
        [fx.materialAttributeCode],
      );
      const patched = await call("PATCH", `/admin/attributes/${attribute.rows[0]?.id}`, {
        isFilterable: true,
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const result = await indexer.sync(new Date(), UNLIMITED_BUDGET);
      expect(result).toMatchObject({ settingsUpdated: 2, failures: [] });
      const after = await pool.query<{ settings_hash: string }>(
        "select settings_hash from search_index_state where locale = 'uk'",
      );
      expect(after.rows[0]?.settings_hash).not.toBe(before.rows[0]?.settings_hash);
      const settings = await indexSettings(search.liveUid("uk"));
      expect(settings["filterableAttributes"]).toContain(`attr_${fx.materialAttributeCode}`);
      await syncAll();
    });
  });

  describe("failures", () => {
    it("an unreachable engine leaves the rows queued with a code and a backoff, and never fails the job", async () => {
      const stocked = await world.variant({ onHand: 1 });
      const down = search.indexer(database, { url: "http://127.0.0.1:9" });
      const now = new Date();
      const result = await down.sync(now, UNLIMITED_BUDGET);
      expect(result.failures).toEqual([
        { code: "engine_unreachable", products: expect.any(Number) as number },
      ]);
      const row = await pool.query<{
        attempts: number;
        last_error_code: string;
        next_attempt_at: Date;
      }>(
        "select attempts, last_error_code, next_attempt_at from search_sync_queue where product_id = $1",
        [stocked.productId],
      );
      expect(row.rows[0]).toMatchObject({ attempts: 1, last_error_code: "engine_unreachable" });
      expect(row.rows[0]?.next_attempt_at.getTime()).toBe(now.getTime() + 60_000);
      // Not due yet for a healthy run either; when due it is synced and the code goes with the row.
      expect(await indexer.sync(now, UNLIMITED_BUDGET)).toMatchObject({ scanned: 0 });
      expect(await indexer.sync(new Date(now.getTime() + 61_000), UNLIMITED_BUDGET)).toMatchObject({
        failures: [],
      });
      expect(await queued()).toEqual({});
    });

    it("a failed rebuild records the code on every locale and waits for its backoff", async () => {
      await pool.query("update search_index_state set rebuild_requested_at = now()");
      const down = search.indexer(database, { url: "http://127.0.0.1:9" });
      const now = new Date();
      const failed = await down.rebuild(now, UNLIMITED_BUDGET);
      expect(failed.failures).toEqual([{ code: "engine_unreachable", locales: ["uk", "en"] }]);
      const states = await pool.query(
        "select failed_attempts, last_error_code from search_index_state order by locale",
      );
      expect(states.rows).toEqual([
        { failed_attempts: 1, last_error_code: "engine_unreachable" },
        { failed_attempts: 1, last_error_code: "engine_unreachable" },
      ]);
      expect(await indexer.rebuild(now, UNLIMITED_BUDGET)).toMatchObject({ waiting: true });
      const later = await indexer.rebuild(new Date(now.getTime() + 61_000), UNLIMITED_BUDGET);
      expect(later).toMatchObject({ swapped: 2, failures: [] });
      const cleared = await pool.query(
        "select failed_attempts, last_error_code from search_index_state",
      );
      expect(cleared.rows).toEqual([
        { failed_attempts: 0, last_error_code: null },
        { failed_attempts: 0, last_error_code: null },
      ]);
    });

    it("a key without the needed actions is reported as engine_unauthorized", async () => {
      const readOnly = await createScopedKey(search.prefix, ["search", "tasks.get", "stats.get"]);
      try {
        await world.variant({ onHand: 1 });
        const weak = search.indexer(database, { key: readOnly.key });
        const result = await weak.sync(new Date(), UNLIMITED_BUDGET);
        expect(result.failures).toEqual([
          { code: "engine_unauthorized", products: expect.any(Number) as number },
        ]);
      } finally {
        await deleteKey(readOnly.uid);
        await pool.query("update search_sync_queue set next_attempt_at = now()");
        await syncAll();
      }
    });
  });

  describe("public data only", () => {
    it("never stores internal or hidden attributes, drafts, unsellable products or inactive variants", async () => {
      const internal = await call<{ id: string }>("POST", "/admin/attributes", {
        code: `int_${fx.runId}`,
        name: { uk: "Внутрішній" },
        inputType: "text",
        isLocalized: false,
        isInternal: true,
      });
      const hidden = await call<{ id: string }>("POST", "/admin/attributes", {
        code: `hid_${fx.runId}`,
        name: { uk: "Прихований" },
        inputType: "text",
        isLocalized: false,
        isVisibleOnStorefront: false,
      });
      for (const created of [internal, hidden]) {
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        expect(
          (
            await call(
              "PUT",
              `/admin/product-types/${fx.teeTypeId}/attributes/${created.body.id}`,
              {
                level: "product",
              },
            )
          ).status,
        ).toBeLessThan(300);
      }
      const searchable = await call<{ id: string }>("POST", "/admin/attributes", {
        code: `pub_${fx.runId}`,
        name: { uk: "Публічний" },
        inputType: "text",
        isLocalized: false,
        isSearchable: true,
      });
      expect(
        (
          await call(
            "PUT",
            `/admin/product-types/${fx.teeTypeId}/attributes/${searchable.body.id}`,
            {
              level: "product",
            },
          )
        ).status,
      ).toBeLessThan(300);

      // A live product carrying the sentinel only in its internal and hidden attributes.
      const visible = await world.variant({ onHand: 2 });
      const patched = await call("PATCH", `/admin/products/${visible.productId}`, {
        attributes: {
          [fx.materialAttributeCode]: "cotton",
          [`int_${fx.runId}`]: `${SENTINEL}internal`,
          [`hid_${fx.runId}`]: `${SENTINEL}hidden`,
          [`pub_${fx.runId}`]: "publicvalue",
        },
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      // A draft and a product without a shop price, both with the sentinel in the title.
      const draft = await world.variant({ publish: false });
      await call("PATCH", `/admin/products/${draft.productId}`, {
        title: { uk: `${SENTINEL}draft` },
      });
      const unpriced = await world.createProduct();
      await call("PATCH", `/admin/products/${unpriced.id}`, {
        title: { uk: `${SENTINEL}unpriced` },
      });
      await pool.query(
        "insert into price (variant_id, currency, amount) select id, 'EUR', 100 from variant where product_id = $1",
        [unpriced.id],
      );
      // An active product with a second, inactive variant whose SKU carries the sentinel.
      const mixed = await world.createProduct();
      await call("PUT", `/admin/products/${mixed.id}/options`, {
        options: [{ optionId: fx.size.id, valueIds: [fx.size.values["s"], fx.size.values["m"]] }],
      });
      await publish(mixed.id);
      const variants = await pool.query<{ id: string }>(
        "select id from variant where product_id = $1 order by position",
        [mixed.id],
      );
      const inactive = variants.rows[1]?.id ?? "";
      const off = await call("PATCH", `/admin/products/${mixed.id}/variants/${inactive}`, {
        isActive: false,
        sku: `${SENTINEL}SKU`.toUpperCase(),
      });
      expect(off.status, JSON.stringify(off.body)).toBe(200);

      await syncAll();
      await pool.query("update search_index_state set rebuild_requested_at = now()");
      expect(await indexer.rebuild(new Date(), UNLIMITED_BUDGET)).toMatchObject({ swapped: 2 });

      for (const locale of ["uk", "en"]) {
        const documents = await allDocuments(search.liveUid(locale));
        const settings = await indexSettings(search.liveUid(locale));
        const stored = JSON.stringify({ documents, settings }).toLowerCase();
        expect(stored).not.toContain(SENTINEL);
        expect(stored).not.toContain(`int_${fx.runId}`);
        expect(stored).not.toContain(`hid_${fx.runId}`);
        // The public searchable attribute does arrive (the scan would miss nothing that is there).
        expect(stored).toContain("publicvalue");
        expect(documents.some((document) => document["id"] === inactive)).toBe(false);
        expect(documents.some((document) => document["productId"] === draft.productId)).toBe(false);
        expect(documents.some((document) => document["productId"] === unpriced.id)).toBe(false);
      }
    });
  });
});
