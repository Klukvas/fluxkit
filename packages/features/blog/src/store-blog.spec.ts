import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminPost, Paged, StorePost, StorePostSummary, StoreSitemap } from "./responses.js";
import { call, MEDIA_BASE_URL, startBlogApp, type BlogApp } from "./test/app.js";
import { createMigratedDatabase, insertUpload, type ScratchDatabase } from "./test/database.js";

const ADMIN = "/admin/blog/posts";
const STORE = "/store/blog/posts";
const HOUR = 3_600_000;

/* Plan sections 6 and 8 (store routes) against a real Postgres scratch database, through HTTP. */
describe("blog store routes", () => {
  let database: ScratchDatabase;
  let blog: BlogApp;
  let counter = 0;

  async function post(
    options: { publishedAt?: Date | "draft"; extra?: Record<string, unknown> } = {},
  ): Promise<AdminPost> {
    counter += 1;
    const n = String(counter);
    const created = await call<AdminPost>(blog, "POST", ADMIN, {
      slug: `post-${n}`,
      title: { uk: `Пост ${n}`, en: `Post ${n}` },
      body: { uk: `## Розділ\n\nТекст **${n}** і [каталог](/catalog).`, en: `Text ${n}.` },
      ...options.extra,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    if (options.publishedAt === "draft") return created.body;
    const published = await call<AdminPost>(blog, "POST", `${ADMIN}/${created.body.id}/publish`, {
      publishedAt: (options.publishedAt ?? new Date(Date.now() - HOUR)).toISOString(),
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return published.body;
  }

  beforeAll(async () => {
    database = await createMigratedDatabase();
    blog = await startBlogApp(database.pool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await blog.app.close();
    await database.drop();
  });

  describe("GET /store/blog/posts/{slug}", () => {
    it("serves a public post with its parsed body, public fields only", async () => {
      const upload = await insertUpload(database.pool, { width: 1200, height: 675 });
      const created = await post({
        extra: {
          excerpt: { uk: "Анонс" },
          seoTitle: { uk: "SEO заголовок", en: "SEO title" },
          coverUploadId: upload.id,
          coverAlt: { uk: "Опис" },
        },
      });
      const result = await call<StorePost>(blog, "GET", `${STORE}/${created.slug}?locale=uk`);
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBeNull();
      expect(Object.keys(result.body).sort()).toEqual(
        [
          "content",
          "cover",
          "excerpt",
          "locales",
          "publishedAt",
          "seoDescription",
          "seoTitle",
          "slug",
          "title",
          "updatedAt",
        ].sort(),
      );
      expect(result.body).toMatchObject({
        slug: created.slug,
        title: created.title["uk"],
        excerpt: "Анонс",
        seoTitle: "SEO заголовок",
        seoDescription: null,
        publishedAt: created.publishedAt,
        locales: ["uk", "en"],
        cover: {
          url: `${MEDIA_BASE_URL}/${upload.storageKey}`,
          width: 1200,
          height: 675,
          alt: "Опис",
        },
      });
      expect(result.body.content.type).toBe("document");
      expect(result.body.content.children[0]).toEqual({
        type: "heading",
        level: 2,
        children: [{ type: "text", value: "Розділ" }],
      });
      expect(JSON.stringify(result.body)).not.toContain(created.id);
      expect(JSON.stringify(result.body)).not.toContain(upload.id);

      const english = await call<StorePost>(blog, "GET", `${STORE}/${created.slug}?locale=en`);
      expect(english.body).toMatchObject({ title: created.title["en"], excerpt: null });
      expect(english.body.cover?.alt).toBeNull();
    });

    it("answers the same 404 body for a draft, a scheduled, an unknown and a malformed slug", async () => {
      const draft = await post({ publishedAt: "draft" });
      const scheduled = await post({ publishedAt: new Date(Date.now() + HOUR) });
      const bodies = [];
      for (const slug of [draft.slug, scheduled.slug, "no-such-post", "Not%20A%20Slug"]) {
        const result = await call(blog, "GET", `${STORE}/${slug}`);
        expect(result.status, slug).toBe(404);
        bodies.push(result.body);
      }
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    });

    it("stops serving an unpublished post", async () => {
      const created = await post();
      expect((await call(blog, "GET", `${STORE}/${created.slug}`)).status).toBe(200);
      await call(blog, "POST", `${ADMIN}/${created.id}/unpublish`);
      expect((await call(blog, "GET", `${STORE}/${created.slug}`)).status).toBe(404);
    });

    it("never serves a stored body that no longer parses, and logs the post id and code", async () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const created = await post();
      await database.pool.query(
        `update blog_post set body = jsonb_set(body, '{uk}', to_jsonb('# Old top heading'::text)) where id = $1`,
        [created.id],
      );
      const result = await call(blog, "GET", `${STORE}/${created.slug}?locale=uk`);
      expect(result.status).toBe(404);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(created.id));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("heading_level"));
      // The other locale still parses and is served.
      expect((await call(blog, "GET", `${STORE}/${created.slug}?locale=en`)).status).toBe(200);
    });

    it("serves a post only in the locales it is written in", async () => {
      const created = await post();
      await database.pool.query(`update blog_post set body = body - 'en' where id = $1`, [
        created.id,
      ]);
      expect((await call(blog, "GET", `${STORE}/${created.slug}?locale=en`)).status).toBe(404);
      const uk = await call<StorePost>(blog, "GET", `${STORE}/${created.slug}?locale=uk`);
      expect(uk.body.locales).toEqual(["uk"]);
    });

    it("answers 400 for a locale the shop does not have and for an unknown query field", async () => {
      const created = await post();
      const locale = await call(blog, "GET", `${STORE}/${created.slug}?locale=fr`);
      expect(locale.status).toBe(400);
      expect(locale.body.errors).toEqual([expect.objectContaining({ path: "locale" })]);
      const extra = await call(blog, "GET", `${STORE}/${created.slug}?preview=1`);
      expect(extra.body.errors).toEqual([{ path: "preview", code: "unknown_field" }]);
    });
  });

  describe("GET /store/blog/posts and GET /store/blog/sitemap", () => {
    let listed: AdminPost[];

    beforeAll(async () => {
      await database.pool.query("delete from blog_post");
      const now = Date.now();
      listed = [];
      for (let index = 0; index < 5; index += 1) {
        listed.push(await post({ publishedAt: new Date(now - (index + 1) * HOUR) }));
      }
      await post({ publishedAt: "draft" });
      await post({ publishedAt: new Date(now + HOUR) });
    });

    it("lists the public posts, newest first, 12 per page by default", async () => {
      const result = await call<Paged<StorePostSummary>>(blog, "GET", STORE);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ total: 5, page: 1, limit: 12 });
      expect(result.body.items.map((item) => item.slug)).toEqual(listed.map((item) => item.slug));
      expect(Object.keys(result.body.items[0] ?? {}).sort()).toEqual(
        ["cover", "excerpt", "publishedAt", "slug", "title", "updatedAt"].sort(),
      );
    });

    it("paginates and caps page sizes and offsets", async () => {
      const second = await call<Paged<StorePostSummary>>(blog, "GET", `${STORE}?limit=2&page=2`);
      expect(second.body.items.map((item) => item.slug)).toEqual(
        listed.slice(2, 4).map((item) => item.slug),
      );
      expect(second.body).toMatchObject({ total: 5, page: 2, limit: 2 });
      expect((await call(blog, "GET", `${STORE}?limit=51`)).status).toBe(400);
      expect((await call(blog, "GET", `${STORE}?page=0`)).status).toBe(400);
      expect((await call(blog, "GET", `${STORE}?limit=50&page=201`)).status).toBe(200);
      const past = await call(blog, "GET", `${STORE}?limit=50&page=202`);
      expect(past.body.errors).toEqual([
        expect.objectContaining({ path: "page", code: "too_big" }),
      ]);
    });

    it("lists the public posts for the sitemap with their locales", async () => {
      const result = await call<StoreSitemap>(blog, "GET", "/store/blog/sitemap");
      expect(result.body.truncated).toBe(false);
      expect(result.body.items).toEqual(
        listed.map((item) => ({
          slug: item.slug,
          updatedAt: item.updatedAt,
          locales: ["uk", "en"],
        })),
      );
    });

    it("lists the newest 5 000 above the cap, with truncated and a warning naming the count", async () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      await database.pool.query(
        `insert into blog_post (slug, status, published_at, title, body)
         select 'bulk-' || n, 'published', now() - interval '1 day' - n * interval '1 second',
                '{"uk": "Т", "en": "T"}', '{"uk": "Т", "en": "T"}'
           from generate_series(1, 4996) as n`,
      );
      const result = await call<StoreSitemap>(blog, "GET", "/store/blog/sitemap");
      expect(result.body.truncated).toBe(true);
      expect(result.body.items).toHaveLength(5000);
      expect(result.body.items.slice(0, 5).map((item) => item.slug)).toEqual(
        listed.map((item) => item.slug),
      );
      expect(result.body.items.at(-1)?.slug).toBe("bulk-4995");
      expect(warn).toHaveBeenCalledWith(
        "The blog sitemap lists the newest 5000 of 5001 public posts.",
      );
    });
  });
});
