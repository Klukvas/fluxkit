/**
 * The blog's addresses and its list's `?page=`. Pure. Paths are locale-less (`localizedHref` adds the locale).
 */
import { maxPage } from "../../../../lib/catalog-query";
import { BLOG_PAGE_SIZE } from "./blog-api";

export const BLOG_PATH = "/blog";

/** The API's slug rule (core `SLUG_PATTERN`, at most 160 characters): anything else names no post. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 160;

/** The last list page the API serves (`(page - 1) * limit` at most 10 000, like the catalog). */
export const BLOG_MAX_PAGE = maxPage(BLOG_PAGE_SIZE);

/**
 * Whether a path segment can name a post. A page checks it before reading the API, so a made-up address costs no request and
 * no data cache entry (`next start` keeps every cached answer on disk).
 */
export function isPostSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && SLUG.test(value);
}

export function blogPostPath(slug: string): string {
  return `${BLOG_PATH}/${encodeURIComponent(slug)}`;
}

/** The list page `page`: `/blog` for the first, `/blog?page=N` after it. */
export function blogListPath(page: number): string {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("A page number must be a whole number from 1.");
  }
  return page === 1 ? BLOG_PATH : `${BLOG_PATH}?page=${String(page)}`;
}

/**
 * The list page an address asks for, repaired like the catalog's (`normalizeCatalogQuery`): a `page` that is not a whole
 * number from 1 is page 1, one past the API's cap the last page the API serves. `canonical` is false when the address does not
 * carry exactly what `blogListPath` writes for it (the page redirects there). Other parameters are not the blog's and are
 * left alone (the canonical link names the clean address).
 */
export function normalizeBlogPage(
  search: Readonly<Record<string, string | string[] | undefined>>,
): { page: number; canonical: boolean } {
  const raw = search.page;
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const first = values[0];
  const number = first !== undefined && /^\d{1,15}$/.test(first) ? Number(first) : 1;
  const page = Math.min(Math.max(number, 1), BLOG_MAX_PAGE);
  const written = page === 1 ? [] : [String(page)];
  const canonical =
    values.length === written.length && values.every((value, index) => value === written[index]);
  return { page, canonical };
}
