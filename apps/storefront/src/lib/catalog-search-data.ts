import type { CategoryNode, SearchResult } from "@fluxkit/api-client";
import { loadCatalogListing, type ListingResult } from "./catalog-data";
import {
  catalogSearchRequest,
  fallbackCatalogQuery,
  isCacheableCatalogSearch,
} from "./catalog-search";
import { categoryTrail } from "./category-trail";
import type { SearchData } from "./search-data";
import type { SearchQuery } from "./search-query";
import { CATALOG_REVALIDATE_SECONDS, type StoreData } from "./store-data";

/**
 * The catalog and category pages while search is on (plan 2026-10-29-search.md, section 9 and "Failure handling"; owner
 * answer 3): the list, its facets and its sort come from `GET /store/search` with the category as a filter; when search
 * cannot answer, the page falls back to the SQL listing of `GET /store/products` (newest first, no facets) and tells the
 * shopper so. Loaded through `StoreData` and `SearchData`, so tests use fakes.
 *
 * Decisions, each with a test:
 * - Fallback for every answer that means "search cannot serve this now": 503 `search_unavailable` or an API that cannot be
 *   reached (`unavailable`), 429 (`rate_limited`: without the forwarded address every page read of the storefront shares
 *   the Next server's one window), and 404 (`disabled`: the cached config said on, the API is already off).
 * - No fallback for a selection the API refuses (400): the page explains it with a link that clears the filters, as the
 *   results page does; silently listing everything would show something else than the address says.
 * - No fallback for an engine refusal (500) or anything unexpected: it throws and the route's error page renders (ADR 0036
 *   decision 6: a refusal is a bug to fix, not an outage).
 * - A page past the last one is not found, in both paths.
 */

export type CatalogSearchPage =
  | {
      kind: "search";
      result: SearchResult;
      /** The category of a category page, `null` on the whole catalog. */
      category: CategoryNode | null;
      /** Root-to-category trail; empty on the whole catalog. */
      trail: CategoryNode[];
    }
  | {
      kind: "invalid";
      reason: "range" | "filter";
      category: CategoryNode | null;
      trail: CategoryNode[];
    }
  | {
      kind: "fallback";
      listing: Extract<ListingResult, { kind: "ok" }>;
      /** The address asked for a facet, price or sort the SQL listing cannot apply. */
      dropped: boolean;
    }
  | { kind: "not_found" };

export async function loadCatalogSearchPage(
  store: StoreData,
  search: SearchData,
  locale: string,
  options: { categorySlug?: string; query: SearchQuery },
): Promise<CatalogSearchPage> {
  const { query } = options;
  let trail: CategoryNode[] = [];
  if (options.categorySlug !== undefined) {
    const outcome = await store.listCategories(locale);
    if (!outcome.ok) {
      throw new Error(
        `GET /store/categories answered ${String(outcome.status)} ${outcome.problem.code}`,
      );
    }
    const found = categoryTrail(outcome.data.items, options.categorySlug);
    if (found === null) return { kind: "not_found" };
    trail = found;
  }
  const category = trail[trail.length - 1] ?? null;

  const outcome = await search.search(
    locale,
    catalogSearchRequest(query, category?.id ?? null),
    isCacheableCatalogSearch(query) ? { cacheSeconds: CATALOG_REVALIDATE_SECONDS } : undefined,
  );
  switch (outcome.kind) {
    case "results":
      if (query.page > 1 && query.page > outcome.result.pageCount) return { kind: "not_found" };
      return { kind: "search", result: outcome.result, category, trail };
    case "invalid":
      return { kind: "invalid", reason: outcome.reason, category, trail };
    case "unavailable":
    case "rate_limited":
    case "disabled": {
      const fallback = fallbackCatalogQuery(query);
      const listing = await loadCatalogListing(store, locale, {
        ...(options.categorySlug === undefined ? {} : { categorySlug: options.categorySlug }),
        query: fallback.query,
      });
      if (listing.kind === "not_found") return listing;
      return { kind: "fallback", listing, dropped: fallback.dropped };
    }
  }
}
