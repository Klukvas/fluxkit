import { z } from "zod";
import { BLOG_LIMITS, BLOG_POST_STATES } from "./rules.js";

/*
 * Request schemas: structure and static limits only. The locale rules (which locales exist, the default one), the slug
 * rule, the Markdown of the bodies and the upload ids depend on configuration or on stored data, so the services check
 * them with the core rules (plan section 6).
 */

/** `{"uk": "...", "en": "..."}`; the locale rules and lengths are checked by the service (core `validateI18nText`). */
const localeTextsSchema = z.record(z.string(), z.string());

/** Checked by the service (core `validateSlug`), so a bad slug answers `invalid_slug` like every other slug error. */
const slugSchema = z.string();

const uploadIdSchema = z.guid();

/** ISO 8601 with `Z` or an offset; the range [2000, 2200) is checked by the service. */
const instantSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** `POST /admin/blog/posts`: a new draft. The slug is generated from the default-locale title when omitted. */
export const createPostSchema = z.strictObject({
  slug: slugSchema.optional(),
  title: localeTextsSchema,
  excerpt: localeTextsSchema.nullable().optional(),
  body: localeTextsSchema.optional(),
  seoTitle: localeTextsSchema.nullable().optional(),
  seoDescription: localeTextsSchema.nullable().optional(),
  coverUploadId: uploadIdSchema.nullable().optional(),
  coverAlt: localeTextsSchema.nullable().optional(),
});

/** `PATCH /admin/blog/posts/{id}`: only the listed fields change; a map replaces the whole map, `null` clears it. */
export const updatePostSchema = z.strictObject({
  slug: slugSchema.optional(),
  title: localeTextsSchema.optional(),
  excerpt: localeTextsSchema.nullable().optional(),
  body: localeTextsSchema.optional(),
  seoTitle: localeTextsSchema.nullable().optional(),
  seoDescription: localeTextsSchema.nullable().optional(),
  coverUploadId: uploadIdSchema.nullable().optional(),
  coverAlt: localeTextsSchema.nullable().optional(),
});

/** `POST /admin/blog/posts/{id}/publish`. Without `publishedAt`: the stored date, else now. */
export const publishPostSchema = z.strictObject({
  publishedAt: instantSchema.optional(),
});

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

function pageSize(defaultSize: number, maxSize: number) {
  return integerString
    .transform(Number)
    .pipe(z.number().int().min(1).max(maxSize))
    .default(defaultSize);
}

const pageNumber = integerString.transform(Number).pipe(z.number().int().min(1)).default(1);

const localeQuery = z.string().min(1).max(16).optional();

/** `GET /admin/blog/posts`. */
export const adminListQuerySchema = z.strictObject({
  status: z.enum(BLOG_POST_STATES).optional(),
  page: pageNumber,
  limit: pageSize(BLOG_LIMITS.adminDefaultPageSize, BLOG_LIMITS.adminMaxPageSize),
});

/** `GET /store/blog/posts`. A missing locale means the default locale. */
export const storeListQuerySchema = z.strictObject({
  locale: localeQuery,
  page: pageNumber,
  limit: pageSize(BLOG_LIMITS.storeDefaultPageSize, BLOG_LIMITS.storeMaxPageSize),
});

/** `GET /store/blog/posts/{slug}`. */
export const storePostQuerySchema = z.strictObject({ locale: localeQuery });

/** `GET /store/blog/sitemap` takes no query. */
export const storeSitemapQuerySchema = z.strictObject({});

export const postIdSchema = z.guid();

export type LocaleTextsInput = z.output<typeof localeTextsSchema>;
export type CreatePostBody = z.output<typeof createPostSchema>;
export type UpdatePostBody = z.output<typeof updatePostSchema>;
export type PublishPostBody = z.output<typeof publishPostSchema>;
export type AdminListQuery = z.output<typeof adminListQuerySchema>;
export type StoreListQuery = z.output<typeof storeListQuerySchema>;
export type StorePostQuery = z.output<typeof storePostQuerySchema>;
