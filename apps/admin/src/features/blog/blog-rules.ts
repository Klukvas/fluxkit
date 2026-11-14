/*
 * The API's blog rules the form repeats for early feedback (`docs/api/features-blog.md`, "Rules"): text lengths, the body
 * limit and the slug pattern. Copied, not imported, because the admin bundle never carries core or the feature package (zod,
 * the Markdown parser); `blog-rules.spec.ts` compares them with the API's own values. The server decides: Markdown errors
 * come from the save's answer only (no parser in the admin, plan section 10).
 */

export const BLOG_TEXT_LIMITS = {
  /** Characters (Unicode code points), like core `validateI18nText`. */
  title: 120,
  excerpt: 300,
  seoTitle: 70,
  seoDescription: 160,
  coverAlt: 150,
} as const;

export type BlogTextField = keyof typeof BLOG_TEXT_LIMITS;

/** The Markdown source of one locale, in UTF-16 code units (core `MARKDOWN_LIMITS.maxLength`). */
export const BLOG_BODY_MAX_LENGTH = 40_000;

/** Core `SLUG_PATTERN` and its length limit (core `validateSlug`). */
export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const BLOG_SLUG_PATTERN_SOURCE = "[a-z0-9]+(-[a-z0-9]+)*";
export const BLOG_SLUG_MAX_LENGTH = 160;

/** The list's page size: the API's default for `GET /admin/blog/posts`. */
export const BLOG_LIST_LIMIT = 50;

/** Length in Unicode code points, the way the API counts characters. */
export function codePoints(text: string): number {
  return [...text].length;
}
