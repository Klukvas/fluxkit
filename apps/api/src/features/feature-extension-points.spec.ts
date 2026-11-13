import { Module } from "@nestjs/common";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { checkInventory, coreInventory, listSchemaTables } from "../privacy/inventory/index.js";
import { mergeFeatureInventories } from "../privacy/inventory/feature-inventories.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { fixtureNote } from "../test/fixtures/features/notebook/schema.js";
import { http, type HttpOptions } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  FIXTURE_FEATURES_DIR,
  insertUploadRow,
  NOTEBOOK_MIGRATIONS,
} from "../test/notebook-feature.js";
import { loadFeatures } from "./feature-loader.js";

const MEDIA_BASE = "https://media.example.test/media";

/** A test-only extra module (`extraFeatures`): mounted, but not a feature of FEATURES_ENABLED. */
@Module({})
class ProbeModule {}

interface Note {
  id: string;
  title: Record<string, string>;
  cover: { id: string; url: string; width: number; height: number } | null;
}

/*
 * The extension points of ADR 0049 with the `notebook` fixture feature (a table, kit decorators and problems, the database
 * and media ports, an inventory), loaded from disk like a real feature (`FEATURES_ENABLED=notebook`).
 */
describe("a feature with a table, through the API kit (ADR 0049, fixture `notebook`)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const started: RunningApp[] = [];
  let signedOut: RunningApp;
  let owner: RunningApp;
  let viewer: RunningApp;

  async function start(options: Parameters<typeof startApp>[0]): Promise<RunningApp> {
    const running = await startApp({
      enabledFeatures: ["notebook"],
      featuresDir: FIXTURE_FEATURES_DIR,
      mediaStorageDriver: "none",
      mediaPublicBaseUrl: MEDIA_BASE,
      ...options,
    });
    started.push(running);
    return running;
  }

  function call<T>(
    app: RunningApp,
    method: "GET" | "POST",
    path: string,
    options: HttpOptions = {},
  ): Promise<{ status: number; headers: Headers; body: T & ProblemBody }> {
    return http<T & ProblemBody>(app.baseUrl, method, path, options);
  }

  async function attachedAt(id: string): Promise<Date | null | undefined> {
    const result = await pool.query<{ first_attached_at: Date | null }>(
      "select first_attached_at from media_upload where id = $1",
      [id],
    );
    return result.rows[0]?.first_attached_at;
  }

  async function noteCount(): Promise<number> {
    const result = await pool.query<{ count: number }>(
      "select count(*)::int as count from fixture_note",
    );
    return result.rows[0]?.count ?? -1;
  }

  beforeAll(async () => {
    await ensureMigrated([NOTEBOOK_MIGRATIONS]);
    signedOut = await start({ adminAuthenticator: "production-default" });
    owner = await start({});
    viewer = await start({ adminPrincipal: { role: "viewer" } });
  });

  afterAll(async () => {
    for (const running of started) await running.app.close();
    await pool.end();
  });

  describe("default deny for a feature's admin routes (global AdminPathGuard)", () => {
    it("answers 401 to a signed-out caller, on a declared and on an undeclared route", async () => {
      for (const path of ["/admin/notebook/notes", "/admin/notebook/undeclared"]) {
        const result = await call(signedOut, "GET", path);
        expect(result.status, path).toBe(401);
        expect(result.body.code, path).toBe("unauthorized");
      }
    });

    it("answers 403 to a signed-in owner on a route that declares no permission", async () => {
      const result = await call(owner, "GET", "/admin/notebook/undeclared");
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("forbidden");
      expect(JSON.stringify(result.body)).not.toContain("leaked");
    });

    it("enforces the kit's default permissions and @RequirePermission by role", async () => {
      expect((await call(viewer, "GET", "/admin/notebook/notes")).status).toBe(200);
      const write = await call(viewer, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "Нотатка" } },
      });
      expect(write.status).toBe(403);
      expect(write.body.detail).toMatch(/catalog\.write/);

      const created = await call<Note>(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "Нотатка" } },
      });
      expect(created.status).toBe(201);
      const publishPath = `/admin/notebook/notes/${created.body.id}/publish`;
      const refused = await call(viewer, "POST", publishPath);
      expect(refused.status).toBe(403);
      expect(refused.body.detail).toMatch(/catalog\.publish/);
      expect((await call(owner, "POST", publishPath)).status).toBe(200);
    });

    it("keeps the admin CSRF rule for a feature's writes", async () => {
      const result = await call(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "Нотатка" } },
        csrf: false,
      });
      expect(result.status).toBe(403);
    });
  });

  describe("problems raised by a feature (ProblemException of the kit)", () => {
    it("keep their errors[] and the problem content type", async () => {
      const result = await call(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: " ", fr: "Note" } },
      });
      expect(result.status).toBe(400);
      expect(result.headers.get("content-type")).toMatch(/^application\/problem\+json/);
      expect(result.body.code).toBe("validation_failed");
      expect(result.body.errors).toEqual(
        expect.arrayContaining([
          { path: "title.uk", code: "empty" },
          { path: "title.fr", code: "locale_not_allowed" },
        ]),
      );
    });

    it("keep their extension members", async () => {
      const upload = await insertUploadRow(pool);
      const result = await call(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "Нотатка" }, coverUploadId: upload.id, failAfterAttach: true },
      });
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        code: "rule_violation",
        rule: "fixture_fail_after_attach",
      });
    });
  });

  describe("MEDIA_PORT and FEATURE_DATABASE", () => {
    it("attaches an upload inside the feature's transaction and describes it", async () => {
      const upload = await insertUploadRow(pool, { width: 80, height: 40 });
      expect(await attachedAt(upload.id)).toBeNull();

      const created = await call<Note>(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "З обкладинкою" }, coverUploadId: upload.id.toUpperCase() },
      });

      expect(created.status).toBe(201);
      expect(await attachedAt(upload.id)).toBeInstanceOf(Date);
      expect(created.body.cover).toEqual({
        id: upload.id,
        url: `${MEDIA_BASE}/${upload.storageKey}`,
        width: 80,
        height: 40,
      });
    });

    it("leaves the upload unattached and the row unwritten when the feature's transaction rolls back", async () => {
      const upload = await insertUploadRow(pool);
      const before = await noteCount();

      const result = await call(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "Відкат" }, coverUploadId: upload.id, failAfterAttach: true },
      });

      expect(result.status).toBe(409);
      expect(await attachedAt(upload.id)).toBeNull();
      expect(await noteCount()).toBe(before);
    });

    it("refuses an unknown upload at the caller's field and writes nothing", async () => {
      const before = await noteCount();
      const result = await call(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "Без файлу" }, coverUploadId: "00000000-0000-4000-8000-0000000000aa" },
      });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("validation_failed");
      expect(result.body.errors).toEqual([
        {
          path: "coverUploadId",
          code: "upload_not_found",
          message: "This id names no uploaded file.",
        },
      ]);
      expect(await noteCount()).toBe(before);
    });
  });

  describe("the hand-added foreign key to a core table", () => {
    it("exists in the migrated database and restricts deleting the referenced upload", async () => {
      const constraint = await pool.query<{ definition: string }>(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = $1",
        ["fixture_note_cover_upload_id_fkey"],
      );
      expect(constraint.rows[0]?.definition).toBe(
        "FOREIGN KEY (cover_upload_id) REFERENCES media_upload(id) ON DELETE RESTRICT",
      );
      const upload = await insertUploadRow(pool);
      await call(owner, "POST", "/admin/notebook/notes", {
        body: { title: { uk: "Тримає файл" }, coverUploadId: upload.id },
      });
      await expect(
        pool.query("delete from media_upload where id = $1", [upload.id]),
      ).rejects.toThrow(/fixture_note_cover_upload_id_fkey/);
    });
  });

  describe("enabled features in the config routes (E4)", () => {
    it("lists the loaded feature on GET /store/config and GET /admin/config", async () => {
      const store = await call<{ features: string[] }>(owner, "GET", "/store/config");
      const admin = await call<{ features: string[] }>(viewer, "GET", "/admin/config");
      expect(store.body.features).toEqual(["notebook"]);
      expect(admin.body.features).toEqual(["notebook"]);
    });

    it("lists the loaded features sorted, and never a test-only extra module", async () => {
      const both = await start({
        enabledFeatures: ["sample", "notebook"],
        extraFeatures: [{ name: "probe", module: ProbeModule }],
      });
      const result = await call<{ features: string[] }>(both, "GET", "/store/config");
      expect(result.body.features).toEqual(["notebook", "sample"]);
    });
  });

  describe("the feature's personal-data inventory (E3)", () => {
    it("is loaded with the feature and, merged with core, classifies every column of both schemas", async () => {
      const [notebook] = await loadFeatures({
        enabled: ["notebook"],
        featuresDir: FIXTURE_FEATURES_DIR,
      });
      expect(notebook?.migrationsFolder).toBe(NOTEBOOK_MIGRATIONS.folder);
      const merged = mergeFeatureInventories(
        coreInventory,
        notebook === undefined ? [] : [notebook],
      );
      const config = getTableConfig(fixtureNote);
      const featureTable = { name: config.name, columns: config.columns.map((c) => c.name) };

      expect(checkInventory(merged, [...listSchemaTables(), featureTable])).toEqual([]);
      expect(Object.keys(merged)).toContain("fixture_note");
    });
  });
});
