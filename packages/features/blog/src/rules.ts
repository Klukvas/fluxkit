import { CATALOG_LIMITS, MARKDOWN_LIMITS } from "@fluxkit/core";

/*
 * The blog's pure rules (plan docs/plans/2026-11-13-blog.md, sections 5 and 6): limits, the public-post predicate, the admin
 * state and the publish rule. No I/O; `now` is always a parameter.
 */

/** Text lengths in characters (Unicode code points, like core `validateI18nText`), page sizes and caps. */
export const BLOG_LIMITS = Object.freeze({
  titleMaxLength: 120,
  excerptMaxLength: 300,
  /** The Markdown source of one locale, in UTF-16 code units (core `MARKDOWN_LIMITS.maxLength`). */
  bodyMaxLength: MARKDOWN_LIMITS.maxLength,
  seoTitleMaxLength: 70,
  seoDescriptionMaxLength: 160,
  coverAltMaxLength: 150,
  storeDefaultPageSize: 12,
  storeMaxPageSize: 50,
  adminDefaultPageSize: 50,
  adminMaxPageSize: CATALOG_LIMITS.maxPageSize,
  /** The catalog's offset cap: `(page - 1) * limit` may not exceed it. */
  maxOffset: CATALOG_LIMITS.maxOffset,
  /** `GET /store/blog/sitemap` lists at most this many posts, the newest first (`truncated: true` beyond). */
  sitemapMaxItems: 5_000,
});

/** The bounds of a publish date, like the banners' window: from 2000-01-01 (inclusive) to 2200-01-01 (exclusive), UTC. */
const PUBLISHED_AT_MIN = Date.UTC(2000, 0, 1);
const PUBLISHED_AT_MAX = Date.UTC(2200, 0, 1);

export const BLOG_POST_STATUSES = ["draft", "published"] as const;
export type BlogPostStatus = (typeof BLOG_POST_STATUSES)[number];

/** The admin's view of a post: `scheduled` is a published post whose date is still ahead. */
export const BLOG_POST_STATES = ["draft", "scheduled", "published"] as const;
export type BlogPostState = (typeof BLOG_POST_STATES)[number];

export interface PostPublication {
  readonly status: string;
  readonly publishedAt: Date | null;
}

/** Public = published and its date reached (`published_at <= now`); a draft never is, whatever its date. */
export function isPublicPost(post: PostPublication, now: Date): boolean {
  return (
    post.status === "published" &&
    post.publishedAt !== null &&
    post.publishedAt.getTime() <= now.getTime()
  );
}

export function postState(post: PostPublication, now: Date): BlogPostState {
  if (post.status !== "published") return "draft";
  return isPublicPost(post, now) ? "published" : "scheduled";
}

export interface TranslationGap {
  readonly path: string;
  readonly code: "translation_missing";
}

function hasText(texts: Readonly<Record<string, string>>, locale: string): boolean {
  if (!Object.hasOwn(texts, locale)) return false;
  const value = texts[locale];
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The publish rule (owner's answer 6 (a)): a published post has a title and a body in every content locale. Returns one
 * gap per missing (or blank) text, the title's first, each in the order of `locales`; empty = complete.
 */
export function missingTranslations(
  post: {
    readonly title: Readonly<Record<string, string>>;
    readonly body: Readonly<Record<string, string>>;
  },
  locales: readonly string[],
): TranslationGap[] {
  return (["title", "body"] as const).flatMap((field) =>
    locales
      .filter((locale) => !hasText(post[field], locale))
      .map((locale) => ({ path: `${field}.${locale}`, code: "translation_missing" as const })),
  );
}

export function checkPublishedAt(at: Date): boolean {
  const time = at.getTime();
  return time >= PUBLISHED_AT_MIN && time < PUBLISHED_AT_MAX;
}

/** The offset of a 1-based page, or `undefined` when it lies past the catalog's offset cap. */
export function pageOffset(page: number, limit: number): number | undefined {
  const offset = (page - 1) * limit;
  return offset <= BLOG_LIMITS.maxOffset ? offset : undefined;
}
