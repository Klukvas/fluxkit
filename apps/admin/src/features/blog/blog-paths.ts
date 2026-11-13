import { readEnum, writeQuery } from "../../router/query";
import { BLOG_POST_STATES, type BlogPostState } from "./blog-api";
import { BLOG_PATHS } from "./blog-route-paths";
import { BLOG_LIST_LIMIT } from "./blog-rules";

export { BLOG_PATHS };

/** The list's state in the URL: the state filter and the page (the API pages by number, `limit` 50). */
export interface BlogListQuery {
  status?: BlogPostState;
  page: number;
}

/** The API's offset cap of `(page - 1) * limit` (core `CATALOG_LIMITS.maxOffset`). */
const MAX_OFFSET = 10_000;
const MAX_PAGE = Math.floor(MAX_OFFSET / BLOG_LIST_LIMIT) + 1;

/** Readers never throw: a hand-edited bad value is "no filter" or the first page. */
export function readBlogListQuery(params: URLSearchParams): BlogListQuery {
  const status = readEnum(params, "status", BLOG_POST_STATES);
  const text = params.get("page");
  const number = text !== null && /^\d{1,6}$/.test(text) ? Number(text) : 1;
  const page = number >= 1 && number <= MAX_PAGE ? number : 1;
  return { ...(status === undefined ? {} : { status }), page };
}

export function writeBlogListQuery(query: BlogListQuery): string {
  return writeQuery({ status: query.status, page: query.page }, { page: 1 });
}

export function blogListHref(query: BlogListQuery): string {
  return `${BLOG_PATHS.list}${writeBlogListQuery(query)}`;
}

/** The pager works in offsets (`ListPager`); the blog's API in page numbers. */
export function offsetOfPage(page: number): number {
  return (page - 1) * BLOG_LIST_LIMIT;
}

export function pageOfOffset(offset: number): number {
  return Math.floor(offset / BLOG_LIST_LIMIT) + 1;
}
