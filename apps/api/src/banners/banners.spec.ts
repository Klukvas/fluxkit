import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_STORAGE_PORT } from "@fluxkit/core";
import type { ProblemBody } from "../common/problem.filter.js";
import { withTransaction } from "../common/transaction.js";
import { deleteAbandonedUploads } from "../jobs/delete-abandoned-uploads.job.js";
import { JobsRepository } from "../jobs/jobs.repository.js";
import type { UploadStorage } from "../media/local-media-storage.js";
import { MediaAttachService } from "../media/media-attach.service.js";
import { MEDIA_CONFIG, type MediaConfig } from "../media/media-config.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { http, type HttpOptions } from "../test/http.js";
import { startMediaApp, TEST_ADMIN_HEADER, type MediaApp } from "../test/media-app.js";
import * as images from "../test/media-images.js";
import { ensureMigrated } from "../test/migrate.js";
import type { BannerList, BannerResponse } from "./banners.schemas.js";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

interface Uploaded {
  id: string;
  url: string;
  width: number;
  height: number;
}

type Result<T> = { status: number; body: T & ProblemBody; headers: Headers };

describe("admin home banners (ADR 0046; real Postgres, local media driver)", () => {
  const clock = new FakeClock(NOW);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let media: MediaApp;

  function call<T = BannerResponse>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    options: HttpOptions & { as?: string } = {},
  ): Promise<Result<T>> {
    const { as, ...rest } = options;
    return http<T & ProblemBody>(media.baseUrl, method, path, {
      ...rest,
      body,
      headers: { ...(as === undefined ? {} : { [TEST_ADMIN_HEADER]: as }), ...rest.headers },
    });
  }

  async function upload(width = 64, height = 32): Promise<Uploaded> {
    const response = await fetch(`${media.baseUrl}/admin/media/uploads`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-fluxkit-csrf": "1" },
      body: await images.jpeg(width, height),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Uploaded;
  }

  async function attachedAt(id: string): Promise<Date | null | undefined> {
    const result = await pool.query<{ first_attached_at: Date | null }>(
      "select first_attached_at from media_upload where id = $1",
      [id],
    );
    return result.rows[0]?.first_attached_at;
  }

  async function bannerCount(): Promise<number> {
    const result = await pool.query<{ count: number }>("select count(*)::int as count from banner");
    return result.rows[0]?.count ?? -1;
  }

  let picture: Uploaded;

  function card(changes: Record<string, unknown> = {}) {
    return {
      title: { uk: "Розпродаж", en: "Sale" },
      imageUploadId: picture.id,
      link: "/catalog",
      ...changes,
    };
  }

  async function create(changes: Record<string, unknown> = {}): Promise<BannerResponse> {
    const created = await call("POST", "/admin/banners", card(changes));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body;
  }

  beforeAll(async () => {
    await ensureMigrated();
    // Spec files run one at a time on the shared database: start from an empty banner list.
    await pool.query("delete from banner");
    media = await startMediaApp({ clock, defaultLocale: "uk", locales: ["uk", "en"] });
    picture = await upload();
  });

  beforeEach(async () => {
    clock.set(NOW);
    await pool.query("delete from banner");
  });

  afterAll(async () => {
    try {
      await pool.query("delete from banner");
    } finally {
      await media.close();
      await pool.end();
    }
  });

  describe("create, read, change, delete", () => {
    it("creates a card banner at the end, inactive by default, and reads it back", async () => {
      const first = await call("POST", "/admin/banners", card());
      expect(first.status).toBe(201);
      expect(first.headers.get("location")).toBe(`/admin/banners/${first.body.id}`);
      expect(first.body).toEqual({
        id: expect.any(String),
        layout: "card",
        title: { uk: "Розпродаж", en: "Sale" },
        text: null,
        imageAlt: null,
        image: {
          uploadId: picture.id,
          url: picture.url,
          width: picture.width,
          height: picture.height,
        },
        images: [],
        link: "/catalog",
        tone: "surface",
        position: 0,
        isActive: false,
        startsAt: null,
        endsAt: null,
        state: "inactive",
        shownOnStorefront: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const second = await create({ tone: "accent", isActive: true });
      expect(second).toMatchObject({ position: 1, tone: "accent", state: "live" });
      expect(second.shownOnStorefront).toBe(true);

      const list = await call<BannerList>("GET", "/admin/banners");
      expect(list.status).toBe(200);
      expect(list.body.items.map((item) => item.id)).toEqual([first.body.id, second.id]);
      expect((await call("GET", `/admin/banners/${second.id}`)).body).toEqual(second);
    });

    it("stores start and end in UTC, accepts an offset, and reports scheduled and expired", async () => {
      const scheduled = await create({ isActive: true, startsAt: "2026-11-05T15:00:00+03:00" });
      expect(scheduled.startsAt).toBe("2026-11-05T12:00:00.000Z");
      expect(scheduled.state).toBe("live");
      const later = await create({ isActive: true, startsAt: at(1) });
      expect(later.state).toBe("scheduled");
      const gone = await create({ isActive: true, startsAt: at(-2000), endsAt: at(0) });
      expect(gone).toMatchObject({ state: "expired", shownOnStorefront: false });
    });

    it("changes only the given fields; null clears an optional text", async () => {
      const created = await create({ text: { uk: "Знижки" }, imageAlt: { uk: "Взуття" } });
      const patched = await call("PATCH", `/admin/banners/${created.id}`, {
        text: null,
        link: "https://example.com/sale",
        isActive: true,
      });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({
        title: created.title,
        text: null,
        imageAlt: { uk: "Взуття" },
        link: "https://example.com/sale",
        isActive: true,
        state: "live",
      });
    });

    it("switching to the image layout clears the stored title and text; switching back needs a title", async () => {
      const created = await create({ text: { uk: "Знижки" } });
      const refused = await call("PATCH", `/admin/banners/${created.id}`, { layout: "image" });
      expect(refused.status).toBe(400);
      expect(refused.body.errors).toEqual([
        expect.objectContaining({ path: "imageAlt", code: "required" }),
      ]);
      const image = await call("PATCH", `/admin/banners/${created.id}`, {
        layout: "image",
        imageAlt: { uk: "Осінній розпродаж: знижки до 30 %" },
      });
      expect(image.status).toBe(200);
      expect(image.body).toMatchObject({ layout: "image", title: null, text: null });
      const back = await call("PATCH", `/admin/banners/${created.id}`, { layout: "card" });
      expect(back.status).toBe(400);
      expect(back.body.errors).toEqual([
        expect.objectContaining({ path: "title", code: "required" }),
      ]);
    });

    it("deletes a banner (204), then answers 404; the upload stays, still attached", async () => {
      const created = await create({ images: [{ locale: "en", imageUploadId: picture.id }] });
      expect((await call("DELETE", `/admin/banners/${created.id}`)).status).toBe(204);
      expect((await call("GET", `/admin/banners/${created.id}`)).status).toBe(404);
      expect((await call("DELETE", `/admin/banners/${created.id}`)).status).toBe(404);
      expect((await call("PATCH", `/admin/banners/${created.id}`, { isActive: true })).status).toBe(
        404,
      );
      const rows = await pool.query("select 1 from banner_image where banner_id = $1", [
        created.id,
      ]);
      expect(rows.rowCount).toBe(0);
      expect(await attachedAt(picture.id)).toBeInstanceOf(Date);
    });

    it("answers 400 for a malformed id", async () => {
      expect((await call("GET", "/admin/banners/not-a-uuid")).status).toBe(400);
    });
  });

  describe("request validation (400 validation_failed)", () => {
    it("refuses unknown fields, a missing picture and wrong types (strict schemas)", async () => {
      const unknown = await call("POST", "/admin/banners", card({ html: "<b>x</b>" }));
      expect(unknown.status).toBe(400);
      expect(unknown.body.errors).toEqual([{ path: "html", code: "unknown_field" }]);
      const missing = await call("POST", "/admin/banners", { title: { uk: "x" }, link: "/" });
      expect(missing.status).toBe(400);
      expect(missing.body.errors?.map((error) => [error.path, error.code])).toEqual([
        ["imageUploadId", "required"],
      ]);
      const wrong = await call("POST", "/admin/banners", card({ tone: "neon", layout: "html" }));
      expect(wrong.status).toBe(400);
      expect(wrong.body.errors?.map((error) => error.path).sort()).toEqual(["layout", "tone"]);
      const patch = await call("PATCH", `/admin/banners/${randomUUID()}`, { position: 3 });
      expect(patch.status).toBe(400);
      expect(patch.body.errors).toEqual([{ path: "position", code: "unknown_field" }]);
      expect(await bannerCount()).toBe(0);
    });

    it.each([
      "javascript:alert(1)",
      "http://example.com",
      "//evil.example",
      "/uk/catalog",
      "/%2e%2e/admin",
      "/a/../b",
      "https://user:pw@example.com",
      "catalog",
      "/catalog page",
      `/${"a".repeat(2048)}`,
    ])("refuses the link %j as invalid_link at link", async (link) => {
      const result = await call("POST", "/admin/banners", card({ link }));
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "link", code: "invalid_link" }),
      ]);
      expect(await bannerCount()).toBe(0);
    });

    it("applies the layout rules: card needs a title (1..80), image needs its description and refuses texts", async () => {
      const noTitle = await call("POST", "/admin/banners", card({ title: { en: "Sale" } }));
      expect(noTitle.body.errors).toEqual([
        expect.objectContaining({ path: "title.uk", code: "default_locale_missing" }),
      ]);
      const longTitle = await call(
        "POST",
        "/admin/banners",
        card({ title: { uk: "я".repeat(81) } }),
      );
      expect(longTitle.body.errors).toEqual([
        expect.objectContaining({ path: "title.uk", code: "too_long" }),
      ]);
      const image = await call(
        "POST",
        "/admin/banners",
        card({ layout: "image", text: { uk: "x" } }),
      );
      expect(image.status).toBe(400);
      expect(image.body.errors).toEqual([
        expect.objectContaining({ path: "title", code: "not_allowed_for_layout" }),
        expect.objectContaining({ path: "text", code: "not_allowed_for_layout" }),
        expect.objectContaining({ path: "imageAlt", code: "required" }),
      ]);
      const pl = await call("POST", "/admin/banners", card({ text: { uk: "x", pl: "y" } }));
      expect(pl.body.errors).toEqual([
        expect.objectContaining({ path: "text.pl", code: "locale_not_allowed" }),
      ]);
      expect(await bannerCount()).toBe(0);
    });

    it("refuses a window that does not end after it starts, and instants outside 2000..2200", async () => {
      const same = await call("POST", "/admin/banners", card({ startsAt: at(0), endsAt: at(0) }));
      expect(same.body.errors).toEqual([{ path: "endsAt", code: "invalid_window" }]);
      const early = await call(
        "POST",
        "/admin/banners",
        card({ startsAt: "1999-12-31T23:59:59Z" }),
      );
      expect(early.body.errors).toEqual([{ path: "startsAt", code: "out_of_range" }]);
      const naive = await call("POST", "/admin/banners", card({ startsAt: "2026-11-05T12:00:00" }));
      expect(naive.status).toBe(400);
      expect(naive.body.errors?.[0]?.path).toBe("startsAt");
      const created = await create({ startsAt: at(0) });
      const patched = await call("PATCH", `/admin/banners/${created.id}`, { endsAt: at(-1) });
      expect(patched.body.errors).toEqual([{ path: "endsAt", code: "invalid_window" }]);
    });

    it("refuses a picture locale outside the content locales and a repeated one", async () => {
      const result = await call(
        "POST",
        "/admin/banners",
        card({
          images: [
            { locale: "pl", imageUploadId: picture.id },
            { locale: "en", imageUploadId: picture.id },
            { locale: "en", imageUploadId: picture.id },
          ],
        }),
      );
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        { path: "images.0.locale", code: "locale_not_allowed" },
        { path: "images.2.locale", code: "duplicate" },
      ]);
    });
  });

  describe("pictures: uploads by id, marked attached in the save's transaction", () => {
    it("refuses an unknown upload id at its field and creates nothing", async () => {
      const missing = randomUUID();
      const result = await call(
        "POST",
        "/admin/banners",
        card({
          imageUploadId: missing,
          images: [
            { locale: "uk", imageUploadId: picture.id },
            { locale: "en", imageUploadId: missing },
          ],
        }),
      );
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "imageUploadId", code: "upload_not_found" }),
        expect.objectContaining({ path: "images.1.imageUploadId", code: "upload_not_found" }),
      ]);
      expect(await bannerCount()).toBe(0);
    });

    it("marks the default and every locale picture attached when the banner is saved", async () => {
      const [main, english] = [await upload(), await upload(80, 40)];
      expect(await attachedAt(main.id)).toBeNull();
      expect(await attachedAt(english.id)).toBeNull();
      const created = await create({
        imageUploadId: main.id.toUpperCase(),
        images: [{ locale: "en", imageUploadId: english.id }],
      });
      expect(created.image.uploadId).toBe(main.id);
      expect(created.images).toEqual([
        { locale: "en", uploadId: english.id, url: english.url, width: 80, height: 40 },
      ]);
      expect(await attachedAt(main.id)).toBeInstanceOf(Date);
      expect(await attachedAt(english.id)).toBeInstanceOf(Date);
    });

    it("a PATCH that refuses an unknown upload changes nothing and marks nothing", async () => {
      const created = await create();
      const fresh = await upload();
      const result = await call("PATCH", `/admin/banners/${created.id}`, {
        title: { uk: "Змінено" },
        images: [
          { locale: "en", imageUploadId: fresh.id },
          { locale: "uk", imageUploadId: randomUUID() },
        ],
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "images.1.imageUploadId", code: "upload_not_found" }),
      ]);
      expect((await call("GET", `/admin/banners/${created.id}`)).body).toEqual(created);
      expect(await attachedAt(fresh.id)).toBeNull();
    });

    it("replacing or removing a locale picture stops referencing the old upload; it stays attached (never deleted by job 7)", async () => {
      const [english, replacement] = [await upload(), await upload()];
      const created = await create({ images: [{ locale: "en", imageUploadId: english.id }] });
      const replaced = await call("PATCH", `/admin/banners/${created.id}`, {
        images: [{ locale: "en", imageUploadId: replacement.id }],
      });
      expect(replaced.status).toBe(200);
      expect(replaced.body.images.map((image) => image.uploadId)).toEqual([replacement.id]);
      expect(await attachedAt(replacement.id)).toBeInstanceOf(Date);
      // No foreign key holds the old upload any more: its row can go, but it is attached, so job 7 keeps it.
      expect(await attachedAt(english.id)).toBeInstanceOf(Date);
      const removed = await call("PATCH", `/admin/banners/${created.id}`, { images: [] });
      expect(removed.body.images).toEqual([]);
      // A PATCH without `images` keeps the own pictures.
      await call("PATCH", `/admin/banners/${created.id}`, {
        images: [{ locale: "uk", imageUploadId: english.id }],
      });
      const kept = await call("PATCH", `/admin/banners/${created.id}`, { tone: "accent" });
      expect(kept.body.images.map((image) => image.locale)).toEqual(["uk"]);
    });

    it("job 7 keeps every picture a banner saved, and still deletes an unattached upload", async () => {
      const [main, english, abandoned] = [await upload(), await upload(), await upload()];
      await create({
        imageUploadId: main.id,
        images: [{ locale: "en", imageUploadId: english.id }],
      });
      const ids = [main.id, english.id, abandoned.id];
      await pool.query(
        "update media_upload set created_at = now() - interval '48 hours' where id = any($1::uuid[])",
        [ids],
      );
      const repository = media.app.get(JobsRepository);
      vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      try {
        const result = await deleteAbandonedUploads(
          {
            database: media.db,
            // Only this spec's uploads: rows another spec left must not be touched here.
            repository: {
              lockAbandonedUploadIds: async (db, cutoff, limit) =>
                (await repository.lockAbandonedUploadIds(db, cutoff, limit)).filter((id) =>
                  ids.includes(id),
                ),
              deleteAbandonedUploadsByIds: (db, chosen, cutoff) =>
                repository.deleteAbandonedUploadsByIds(db, chosen, cutoff),
            },
            storage: media.app.get<UploadStorage>(MEDIA_STORAGE_PORT),
            config: media.app.get<MediaConfig>(MEDIA_CONFIG),
          },
          new Date(),
        );
        expect(result.deleted).toBe(1);
      } finally {
        vi.restoreAllMocks();
      }
      const left = await pool.query<{ id: string }>(
        "select id from media_upload where id = any($1::uuid[]) order by id",
        [ids],
      );
      expect(left.rows.map((row) => row.id)).toEqual([main.id, english.id].sort());
    });

    it("the foreign keys refuse deleting an upload a banner uses; deleting the banner cascades its own pictures", async () => {
      const [main, english] = [await upload(), await upload()];
      const created = await create({
        imageUploadId: main.id,
        images: [{ locale: "en", imageUploadId: english.id }],
      });
      for (const id of [main.id, english.id]) {
        await expect(
          pool.query("delete from media_upload where id = $1", [id]),
        ).rejects.toMatchObject({
          code: "23503",
        });
      }
      await pool.query("delete from banner where id = $1", [created.id]);
      const rows = await pool.query("select 1 from banner_image where banner_id = $1", [
        created.id,
      ]);
      expect(rows.rowCount).toBe(0);
    });

    it("markAttachedByIds marks under one UPDATE: a save waits for an uncommitted job delete and then answers upload_not_found", async () => {
      const uploaded = await upload();
      const attach = media.app.get(MediaAttachService);
      const job = await pool.connect();
      try {
        await job.query("begin");
        const deleted = await job.query(
          "delete from media_upload where id = $1 and first_attached_at is null returning id",
          [uploaded.id],
        );
        expect(deleted.rowCount).toBe(1);
        const save = withTransaction(media.db, (tx) =>
          attach.markAttachedByIds(tx, [{ path: "imageUploadId", id: uploaded.id }]),
        );
        const settled = await Promise.race([
          save.then(
            () => "settled",
            () => "settled",
          ),
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
        ]);
        expect(settled).toBe("waiting");
        await job.query("commit");
        await expect(save).rejects.toMatchObject({
          code: "validation_failed",
          errors: [expect.objectContaining({ path: "imageUploadId", code: "upload_not_found" })],
        });
      } finally {
        job.release();
      }
    });
  });

  describe("permissions (catalog.read / catalog.write) and CSRF", () => {
    it("a viewer reads but cannot write (403); a manager writes; signed out is 401 everywhere", async () => {
      const existing = await create();
      const writes: [string, string, unknown][] = [
        ["POST", "/admin/banners", card()],
        ["PATCH", `/admin/banners/${existing.id}`, { tone: "accent" }],
        ["DELETE", `/admin/banners/${existing.id}`, undefined],
        ["PUT", "/admin/banners/order", { ids: [existing.id] }],
      ];
      for (const [method, path, body] of writes) {
        const result = await call(method as "POST", path, body, { as: "viewer" });
        expect(result.status, `${method} ${path}`).toBe(403);
        expect(result.body.code).toBe("forbidden");
      }
      expect((await call("GET", "/admin/banners", undefined, { as: "viewer" })).status).toBe(200);
      expect(
        (await call("GET", `/admin/banners/${existing.id}`, undefined, { as: "viewer" })).status,
      ).toBe(200);
      expect(await bannerCount()).toBe(1);

      for (const [method, path, body] of [
        ...writes,
        ["GET", "/admin/banners", undefined],
        ["GET", `/admin/banners/${existing.id}`, undefined],
      ] as [string, string, unknown][]) {
        const result = await call(method as "POST", path, body, { as: "anonymous" });
        expect(result.status, `${method} ${path}`).toBe(401);
      }

      const managed = await call("POST", "/admin/banners", card(), { as: "manager" });
      expect(managed.status).toBe(201);
      const managedPatch = await call(
        "PATCH",
        `/admin/banners/${managed.body.id}`,
        { tone: "accent" },
        { as: "manager" },
      );
      expect(managedPatch.status).toBe(200);
      expect(
        (await call("DELETE", `/admin/banners/${managed.body.id}`, undefined, { as: "manager" }))
          .status,
      ).toBe(204);
    });

    it("refuses a write without X-Fluxkit-CSRF (403) and creates nothing", async () => {
      const result = await call("POST", "/admin/banners", card(), { csrf: false });
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("forbidden");
      expect(await bannerCount()).toBe(0);
    });

    it("answers admin reads with Cache-Control: no-store", async () => {
      const list = await call("GET", "/admin/banners");
      expect(list.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("the 50 cap (409 rule_violation too_many_banners)", () => {
    async function seedRows(count: number): Promise<void> {
      await pool.query(
        `insert into banner (title, image_upload_id, link, position)
         select jsonb_build_object('uk', 'Банер ' || g), $1, '/catalog', g from generate_series(1, $2::int) as g`,
        [picture.id, count],
      );
    }

    it("allows the 50th banner and refuses the 51st, creating nothing", async () => {
      await seedRows(49);
      expect((await call("POST", "/admin/banners", card())).status).toBe(201);
      const refused = await call("POST", "/admin/banners", card());
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "rule_violation", rule: "too_many_banners" });
      expect(await bannerCount()).toBe(50);
    });

    it("holds under concurrent creates (advisory lock): never more than 50", async () => {
      await seedRows(47);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => call("POST", "/admin/banners", card())),
      );
      const statuses = results.map((result) => result.status).sort();
      expect(statuses).toEqual([201, 201, 201, 409, 409, 409]);
      expect(await bannerCount()).toBe(50);
      const positions = await pool.query<{ position: number }>(
        "select position from banner where position >= 48 order by position",
      );
      expect(positions.rows.map((row) => row.position)).toEqual([48, 49, 50]);
    });
  });

  describe("PUT /admin/banners/order", () => {
    it("rewrites the positions 0..n-1 in the given order", async () => {
      const [a, b, c] = [await create(), await create(), await create()];
      await call("DELETE", `/admin/banners/${b.id}`);
      const d = await create();
      const result = await call<BannerList>("PUT", "/admin/banners/order", {
        ids: [d.id, a.id, c.id],
      });
      expect(result.status).toBe(200);
      expect(result.body.items.map((item) => [item.id, item.position])).toEqual([
        [d.id, 0],
        [a.id, 1],
        [c.id, 2],
      ]);
    });

    it("refuses a list that is not exactly the current set (order_mismatch) and changes nothing", async () => {
      const [a, b] = [await create(), await create()];
      for (const ids of [[a.id], [a.id, b.id, randomUUID()], [a.id, a.id], [b.id, a.id, a.id]]) {
        const result = await call("PUT", "/admin/banners/order", { ids });
        expect(result.status, JSON.stringify(ids)).toBe(400);
        expect(result.body.errors).toEqual([
          expect.objectContaining({ path: "ids", code: "order_mismatch" }),
        ]);
      }
      const list = await call<BannerList>("GET", "/admin/banners");
      expect(list.body.items.map((item) => [item.id, item.position])).toEqual([
        [a.id, 0],
        [b.id, 1],
      ]);
      expect((await call("PUT", "/admin/banners/order", { ids: ["x"] })).status).toBe(400);
    });
  });
});
