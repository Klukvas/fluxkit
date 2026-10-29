import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { insertAdminUserRow, ownerAuthenticator } from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { indexSettings } from "../../test/search-engine.js";
import { SearchWorld, UNLIMITED_BUDGET } from "../../test/search-world.js";
import { SearchIndexer } from "../indexer/index.js";

interface Status {
  engine: { reachable: boolean; code: string | null };
  locales: {
    locale: string;
    liveIndex: string | null;
    settingsFresh: boolean;
    documentsFresh: boolean;
    rebuildRequestedAt: string | null;
    lastErrorCode: string | null;
  }[];
  queue: { depth: number; dead: number; errorCodes: { code: string; count: number }[] };
}

interface Group {
  id: string;
  locale: string;
  terms: string[];
}

/** The admin search routes (ADR 0034 decisions 8 and 10) with the real database and engine. */
describe("admin search routes (real Postgres, real Meilisearch)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let search: SearchWorld;
  let owner: RunningApp;
  let viewer: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    await pool.query("delete from search_synonym_group");
    search = await SearchWorld.create("adm");
    owner = await startApp({
      search: search.env,
      adminAuthenticator: ownerAuthenticator(await insertAdminUserRow(pool)),
    });
    viewer = await startApp({ search: search.env, adminPrincipal: { role: "viewer" } });
  }, 60_000);

  afterAll(async () => {
    await search.dispose(pool);
    await owner.app.close();
    await viewer.app.close();
    await pool.end();
  });

  it("reports a missing index, the queue and a reachable engine before the first build", async () => {
    const result = await http<Status>(owner.baseUrl, "GET", "/admin/search/status");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.body.engine).toEqual({ reachable: true, code: null });
    expect(result.body.locales.map((entry) => [entry.locale, entry.liveIndex])).toEqual([
      ["uk", null],
      ["en", null],
    ]);
    expect(result.body.locales[0]).toMatchObject({ settingsFresh: false, documentsFresh: false });
  });

  it("reports fresh indexes after a build, and failures as codes", async () => {
    await owner.app.get(SearchIndexer).rebuild(new Date(), UNLIMITED_BUDGET);
    const built = await http<Status>(owner.baseUrl, "GET", "/admin/search/status");
    expect(
      built.body.locales.map((entry) => [
        entry.liveIndex,
        entry.settingsFresh,
        entry.documentsFresh,
      ]),
    ).toEqual([
      [search.liveUid("uk"), true, true],
      [search.liveUid("en"), true, true],
    ]);
    await pool.query(
      `insert into search_sync_queue (product_id, reason, attempts, last_error_code)
       values (gen_random_uuid(), 'product_changed', 10, 'engine_timeout')`,
    );
    const failing = await http<Status>(owner.baseUrl, "GET", "/admin/search/status");
    expect(failing.body.queue).toMatchObject({
      depth: 1,
      dead: 1,
      errorCodes: [{ code: "engine_timeout", count: 1 }],
    });
    await pool.query("delete from search_sync_queue");

    const down = await startApp({ search: { ...search.env, meiliUrl: "http://127.0.0.1:9" } });
    try {
      const unreachable = await http<Status>(down.baseUrl, "GET", "/admin/search/status");
      expect(unreachable.status).toBe(200);
      expect(unreachable.body.engine).toEqual({ reachable: false, code: "engine_unreachable" });
    } finally {
      await down.app.close();
    }
  });

  it("records a rebuild request for every locale (202, idempotent)", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await http<{ locales: string[] }>(
        owner.baseUrl,
        "POST",
        "/admin/search/rebuild",
      );
      expect(result.status, JSON.stringify(result.body)).toBe(202);
      expect(result.body.locales).toEqual(["uk", "en"]);
    }
    const requested = await pool.query(
      "select count(*)::int as count from search_index_state where rebuild_requested_at is not null",
    );
    expect(requested.rows[0]).toEqual({ count: 2 });
    const status = await http<Status>(owner.baseUrl, "GET", "/admin/search/status");
    expect(status.body.locales.every((entry) => entry.rebuildRequestedAt !== null)).toBe(true);
    await pool.query("update search_index_state set rebuild_requested_at = null");
  });

  it("creates, lists, changes and deletes synonym groups, normalizing the terms like queries", async () => {
    const created = await http<Group>(owner.baseUrl, "POST", "/admin/search/synonyms", {
      body: { locale: "uk", terms: ["Викрутка", " відвертка "] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ locale: "uk", terms: ["викрутка", "відвертка"] });
    expect(created.headers.get("location")).toBe(`/admin/search/synonyms/${created.body.id}`);

    const listed = await http<{ items: Group[]; total: number }>(
      owner.baseUrl,
      "GET",
      "/admin/search/synonyms?locale=uk",
    );
    expect(listed.body.total).toBe(1);

    // Applied to the live index by the sync job as an in-place settings change.
    const sync = await owner.app.get(SearchIndexer).sync(new Date(), UNLIMITED_BUDGET);
    expect(sync).toMatchObject({ settingsUpdated: 1, failures: [] });
    const settings = await indexSettings(search.liveUid("uk"));
    expect(settings["synonyms"]).toMatchObject({
      викрутка: ["відвертка"],
      відвертка: ["викрутка"],
    });

    const changed = await http<Group>(
      owner.baseUrl,
      "PATCH",
      `/admin/search/synonyms/${created.body.id}`,
      { body: { terms: ["нога", "нозі", "ноги"] } },
    );
    expect(changed.status).toBe(200);
    expect(changed.body.terms).toEqual(["нога", "нозі", "ноги"]);

    expect(
      (await http(owner.baseUrl, "DELETE", `/admin/search/synonyms/${created.body.id}`)).status,
    ).toBe(204);
    expect(
      (await http(owner.baseUrl, "DELETE", `/admin/search/synonyms/${created.body.id}`)).status,
    ).toBe(404);
  });

  it.each([
    [{ locale: "xx", terms: ["a", "b"] }, "locale"],
    [{ locale: "uk", terms: ["одне"] }, "terms"],
    [{ locale: "uk", terms: ["a", "A"] }, "terms"],
    [{ locale: "uk", terms: ["a", "b".repeat(51)] }, "terms"],
    [{ locale: "uk", terms: ["a", "b\u0007"] }, "terms"],
    [{ locale: "uk", terms: ["a", "!!!"] }, "terms"],
    [{ locale: "uk", terms: ["a", "b"], extra: 1 }, ""],
  ])("refuses a bad synonym group %j", async (body, path) => {
    const result = await http<{ code: string; errors?: { path: string }[] }>(
      owner.baseUrl,
      "POST",
      "/admin/search/synonyms",
      { body },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    if (path !== "") {
      expect(result.body.errors?.[0]?.path).toBe(path);
    }
  });

  it("lets catalog.read see the status and the synonyms but not change anything", async () => {
    expect((await http(viewer.baseUrl, "GET", "/admin/search/status")).status).toBe(200);
    expect((await http(viewer.baseUrl, "GET", "/admin/search/synonyms")).status).toBe(200);
    expect((await http(viewer.baseUrl, "POST", "/admin/search/rebuild")).status).toBe(403);
    expect(
      (
        await http(viewer.baseUrl, "POST", "/admin/search/synonyms", {
          body: { locale: "uk", terms: ["a", "b"] },
        })
      ).status,
    ).toBe(403);
  });

  it("is 404 with SEARCH_ENABLED=false", async () => {
    const off = await startApp();
    try {
      for (const [method, path] of [
        ["GET", "/admin/search/status"],
        ["POST", "/admin/search/rebuild"],
        ["GET", "/admin/search/synonyms"],
      ] as const) {
        expect((await http(off.baseUrl, method, path)).status).toBe(404);
      }
    } finally {
      await off.app.close();
    }
  });
});
