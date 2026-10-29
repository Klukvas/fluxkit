import type { CategoryNode } from "@fluxkit/api-client";
import { isLocale, type Locale } from "@fluxkit/ui";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { ListingResult } from "./catalog-data";
import { getListing, getShopMoney } from "./catalog-pages.server";
import { parseCatalogQuery, type CatalogQuery } from "./catalog-query";
import type { CatalogRouteList } from "../components/catalog-search-view";
import { fallbackCatalogQuery, resolveCatalogAddress } from "./catalog-search";
import { loadCatalogSearchPage, type CatalogSearchPage } from "./catalog-search-data";
import { categoryTrail } from "./category-trail";
import { localizedHref } from "./locale-path";
import type { ShopMoney } from "./order-model";
import { getSearchEnabled, searchData } from "./search-data.server";
import { searchPath, type RawSearchParams, type SearchQuery } from "./search-query";
import { storeData } from "./store-data.server";

/**
 * The shared `resolve` of the catalog and category routes. Server code only. Every "no such page" is `notFound()` (a real
 * 404: no `loading.tsx` above these routes); a non-canonical address with search on redirects to its short form.
 *
 * - Search off (`search: false` of the cached store config): exactly the SQL listing of before (`?brand=&page=`).
 * - Search on: the address is the results page's URL state (`catalog-search.ts`); the list itself is read once by the page
 *   (`loadCatalogPage`), never by `generateMetadata`, so a page view costs one search read (the API's per-address window).
 */

export type CatalogRoute =
  | {
      mode: "sql";
      locale: Locale;
      query: CatalogQuery;
      listing: Extract<ListingResult, { kind: "ok" }>;
      category: CategoryNode | null;
      trail: CategoryNode[];
    }
  | {
      mode: "search";
      locale: Locale;
      query: SearchQuery;
      formFailure: string | null;
      shop: ShopMoney;
      category: CategoryNode | null;
      trail: CategoryNode[];
    };

const getCategoryTrail = cache(async (locale: string, slug: string) => {
  const outcome = await storeData.listCategories(locale);
  if (!outcome.ok) {
    throw new Error(
      `GET /store/categories answered ${String(outcome.status)} ${outcome.problem.code}`,
    );
  }
  return categoryTrail(outcome.data.items, slug);
});

export async function resolveCatalogRoute(input: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
  categorySlug?: string;
  basePath: string;
}): Promise<CatalogRoute> {
  const { locale } = await input.params;
  if (!isLocale(locale)) notFound();
  const raw = await input.searchParams;

  if (!(await getSearchEnabled())) {
    const parsed = parseCatalogQuery(raw);
    if (!parsed.ok) notFound();
    const listing = await getListing(
      locale,
      input.categorySlug,
      parsed.query.page,
      parsed.query.brand,
    );
    if (listing.kind === "not_found") notFound();
    if (input.categorySlug !== undefined && listing.category === null) notFound();
    return {
      mode: "sql",
      locale,
      query: parsed.query,
      listing,
      category: listing.category,
      trail: listing.trail,
    };
  }

  const shop = await getShopMoney();
  const address = resolveCatalogAddress(raw, shop.exponent, {
    categoryPage: input.categorySlug !== undefined,
  });
  if (address.kind === "malformed") notFound();
  if (address.kind === "query" && !address.canonical) {
    redirect(localizedHref(locale, searchPath(address.query, input.basePath)));
  }
  let trail: CategoryNode[] = [];
  if (input.categorySlug !== undefined) {
    const found = await getCategoryTrail(locale, input.categorySlug);
    if (found === null) notFound();
    trail = found;
  }
  return {
    mode: "search",
    locale,
    query: address.query,
    formFailure: address.kind === "form_error" ? address.reason : null,
    shop,
    category: trail[trail.length - 1] ?? null,
    trail,
  };
}

/**
 * The list of a route for `CatalogRouteView`: the SQL listing (search off), or one read of `GET /store/search` with its
 * SQL fallback (search on). A page past the last one is `notFound()`.
 */
export async function loadCatalogList(
  route: CatalogRoute,
  categorySlug: string | undefined,
): Promise<CatalogRouteList> {
  if (route.mode === "sql") {
    return { kind: "sql", listing: route.listing, brandSlug: route.query.brand };
  }
  const page: CatalogSearchPage = await loadCatalogSearchPage(storeData, searchData, route.locale, {
    ...(categorySlug === undefined ? {} : { categorySlug }),
    query: route.query,
  });
  if (page.kind === "not_found") notFound();
  switch (page.kind) {
    case "search":
    case "invalid":
      return {
        kind: "search",
        query: route.query,
        outcome:
          page.kind === "search"
            ? { kind: "search", result: page.result }
            : { kind: "invalid", reason: page.reason },
        formFailure: route.formFailure,
        currency: route.shop.currency,
        exponent: route.shop.exponent,
      };
    case "fallback":
      return {
        kind: "fallback",
        query: route.query,
        listing: page.listing,
        brandSlug: fallbackCatalogQuery(route.query).query.brand,
        dropped: page.dropped,
      };
  }
}

/** Whether a search-mode address narrows or reorders the list (such a page is `noindex`; its canonical is the plain list). */
export function isFilteredCatalog(query: SearchQuery): boolean {
  return query.facets.length > 0 || query.price !== null || query.sort !== null;
}
