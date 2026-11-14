import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/** A text per locale (`{"uk": "...", "en": "..."}`), the catalog's convention (ADR 0006). */
export type LocaleTexts = Record<string, string>;

/*
 * The blog's only table (plan docs/plans/2026-11-13-blog.md, section 5). `cover_upload_id` is a plain uuid here: a feature
 * cannot import the core `media_upload` table, so its foreign key (`blog_post_cover_upload_id_fkey`, ON DELETE RESTRICT) is
 * added by hand at the end of `drizzle/0000_blog_post.sql` (ADR 0049); the drift check never sees it and
 * `migration.spec.ts` asserts it. No author or admin id column: the table holds no personal data (owner's answer 8 (a)).
 */
export const blogPost = pgTable(
  "blog_post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    title: jsonb("title").$type<LocaleTexts>().notNull(),
    excerpt: jsonb("excerpt").$type<LocaleTexts>(),
    body: jsonb("body")
      .$type<LocaleTexts>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    seoTitle: jsonb("seo_title").$type<LocaleTexts>(),
    seoDescription: jsonb("seo_description").$type<LocaleTexts>(),
    coverUploadId: uuid("cover_upload_id"),
    coverAlt: jsonb("cover_alt").$type<LocaleTexts>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("blog_post_slug_key").on(t.slug),
    check("blog_post_status_check", sql`${t.status} in ('draft', 'published')`),
    check(
      "blog_post_published_at_check",
      sql`${t.status} = 'draft' or ${t.publishedAt} is not null`,
    ),
    check("blog_post_title_check", sql`jsonb_typeof(${t.title}) = 'object'`),
    check(
      "blog_post_excerpt_check",
      sql`${t.excerpt} is null or jsonb_typeof(${t.excerpt}) = 'object'`,
    ),
    check("blog_post_body_check", sql`jsonb_typeof(${t.body}) = 'object'`),
    check(
      "blog_post_seo_title_check",
      sql`${t.seoTitle} is null or jsonb_typeof(${t.seoTitle}) = 'object'`,
    ),
    check(
      "blog_post_seo_description_check",
      sql`${t.seoDescription} is null or jsonb_typeof(${t.seoDescription}) = 'object'`,
    ),
    check(
      "blog_post_cover_alt_check",
      sql`${t.coverAlt} is null or jsonb_typeof(${t.coverAlt}) = 'object'`,
    ),
    index("blog_post_public_idx")
      .on(t.publishedAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'published'`),
    index("blog_post_updated_idx").on(t.updatedAt.desc(), t.id.desc()),
  ],
);

export type BlogPostRow = typeof blogPost.$inferSelect;
export type NewBlogPostRow = typeof blogPost.$inferInsert;
