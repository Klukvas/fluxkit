/**
 * The blog pages' reads, through `StoreData.featureRead` (never the last-good copy: an unpublished post never stays visible
 * through an outage). The list goes through the data cache for 60 s (tag `feature:blog`); a post does not (`loadBlogPost`).
 * Pure over `FeatureData`; `blog-data.server.ts` binds it to the running app.
 */
import { pageCountFor } from "../../../../lib/catalog-query";
import { StoreUnavailableError } from "../../../../lib/store-data";
import type { FeatureData } from "../../../../features/types";
import {
  BLOG_PAGE_SIZE,
  GET_POST,
  LIST_POSTS,
  getPostCall,
  listPostsCall,
  type BlogPost,
  type BlogPostList,
} from "./blog-api";

export type BlogListResult =
  | { kind: "ok"; list: BlogPostList; pageCount: number }
  /** A page past the last one: the route redirects to the last page (page 1 of an empty blog). */
  | { kind: "beyond_last_page"; lastPage: number }
  /** The API cannot be read now (already logged by `StoreData`): the page shows its inline error. */
  | { kind: "unavailable" };

/** One list page. A 4xx is a bug of this page (it sends only checked values) and throws: the route's error view. */
export async function loadBlogList(
  data: FeatureData,
  locale: string,
  page: number,
): Promise<BlogListResult> {
  const outcome = await data
    .read(LIST_POSTS, listPostsCall(locale, page))
    .catch((error: unknown) => {
      if (error instanceof StoreUnavailableError) return null;
      throw error;
    });
  if (outcome === null) return { kind: "unavailable" };
  if (!outcome.ok) {
    throw new Error(`${LIST_POSTS} answered ${String(outcome.status)} ${outcome.problem.code}.`);
  }
  const pageCount = pageCountFor(outcome.data.total, BLOG_PAGE_SIZE);
  if (page > 1 && page > pageCount) {
    return { kind: "beyond_last_page", lastPage: Math.max(pageCount, 1) };
  }
  return { kind: "ok", list: outcome.data, pageCount };
}

/**
 * One post, or `null` when the API answers `404` (unknown, draft, scheduled, not written in the locale, or a body that no
 * longer parses: one answer for all). Another 4xx throws; an outage throws `StoreUnavailableError` (the route's error view).
 *
 * Never through the Next data cache: it stores `200` answers only, so once a post is unpublished its revalidation (a `404`)
 * would never replace the cached post, which would stay on the shop indefinitely (seen in the e2e suite on Next 16.4.3). The
 * page and its `generateMetadata` share one read per request (`blog-data.server.ts`).
 */
export async function loadBlogPost(
  data: FeatureData,
  locale: string,
  slug: string,
): Promise<BlogPost | null> {
  const outcome = await data.read(GET_POST, getPostCall(locale, slug), { noStore: true });
  if (outcome.ok) return outcome.data;
  if (outcome.status === 404) return null;
  throw new Error(`${GET_POST} answered ${String(outcome.status)} ${outcome.problem.code}.`);
}
