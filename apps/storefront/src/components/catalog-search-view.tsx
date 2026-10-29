import type { CategoryNode, ProductList, SearchResult } from "@fluxkit/api-client";
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  type BreadcrumbItem,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import { localizedHref } from "../lib/locale-path";
import {
  clearFilters,
  facetEntry,
  searchPath,
  setPage,
  type SearchQuery,
} from "../lib/search-query";
import { CatalogHeader, CatalogView, EmptyList, Subcategories } from "./catalog-view";
import { FacetedResults, ProblemState } from "./search-results";
import { linkButton } from "./styles";

/**
 * The catalog and category pages while search is on (plan 2026-10-29-search.md, section 9): the page's own header and
 * subcategories, then the facet panel, sort, chips, list and pages of `GET /store/search` (`FacetedResults`, shared with the
 * results page), all linking to this page's path with the results page's URL state. Headings: `h1` the page, `h2` the
 * subcategories and the result count, `h3` the product titles. The category of a category page is its path, so its facet
 * is not offered here. When search cannot answer, the page renders `CatalogView` with `CatalogFallbackNotice` instead.
 */

export type CatalogSearchOutcome =
  { kind: "search"; result: SearchResult } | { kind: "invalid"; reason: "range" | "filter" };

export interface CatalogSearchViewProps {
  locale: Locale;
  t: Translator;
  heading: string;
  description: string | null;
  breadcrumbs: BreadcrumbItem[];
  /** Locale-less path of this list (`/catalog` or `/c/<slug>`). */
  basePath: string;
  subcategories: readonly CategoryNode[];
  isCategory: boolean;
  query: SearchQuery;
  outcome: CatalogSearchOutcome;
  /** The `reason` of a script-less filter submit the parser refused (`resolveCatalogAddress`), else `null`. */
  formFailure: string | null;
  currency: string;
  exponent: number;
  imageHosts: readonly string[];
}

function isFiltered(query: SearchQuery): boolean {
  return query.facets.length > 0 || query.price !== null;
}

export function CatalogSearchView(props: CatalogSearchViewProps) {
  const { locale, t, basePath, query, outcome, isCategory } = props;
  const empty = isFiltered(query) ? (
    <EmptyState
      title={t("catalog.facets.empty.title")}
      description={t("catalog.facets.empty.description")}
      action={
        <a
          href={localizedHref(locale, searchPath(clearFilters(query), basePath))}
          className={linkButton}
        >
          {t("search.empty.clear")}
        </a>
      }
      headingAs="h3"
      className="rounded-md border border-border"
    />
  ) : (
    <EmptyList t={t} locale={locale} basePath={basePath} brand={null} isCategory={isCategory} />
  );
  return (
    <Container className="flex flex-col gap-6 py-8">
      <Breadcrumbs label={t("breadcrumbs.label")} items={props.breadcrumbs} />
      <CatalogHeader heading={props.heading} description={props.description} />
      <Subcategories locale={locale} t={t} subcategories={props.subcategories} />
      {outcome.kind === "search" ? (
        <FacetedResults
          locale={locale}
          t={t}
          query={query}
          result={outcome.result}
          formFailure={props.formFailure}
          currency={props.currency}
          exponent={props.exponent}
          imageHosts={props.imageHosts}
          basePath={basePath}
          countKey="catalog.count"
          listLabel={t("catalog.list.label")}
          paginationLabel={t("catalog.pagination.label")}
          empty={empty}
          brandPathFor={(slug) =>
            searchPath({ ...clearFilters(query), facets: [facetEntry("brand", slug)] }, basePath)
          }
          hiddenFacetKeys={isCategory ? ["category"] : []}
        />
      ) : (
        <ProblemState locale={locale} t={t} query={query} outcome={outcome} basePath={basePath} />
      )}
    </Container>
  );
}

/** What a catalog or category route shows besides its own header: the list in one of its three forms. */
export type CatalogRouteList =
  /** Search off: the SQL listing exactly as before. */
  | { kind: "sql"; listing: SqlListing; brandSlug: string | null }
  /** Search on and answering (or refusing the selection). */
  | {
      kind: "search";
      query: SearchQuery;
      outcome: CatalogSearchOutcome;
      formFailure: string | null;
      currency: string;
      exponent: number;
    }
  /** Search on but unable to answer: the SQL listing, with the notice. */
  | {
      kind: "fallback";
      query: SearchQuery;
      listing: SqlListing;
      brandSlug: string | null;
      dropped: boolean;
    };

export interface SqlListing {
  products: ProductList;
  page: number;
  pageCount: number;
  exponent: number;
  brandName: string | null;
}

export interface CatalogRouteViewProps {
  locale: Locale;
  t: Translator;
  heading: string;
  description: string | null;
  breadcrumbs: BreadcrumbItem[];
  basePath: string;
  subcategories: readonly CategoryNode[];
  isCategory: boolean;
  imageHosts: readonly string[];
  list: CatalogRouteList;
}

/** The body of the catalog and category routes (the routes load; this only composes). */
export function CatalogRouteView({ list, ...common }: CatalogRouteViewProps) {
  if (list.kind === "search") {
    return (
      <CatalogSearchView
        {...common}
        query={list.query}
        outcome={list.outcome}
        formFailure={list.formFailure}
        currency={list.currency}
        exponent={list.exponent}
      />
    );
  }
  const { listing } = list;
  const brand =
    list.brandSlug === null
      ? null
      : { slug: list.brandSlug, name: listing.brandName ?? list.brandSlug };
  return (
    <CatalogView
      {...common}
      products={listing.products}
      page={listing.page}
      pageCount={listing.pageCount}
      exponent={listing.exponent}
      brand={brand}
      {...(list.kind === "fallback"
        ? {
            notice: (
              <CatalogFallbackNotice
                t={common.t}
                retryHref={localizedHref(common.locale, searchPath(list.query, common.basePath))}
                dropped={list.dropped}
              />
            ),
            hrefForPage: (target: number) =>
              localizedHref(
                common.locale,
                searchPath(setPage(list.query, target), common.basePath),
              ),
          }
        : {})}
    />
  );
}

/**
 * Said above the SQL listing when search cannot answer (engine down, a limit, switched off meanwhile): the list is the
 * newest products without facets, and, when the address asked for filters or a sort, that those were not applied. The
 * shopper is never shown a different list than the address asks for without being told (plan section 9, "with a small
 * notice"). "Try again" reloads the same address.
 */
export function CatalogFallbackNotice({
  t,
  retryHref,
  dropped,
}: {
  t: Translator;
  retryHref: string;
  dropped: boolean;
}) {
  return (
    <Alert variant="warning" title={t("catalog.fallback.title")}>
      <p>{t(dropped ? "catalog.fallback.dropped" : "catalog.fallback.description")}</p>
      <p className="mt-3">
        <a href={retryHref} className={linkButton}>
          {t("search.unavailable.retry")}
        </a>
      </p>
    </Alert>
  );
}
