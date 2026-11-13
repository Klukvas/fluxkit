import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminPost, AdminPostSummary, Paged } from "./responses.js";
import { call, MEDIA_BASE_URL, startBlogApp, type BlogApp } from "./test/app.js";
import {
  createMigratedDatabase,
  firstAttachedAt,
  insertUpload,
  type ScratchDatabase,
} from "./test/database.js";

const BASE = "/admin/blog/posts";
const COMPLETE = {
  title: { uk: "Як обрати рюкзак", en: "How to pick a backpack" },
  body: { uk: "## Вступ\n\nТекст.", en: "## Intro\n\nText." },
};

/* Plan section 6 (admin routes) against a real Postgres scratch database, through HTTP. */
describe("blog admin routes", () => {
  let database: ScratchDatabase;
  let blog: BlogApp;
  let counter = 0;

  /** A unique default-locale title, so generated slugs never collide between tests. */
  function uniqueTitle(base = "Пост"): { uk: string; en: string } {
    counter += 1;
    return { uk: `${base} ${String(counter)}`, en: `Post ${String(counter)}` };
  }

  async function create(body: Record<string, unknown>): Promise<AdminPost> {
    const result = await call<AdminPost>(blog, "POST", BASE, body);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  async function createComplete(extra: Record<string, unknown> = {}): Promise<AdminPost> {
    return create({ ...COMPLETE, title: uniqueTitle(), ...extra });
  }

  beforeAll(async () => {
    database = await createMigratedDatabase();
    blog = await startBlogApp(database.pool);
  });

  afterAll(async () => {
    await blog.app.close();
    await database.drop();
  });

  describe("POST /admin/blog/posts", () => {
    it("creates a draft with a slug from the default-locale title and points Location to it", async () => {
      const result = await call<AdminPost>(blog, "POST", BASE, {
        title: { uk: "Як обрати рюкзак" },
        excerpt: { uk: "Коротко." },
      });
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(`${BASE}/${result.body.id}`);
      expect(result.body).toMatchObject({
        slug: "yak-obraty-riukzak",
        status: "draft",
        state: "draft",
        slugLocked: false,
        publishedAt: null,
        title: { uk: "Як обрати рюкзак" },
        excerpt: { uk: "Коротко." },
        body: {},
        seoTitle: null,
        cover: null,
        coverUploadId: null,
      });
    });

    it("gives -2, -3 on a generated slug collision and 409 conflict at slug for an explicit one", async () => {
      const title = { uk: "Однаковий заголовок" };
      const slugs = [];
      for (let index = 0; index < 3; index += 1) slugs.push((await create({ title })).slug);
      expect(slugs).toEqual([
        "odnakovyi-zaholovok",
        "odnakovyi-zaholovok-2",
        "odnakovyi-zaholovok-3",
      ]);

      const taken = await call(blog, "POST", BASE, { title, slug: "odnakovyi-zaholovok" });
      expect(taken.status).toBe(409);
      expect(taken.body).toMatchObject({ code: "conflict", field: "slug" });
    });

    it("answers 400 invalid_slug, empty_slug and the i18n codes at their fields", async () => {
      const invalid = await call(blog, "POST", BASE, { title: { uk: "А" }, slug: "Not A Slug" });
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors).toEqual([
        expect.objectContaining({ path: "slug", code: "invalid_slug" }),
      ]);

      const empty = await call(blog, "POST", BASE, { title: { uk: "🙂" } });
      expect(empty.body.errors).toEqual([
        expect.objectContaining({ path: "slug", code: "empty_slug" }),
      ]);

      const texts = await call(blog, "POST", BASE, {
        title: { en: "No default locale", fr: "Non" },
        excerpt: { uk: "x".repeat(301) },
        seoTitle: { uk: " " },
        body: { de: "Text" },
      });
      expect(texts.status).toBe(400);
      expect(texts.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "title.fr", code: "locale_not_allowed" }),
          expect.objectContaining({ path: "title.uk", code: "default_locale_missing" }),
          expect.objectContaining({ path: "excerpt.uk", code: "too_long" }),
          expect.objectContaining({ path: "seoTitle.uk", code: "empty" }),
          expect.objectContaining({ path: "body.de", code: "locale_not_allowed" }),
        ]),
      );
    });

    it("refuses unknown and missing fields with the API's request codes", async () => {
      const result = await call(blog, "POST", BASE, { excerpt: { uk: "x" }, author: "Someone" });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "title", code: "required" }),
          { path: "author", code: "unknown_field" },
        ]),
      );
    });

    it("answers markdown_invalid at body.<locale> with the line and the parser's code", async () => {
      const result = await call(blog, "POST", BASE, {
        title: uniqueTitle(),
        body: {
          uk: "Перший рядок\n\n# Заголовок першого рівня",
          en: "Fine\n\n[link](javascript:alert(1))",
        },
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        {
          path: "body.uk",
          code: "markdown_invalid",
          message: "Line 3: heading_level.",
          line: 3,
          markdownCode: "heading_level",
        },
        {
          path: "body.en",
          code: "markdown_invalid",
          message: "Line 3: link_refused (not_path_or_https).",
          line: 3,
          markdownCode: "link_refused",
          reason: "not_path_or_https",
        },
      ]);
    });

    it("answers markdown_too_long above 40 000 characters, and markdown_invalid for NUL", async () => {
      const result = await call(blog, "POST", BASE, {
        title: uniqueTitle(),
        body: { uk: "a".repeat(40_001), en: "text\u0000" },
      });
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "body.uk", code: "markdown_too_long", line: 1 }),
        expect.objectContaining({
          path: "body.en",
          code: "markdown_invalid",
          markdownCode: "control_character",
        }),
      ]);
    });

    it("attaches the cover upload and describes it", async () => {
      const upload = await insertUpload(database.pool, { width: 1600, height: 900 });
      expect(await firstAttachedAt(database.pool, upload.id)).toBeNull();
      const created = await createComplete({
        coverUploadId: upload.id.toUpperCase(),
        coverAlt: { uk: "Рюкзак" },
      });
      expect(await firstAttachedAt(database.pool, upload.id)).toBeInstanceOf(Date);
      expect(created.cover).toEqual({
        uploadId: upload.id,
        url: `${MEDIA_BASE_URL}/${upload.storageKey}`,
        width: 1600,
        height: 900,
      });
      expect(created.coverAlt).toEqual({ uk: "Рюкзак" });
    });

    it("answers upload_not_found at coverUploadId for an unknown upload and writes nothing", async () => {
      const before = await call<Paged<AdminPostSummary>>(blog, "GET", BASE);
      const result = await call(blog, "POST", BASE, {
        title: uniqueTitle(),
        coverUploadId: "00000000-0000-4000-8000-000000000000",
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "coverUploadId", code: "upload_not_found" }),
      ]);
      const after = await call<Paged<AdminPostSummary>>(blog, "GET", BASE);
      expect(after.body.total).toBe(before.body.total);
    });

    it("leaves the upload unattached when the save fails after attaching (slug conflict)", async () => {
      const first = await createComplete();
      const upload = await insertUpload(database.pool);
      const result = await call(blog, "POST", BASE, {
        title: uniqueTitle(),
        slug: first.slug,
        coverUploadId: upload.id,
      });
      expect(result.status).toBe(409);
      expect(await firstAttachedAt(database.pool, upload.id)).toBeNull();
    });
  });

  describe("PATCH /admin/blog/posts/{id}", () => {
    it("changes only the sent fields, clears with null and keeps the rest", async () => {
      const created = await createComplete({ excerpt: { uk: "Було" }, seoTitle: { uk: "SEO" } });
      const result = await call<AdminPost>(blog, "PATCH", `${BASE}/${created.id}`, {
        excerpt: { uk: "Стало", en: "Now" },
        seoTitle: null,
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        title: created.title,
        body: created.body,
        excerpt: { uk: "Стало", en: "Now" },
        seoTitle: null,
      });
      expect(Date.parse(result.body.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(created.updatedAt),
      );
    });

    it("changes the slug of a draft that was never published, and 409 conflict when it is taken", async () => {
      const other = await createComplete();
      const created = await createComplete();
      const renamed = await call<AdminPost>(blog, "PATCH", `${BASE}/${created.id}`, {
        slug: `renamed-${String(counter)}`,
      });
      expect(renamed.body.slug).toBe(`renamed-${String(counter)}`);
      const taken = await call(blog, "PATCH", `${BASE}/${created.id}`, { slug: other.slug });
      expect(taken.status).toBe(409);
      expect(taken.body).toMatchObject({ code: "conflict", field: "slug" });
    });

    it("locks the slug once the post was published, even back in draft", async () => {
      const created = await createComplete();
      await call(blog, "POST", `${BASE}/${created.id}/publish`);
      await call(blog, "POST", `${BASE}/${created.id}/unpublish`);
      const result = await call(blog, "PATCH", `${BASE}/${created.id}`, { slug: "a-new-address" });
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "slug_locked" });
      const same = await call(blog, "PATCH", `${BASE}/${created.id}`, { slug: created.slug });
      expect(same.status).toBe(200);
    });

    it("re-checks the translations of a published post", async () => {
      const created = await createComplete();
      await call(blog, "POST", `${BASE}/${created.id}/publish`);
      const result = await call(blog, "PATCH", `${BASE}/${created.id}`, {
        body: { uk: "Лише українською" },
      });
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "translation_incomplete" });
      expect(result.body.errors).toEqual([{ path: "body.en", code: "translation_missing" }]);
    });

    it("answers 404 for an unknown post and 400 for a malformed id", async () => {
      const unknown = await call(blog, "PATCH", `${BASE}/00000000-0000-4000-8000-000000000000`, {
        excerpt: null,
      });
      expect(unknown.status).toBe(404);
      const malformed = await call(blog, "PATCH", `${BASE}/not-an-id`, { excerpt: null });
      expect(malformed.status).toBe(400);
      expect(malformed.body.errors).toEqual([expect.objectContaining({ path: "id" })]);
    });
  });

  describe("publish and unpublish", () => {
    it("refuses a post without a title and body in every locale, naming each gap", async () => {
      const created = await create({ title: uniqueTitle(), body: { uk: "Текст" } });
      const result = await call(blog, "POST", `${BASE}/${created.id}/publish`);
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "translation_incomplete" });
      expect(result.body.errors).toEqual([{ path: "body.en", code: "translation_missing" }]);
    });

    it("publishes with now, keeps the date through unpublish and republish", async () => {
      const created = await createComplete();
      const before = Date.now();
      const published = await call<AdminPost>(blog, "POST", `${BASE}/${created.id}/publish`, {});
      expect(published.status).toBe(200);
      expect(published.body).toMatchObject({
        status: "published",
        state: "published",
        slugLocked: true,
      });
      const date = published.body.publishedAt ?? "";
      expect(Date.parse(date)).toBeGreaterThanOrEqual(before - 1000);

      const draft = await call<AdminPost>(blog, "POST", `${BASE}/${created.id}/unpublish`);
      expect(draft.body).toMatchObject({ status: "draft", state: "draft", publishedAt: date });

      const again = await call<AdminPost>(blog, "POST", `${BASE}/${created.id}/publish`);
      expect(again.body.publishedAt).toBe(date);
    });

    it("schedules with a future date and takes another date on request", async () => {
      const created = await createComplete();
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const scheduled = await call<AdminPost>(blog, "POST", `${BASE}/${created.id}/publish`, {
        publishedAt: future,
      });
      expect(scheduled.body).toMatchObject({
        status: "published",
        state: "scheduled",
        publishedAt: future,
      });

      const backdated = await call<AdminPost>(blog, "POST", `${BASE}/${created.id}/publish`, {
        publishedAt: "2026-01-02T03:04:05+02:00",
      });
      expect(backdated.body).toMatchObject({
        state: "published",
        publishedAt: "2026-01-02T01:04:05.000Z",
      });
    });

    it("refuses a date outside [2000, 2200) and an unknown field", async () => {
      const created = await createComplete();
      const late = await call(blog, "POST", `${BASE}/${created.id}/publish`, {
        publishedAt: "2200-01-01T00:00:00Z",
      });
      expect(late.status).toBe(400);
      expect(late.body.errors).toEqual([
        expect.objectContaining({ path: "publishedAt", code: "out_of_range" }),
      ]);
      const unknown = await call(blog, "POST", `${BASE}/${created.id}/publish`, { status: "x" });
      expect(unknown.body.errors).toEqual([{ path: "status", code: "unknown_field" }]);
    });

    it("refuses to publish a stored body that no longer parses", async () => {
      const created = await createComplete();
      await database.pool.query(
        `update blog_post set body = jsonb_set(body, '{en}', to_jsonb('[x](http://old.example.com)'::text)) where id = $1`,
        [created.id],
      );
      const result = await call(blog, "POST", `${BASE}/${created.id}/publish`);
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({
          path: "body.en",
          code: "markdown_invalid",
          markdownCode: "link_refused",
        }),
      ]);
    });

    it("answers 404 for an unknown post", async () => {
      const id = "00000000-0000-4000-8000-000000000000";
      expect((await call(blog, "POST", `${BASE}/${id}/publish`)).status).toBe(404);
      expect((await call(blog, "POST", `${BASE}/${id}/unpublish`)).status).toBe(404);
    });
  });

  describe("GET and DELETE", () => {
    it("lists every post with its state, the most recently updated first, filtered and paginated", async () => {
      const draft = await createComplete();
      const live = await createComplete();
      await call(blog, "POST", `${BASE}/${live.id}/publish`);
      const soon = await createComplete();
      await call(blog, "POST", `${BASE}/${soon.id}/publish`, {
        publishedAt: new Date(Date.now() + 3_600_000).toISOString(),
      });

      const all = await call<Paged<AdminPostSummary>>(blog, "GET", `${BASE}?limit=3`);
      expect(all.body).toMatchObject({ page: 1, limit: 3 });
      expect(all.body.items.map((item) => item.id)).toEqual([soon.id, live.id, draft.id]);
      expect(all.body.items.map((item) => item.state)).toEqual(["scheduled", "published", "draft"]);
      expect(Object.keys(all.body.items[0] ?? {}).sort()).toEqual(
        ["createdAt", "id", "publishedAt", "slug", "state", "status", "title", "updatedAt"].sort(),
      );

      const scheduled = await call<Paged<AdminPostSummary>>(
        blog,
        "GET",
        `${BASE}?status=scheduled`,
      );
      expect(scheduled.body.items.map((item) => item.id)).toEqual([soon.id]);
      const second = await call<Paged<AdminPostSummary>>(blog, "GET", `${BASE}?limit=1&page=2`);
      expect(second.body.items.map((item) => item.id)).toEqual([live.id]);
    });

    it("refuses a page past the offset cap, a bad limit and an unknown state", async () => {
      const past = await call(blog, "GET", `${BASE}?limit=100&page=102`);
      expect(past.status).toBe(400);
      expect(past.body.errors).toEqual([
        expect.objectContaining({ path: "page", code: "too_big" }),
      ]);
      expect((await call(blog, "GET", `${BASE}?limit=100&page=101`)).status).toBe(200);
      expect((await call(blog, "GET", `${BASE}?limit=101`)).status).toBe(400);
      expect((await call(blog, "GET", `${BASE}?status=archived`)).status).toBe(400);
    });

    it("gets a full post and deletes it; the cover upload stays", async () => {
      const upload = await insertUpload(database.pool);
      const created = await createComplete({ coverUploadId: upload.id });
      const got = await call<AdminPost>(blog, "GET", `${BASE}/${created.id}`);
      expect(got.body).toEqual(created);

      const deleted = await call(blog, "DELETE", `${BASE}/${created.id}`);
      expect(deleted.status).toBe(204);
      expect((await call(blog, "GET", `${BASE}/${created.id}`)).status).toBe(404);
      expect((await call(blog, "DELETE", `${BASE}/${created.id}`)).status).toBe(404);
      expect(await firstAttachedAt(database.pool, upload.id)).toBeInstanceOf(Date);
    });
  });
});
