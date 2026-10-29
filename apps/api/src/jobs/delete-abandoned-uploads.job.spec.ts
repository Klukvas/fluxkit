import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { keyToRelativePath, MEDIA_STORAGE_PORT, type MediaKey } from "@fluxkit/core";
import { ProblemException } from "../common/problem.js";
import { withTransaction } from "../common/transaction.js";
import { MediaAttachService } from "../media/media-attach.service.js";
import { MEDIA_CONFIG, type MediaConfig } from "../media/media-config.js";
import type { UploadStorage } from "../media/local-media-storage.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import * as images from "../test/media-images.js";
import { startMediaApp, TEST_MEDIA_BASE_URL, type MediaApp } from "../test/media-app.js";
import { ensureMigrated } from "../test/migrate.js";
import { deleteAbandonedUploads } from "./delete-abandoned-uploads.job.js";
import { JobBudget } from "./job-budget.js";
import { JobsRepository } from "./jobs.repository.js";
import { JobsRunner } from "./jobs-runner.js";

// Long before any row another spec writes (those carry the real clock), so only this spec's rows are ever due.
const NOW = new Date("2025-03-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Seeded {
  id: string;
  key: MediaKey;
  path: string;
}

describe("delete-abandoned-uploads (real Postgres, real temp MEDIA_DIR, injected time)", () => {
  const clock = new FakeClock(NOW);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let media: MediaApp;
  let repository: JobsRepository;
  let storage: UploadStorage;
  let config: MediaConfig;
  const seededIds: string[] = [];

  const deps = (override: { storage?: Pick<UploadStorage, "delete"> } = {}) => ({
    database: media.db,
    repository,
    storage: override.storage ?? storage,
    config,
  });

  function pathOfKey(key: string): string {
    return join(media.mediaDir, keyToRelativePath(key as MediaKey));
  }

  /** A `media_upload` row written straight into the table, with its file on disk unless `file: false`. */
  async function seed(
    options: { ageMs?: number; attached?: boolean; file?: boolean; createdAt?: Date } = {},
  ): Promise<Seeded> {
    const key = `${randomBytes(16).toString("hex")}.jpg` as MediaKey;
    const createdAt = options.createdAt ?? new Date(NOW.getTime() - (options.ageMs ?? 2 * DAY));
    const result = await pool.query<{ id: string }>(
      `insert into media_upload
         (storage_key, content_type, byte_size, width, height, sha256, created_at, first_attached_at)
       values ($1, 'image/jpeg', 4, 1, 1, $2, $3, $4) returning id`,
      [key, "a".repeat(64), createdAt, options.attached === true ? createdAt : null],
    );
    const id = result.rows[0]?.id ?? "";
    seededIds.push(id);
    const path = pathOfKey(key);
    if (options.file !== false) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "jpeg-bytes");
    }
    return { id, key, path };
  }

  async function rowExists(id: string): Promise<boolean> {
    const result = await pool.query("select 1 from media_upload where id = $1", [id]);
    return result.rowCount === 1;
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }

  async function remaining(ids: string[]): Promise<string[]> {
    const result = await pool.query<{ id: string }>(
      "select id from media_upload where id = any($1::uuid[])",
      [ids],
    );
    return result.rows.map((row) => row.id).sort();
  }

  /** `count` unattached rows without files, one SQL statement, `ageMs` old (rows differ by a millisecond so the order is fixed). */
  async function seedMany(count: number, ageMs: number): Promise<void> {
    await pool.query(
      `insert into media_upload (storage_key, content_type, byte_size, width, height, sha256, created_at)
       select md5(random()::text || g::text) || '.jpg', 'image/jpeg', 4, 1, 1, repeat('b', 64),
              $2::timestamptz - (g * interval '1 millisecond')
       from generate_series(1, $1::int) as g`,
      [count, new Date(NOW.getTime() - ageMs)],
    );
  }

  beforeAll(async () => {
    await ensureMigrated();
    media = await startMediaApp({ clock });
    repository = media.app.get(JobsRepository);
    storage = media.app.get<UploadStorage>(MEDIA_STORAGE_PORT);
    config = media.app.get<MediaConfig>(MEDIA_CONFIG);
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.query("delete from media_upload where id = any($1::uuid[])", [seededIds.splice(0)]);
    // The bulk rows have no id list; they are the only rows older than the test epoch.
    await pool.query("delete from media_upload where created_at < $1", [
      new Date(NOW.getTime() - 2 * HOUR),
    ]);
  });

  afterAll(async () => {
    try {
      await pool.end();
    } finally {
      await media.close();
    }
  });

  describe("what is deleted", () => {
    it("deletes an unattached upload older than 24 hours with its file, in that order of evidence", async () => {
      const old = await seed({ ageMs: 25 * HOUR });
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 1,
        truncated: false,
        fileErrors: 0,
      });
      expect(await rowExists(old.id)).toBe(false);
      expect(await fileExists(old.path)).toBe(false);
    });

    it("keeps an upload younger than 24 hours and one exactly 24 hours old (strictly older is abandoned)", async () => {
      const young = await seed({ ageMs: 23 * HOUR + 59 * 60_000 });
      const edge = await seed({ ageMs: DAY });
      const justOver = await seed({ ageMs: DAY + 1 });
      const result = await deleteAbandonedUploads(deps(), NOW);
      expect(result).toEqual({ deleted: 1, truncated: false, fileErrors: 0 });
      expect(await remaining([young.id, edge.id, justOver.id])).toEqual([young.id, edge.id].sort());
      expect(await fileExists(young.path)).toBe(true);
      expect(await fileExists(edge.path)).toBe(true);
      expect(await fileExists(justOver.path)).toBe(false);
    });

    it("never deletes an attached upload, however old, nor its file", async () => {
      const ancient = await seed({ ageMs: 900 * DAY, attached: true });
      const attachedRecently = await seed({ ageMs: 30 * DAY, attached: true });
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 0,
        truncated: false,
        fileErrors: 0,
      });
      expect(await remaining([ancient.id, attachedRecently.id])).toEqual(
        [ancient.id, attachedRecently.id].sort(),
      );
      expect(await fileExists(ancient.path)).toBe(true);
      expect(await fileExists(attachedRecently.path)).toBe(true);
    });

    it("old attached uploads do not starve the abandoned ones: the page selection itself skips attached rows", async () => {
      // 120 attached rows older than the abandoned ones: if the page select ignored `first_attached_at`, the first page would
      // hold 100 attached rows, delete nothing and the abandoned rows behind them would never be reached.
      const attached: string[] = [];
      for (let index = 0; index < 120; index += 1) {
        attached.push((await seed({ ageMs: 900 * DAY - index, attached: true, file: false })).id);
      }
      const abandoned = [await seed({ ageMs: 3 * DAY }), await seed({ ageMs: 4 * DAY })];
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 2,
        truncated: false,
        fileErrors: 0,
      });
      expect(await remaining(abandoned.map((row) => row.id))).toEqual([]);
      expect((await remaining(attached)).length).toBe(120);
    });

    it("is idempotent: a second run finds nothing", async () => {
      await seed({ ageMs: 3 * DAY });
      await seed({ ageMs: 4 * DAY });
      expect((await deleteAbandonedUploads(deps(), NOW)).deleted).toBe(2);
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 0,
        truncated: false,
        fileErrors: 0,
      });
    });

    it("does nothing with MEDIA_STORAGE_DRIVER=none: rows and files stay (ADR 0028 decision 1)", async () => {
      const old = await seed({ ageMs: 9 * DAY });
      const result = await deleteAbandonedUploads(
        { ...deps(), config: { ...config, driver: "none" } },
        NOW,
      );
      expect(result).toEqual({ deleted: 0, truncated: false, fileErrors: 0 });
      expect(await rowExists(old.id)).toBe(true);
      expect(await fileExists(old.path)).toBe(true);
    });
  });

  describe("the repository statement", () => {
    it("deletes only never-attached rows older than the cutoff, whatever ids it is given", async () => {
      const attached = await seed({ ageMs: 10 * DAY, attached: true });
      const young = await seed({ ageMs: HOUR });
      const old = await seed({ ageMs: 10 * DAY });
      const cutoff = new Date(NOW.getTime() - DAY);
      const keys = await withTransaction(media.db, (tx) =>
        repository.deleteAbandonedUploadsByIds(tx, [attached.id, young.id, old.id], cutoff),
      );
      expect(keys).toEqual([old.key]);
      expect(await remaining([attached.id, young.id])).toEqual([attached.id, young.id].sort());
    });

    it("returns nothing for an empty list of ids", async () => {
      expect(
        await withTransaction(media.db, (tx) =>
          repository.deleteAbandonedUploadsByIds(tx, [], new Date(NOW.getTime() - DAY)),
        ),
      ).toEqual([]);
    });
  });

  describe("files", () => {
    it("a file that is already gone is success", async () => {
      const old = await seed({ ageMs: 3 * DAY, file: false });
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 1,
        truncated: false,
        fileErrors: 0,
      });
      expect(await rowExists(old.id)).toBe(false);
    });

    it("a file that cannot be deleted is left and counted; the rest of the page and the run go on", async () => {
      const before = await seed({ ageMs: 5 * DAY });
      const stuck = await seed({ ageMs: 4 * DAY, file: false });
      const after = await seed({ ageMs: 3 * DAY });
      // A directory where the file should be: a real unlink failure (EISDIR) from the real driver.
      await mkdir(stuck.path, { recursive: true });
      const result = await deleteAbandonedUploads(deps(), NOW);
      expect(result).toEqual({ deleted: 3, truncated: false, fileErrors: 1 });
      expect(await remaining([before.id, stuck.id, after.id])).toEqual([]);
      expect(await fileExists(before.path)).toBe(false);
      expect(await fileExists(after.path)).toBe(false);
      const warnings = vi.mocked(Logger.prototype.error).mock.calls.map((call) => String(call[0]));
      const logged = warnings.filter((line) => line.includes(stuck.key));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain("EISDIR");
      // The code and the key only: no path of the server, no message text.
      expect(logged[0]).not.toContain(media.mediaDir);
      expect(logged[0]).not.toMatch(/illegal operation|directory/i);
    });

    it("an unexpected error from the storage (no code) is counted too and never thrown out of the run", async () => {
      const first = await seed({ ageMs: 5 * DAY });
      const second = await seed({ ageMs: 4 * DAY });
      const failing: Pick<UploadStorage, "delete"> = {
        delete: (key) =>
          key === first.key ? Promise.reject(new TypeError("secret detail")) : storage.delete(key),
      };
      const result = await deleteAbandonedUploads(deps({ storage: failing }), NOW);
      expect(result).toEqual({ deleted: 2, truncated: false, fileErrors: 1 });
      expect(await fileExists(second.path)).toBe(false);
      const lines = vi.mocked(Logger.prototype.error).mock.calls.map((call) => String(call[0]));
      expect(lines.join("\n")).not.toContain("secret detail");
    });

    it("calls storage.delete only after the delete is committed (another connection no longer sees the row)", async () => {
      const old = await seed({ ageMs: 3 * DAY });
      const seenByOthers: boolean[] = [];
      const watching: Pick<UploadStorage, "delete"> = {
        delete: async (key) => {
          seenByOthers.push(await rowExists(old.id));
          await storage.delete(key);
        },
      };
      await deleteAbandonedUploads(deps({ storage: watching }), NOW);
      expect(seenByOthers).toEqual([false]);
    });

    it("never calls storage.delete for a row it did not delete", async () => {
      const attached = await seed({ ageMs: 9 * DAY, attached: true });
      const young = await seed({ ageMs: HOUR });
      const calls: string[] = [];
      const recording: Pick<UploadStorage, "delete"> = {
        delete: (key) => {
          calls.push(key);
          return Promise.resolve();
        },
      };
      await deleteAbandonedUploads(deps({ storage: recording }), NOW);
      expect(calls).toEqual([]);
      expect(await fileExists(attached.path)).toBe(true);
      expect(await fileExists(young.path)).toBe(true);
    });
  });

  describe("bounds (ADR 0025)", () => {
    it("100 rows are one full page and a short second page: deleted 100, not truncated", async () => {
      await seedMany(100, 3 * DAY);
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 100,
        truncated: false,
        fileErrors: 0,
      });
    });

    it("101 rows take two pages and nothing is left", async () => {
      await seedMany(101, 3 * DAY);
      const pages = vi.spyOn(repository, "lockAbandonedUploadIds");
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 101,
        truncated: false,
        fileErrors: 0,
      });
      expect(pages.mock.calls.map((call) => call[2])).toEqual([100, 100]);
      const left = await pool.query("select 1 from media_upload where created_at < $1", [NOW]);
      expect(left.rowCount).toBe(0);
    });

    it("stops after 50 pages of 100 and reports truncated; the next run takes the rest, oldest first", async () => {
      await seedMany(5000, 3 * DAY);
      const newest = await seed({ createdAt: new Date(NOW.getTime() - 2 * DAY) });
      const first = await deleteAbandonedUploads(deps(), NOW);
      expect(first).toEqual({ deleted: 5000, truncated: true, fileErrors: 0 });
      // Oldest first: the one row that is left is the youngest abandoned one.
      expect(await remaining([newest.id])).toEqual([newest.id]);
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 1,
        truncated: false,
        fileErrors: 0,
      });
    });

    it("stops starting pages when the time budget is used up and says so", async () => {
      await seedMany(10, 3 * DAY);
      let ticks = 0;
      const spent = new JobBudget(1, () => (ticks++ === 0 ? 0 : 1000));
      expect(await deleteAbandonedUploads(deps(), NOW, undefined, spent)).toEqual({
        deleted: 0,
        truncated: true,
        fileErrors: 0,
      });
      const left = await pool.query("select 1 from media_upload where created_at < $1", [NOW]);
      expect(left.rowCount).toBe(10);
    });
  });

  describe("the race with an attaching save (two real connections)", () => {
    const attach = (db: MediaApp["db"], url: string) =>
      media.app.get(MediaAttachService).markAttached(db, [{ path: "media.0.url", url }]);

    const urlOf = (upload: Seeded): string => `${TEST_MEDIA_BASE_URL}/${upload.key}`;

    /** Polls until a backend other than ours waits for a lock (the attach is parked behind the job's delete). */
    async function waitUntilSomeoneWaitsForALock(): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const result = await pool.query(
          "select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and state = 'active'",
        );
        if ((result.rowCount ?? 0) > 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("no statement is waiting for a lock");
    }

    function gate(): { promise: Promise<void>; open: () => void } {
      let open: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { promise, open };
    }

    it("the attach commits first: the job skips the locked row without waiting; row and file stay", async () => {
      const upload = await seed({ ageMs: 3 * DAY });
      const attached = gate();
      const commit = gate();
      const saving = withTransaction(media.db, async (tx) => {
        await attach(tx, urlOf(upload));
        attached.open();
        await commit.promise;
      });
      await attached.promise;
      // The job runs while the save holds the row lock; it must neither wait for it nor delete the row.
      const result = await deleteAbandonedUploads(deps(), NOW);
      expect(result).toEqual({ deleted: 0, truncated: false, fileErrors: 0 });
      commit.open();
      await saving;
      expect(await rowExists(upload.id)).toBe(true);
      expect(await fileExists(upload.path)).toBe(true);
      const marked = await pool.query<{ first_attached_at: Date | null }>(
        "select first_attached_at from media_upload where id = $1",
        [upload.id],
      );
      expect(marked.rows[0]?.first_attached_at).toBeInstanceOf(Date);
      // Now attached for good: later runs keep it however old it gets.
      expect(await deleteAbandonedUploads(deps(), new Date(NOW.getTime() + 400 * DAY))).toEqual({
        deleted: 0,
        truncated: false,
        fileErrors: 0,
      });
      expect(await fileExists(upload.path)).toBe(true);
    });

    it("the job commits first: the save (already open on its own connection) finds no row and fails with upload_not_found", async () => {
      const upload = await seed({ ageMs: 3 * DAY });
      const opened = gate();
      const jobDone = gate();
      const saving = withTransaction(media.db, async (tx) => {
        await tx.execute(sql`select 1`);
        opened.open();
        await jobDone.promise;
        await attach(tx, urlOf(upload));
      });
      const outcome = saving.then(
        () => undefined,
        (error: unknown) => error,
      );
      await opened.promise;
      expect(await deleteAbandonedUploads(deps(), NOW)).toEqual({
        deleted: 1,
        truncated: false,
        fileErrors: 0,
      });
      jobDone.open();
      const error = await outcome;
      expect(error).toBeInstanceOf(ProblemException);
      expect(error).toMatchObject({
        code: "validation_failed",
        errors: [expect.objectContaining({ path: "media.0.url", code: "upload_not_found" })],
      });
      expect(await rowExists(upload.id)).toBe(false);
    });

    it("the delete is in flight when the save arrives: the save waits for the lock, then finds no row", async () => {
      const upload = await seed({ ageMs: 3 * DAY });
      const deleted = gate();
      const commit = gate();
      const cutoff = new Date(NOW.getTime() - DAY);
      const deleting = withTransaction(media.db, async (tx) => {
        const keys = await repository.deleteAbandonedUploadsByIds(tx, [upload.id], cutoff);
        expect(keys).toEqual([upload.key]);
        deleted.open();
        await commit.promise;
      });
      await deleted.promise;
      const saving = withTransaction(media.db, (tx) => attach(tx, urlOf(upload))).then(
        () => undefined,
        (error: unknown) => error,
      );
      await waitUntilSomeoneWaitsForALock();
      commit.open();
      await deleting;
      expect(await saving).toMatchObject({
        code: "validation_failed",
        errors: [expect.objectContaining({ code: "upload_not_found" })],
      });
    });

    it("the save holds the lock when a delete of that very row arrives: the delete waits, then deletes nothing", async () => {
      const upload = await seed({ ageMs: 3 * DAY });
      const attached = gate();
      const commit = gate();
      const saving = withTransaction(media.db, async (tx) => {
        await attach(tx, urlOf(upload));
        attached.open();
        await commit.promise;
      });
      await attached.promise;
      const cutoff = new Date(NOW.getTime() - DAY);
      // The page was chosen BEFORE the save: the statement itself must still refuse an attached row.
      const deleting = withTransaction(media.db, (tx) =>
        repository.deleteAbandonedUploadsByIds(tx, [upload.id], cutoff),
      );
      await waitUntilSomeoneWaitsForALock();
      commit.open();
      await saving;
      expect(await deleting).toEqual([]);
      expect(await rowExists(upload.id)).toBe(true);
      expect(await fileExists(upload.path)).toBe(true);
    });
  });

  describe("through the application", () => {
    it("is the seventh job of the runner (before job 8, the shipment tracking): reported with its counts, and a saved URL of a deleted upload answers 400 upload_not_found", async () => {
      const response = await fetch(`${media.baseUrl}/admin/media/uploads`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-fluxkit-csrf": "1" },
        body: await images.jpeg(8, 8),
      });
      expect(response.status).toBe(201);
      const uploaded = (await response.json()) as { id: string; url: string };
      const key = uploaded.url.slice(TEST_MEDIA_BASE_URL.length + 1);
      seededIds.push(uploaded.id);
      expect(await fileExists(pathOfKey(key))).toBe(true);
      await pool.query("update media_upload set created_at = $2 where id = $1", [
        uploaded.id,
        new Date(NOW.getTime() - 2 * DAY),
      ]);

      const reports = await media.app.get(JobsRunner).runAll(NOW);
      const report = reports.find((candidate) => candidate.name === "delete-abandoned-uploads");
      expect(report).toEqual({
        name: "delete-abandoned-uploads",
        ok: true,
        result: { deleted: 1, truncated: false, fileErrors: 0 },
      });
      // Job 7 is the last cleanup before the outbound calls: the shipment tracking (job 8), the mail jobs (9, 10), then
      // the payment reconcile (11) and the privacy retention (12).
      expect(reports.map((entry) => entry.name).slice(-6, -1)).toEqual([
        "delete-abandoned-uploads",
        "track-shipments",
        "send-emails",
        "purge-email-messages",
        "reconcile-payments",
      ]);
      expect(await fileExists(pathOfKey(key))).toBe(false);

      const type = await http<{ id: string }>(media.baseUrl, "POST", "/admin/product-types", {
        body: { code: `cleanup_${randomBytes(4).toString("hex")}`, name: { uk: "Тип" } },
      });
      expect(type.status).toBe(201);
      const created = await http<{ id: string }>(media.baseUrl, "POST", "/admin/products", {
        body: { productTypeId: type.body.id, title: { uk: "Товар" } },
      });
      try {
        const saved = await http<{ errors: { path: string; code: string }[] }>(
          media.baseUrl,
          "PUT",
          `/admin/products/${created.body.id}/media`,
          { body: { media: [{ url: uploaded.url }] } },
        );
        expect(saved.status).toBe(400);
        expect(saved.body.errors).toEqual([
          expect.objectContaining({ path: "media.0.url", code: "upload_not_found" }),
        ]);
      } finally {
        await pool.query("delete from product where id = $1", [created.body.id]);
        await pool.query("delete from product_type where id = $1", [type.body.id]);
      }
    });
  });
});
