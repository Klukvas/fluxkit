import type { SearchResult } from "@fluxkit/api-client";
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  LiveRegion,
  Pagination,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode } from "react";
import { catalogPath } from "../lib/catalog-query";
import { localizedHref } from "../lib/locale-path";
import { describeFormFailure, selectedFilters, sortChoices } from "../lib/search-facets";
import { SEARCH_RESULTS_HEADING_ID } from "../lib/search-ids";
import {
  MAX_SEARCH_PAGE,
  SEARCH_RESULT_CAP,
  clearFilters,
  searchPath,
  setPage,
  type SearchQuery,
} from "../lib/search-query";
import type { SearchOutcome } from "../lib/search-data";
import { ProductGrid } from "./product-grid";
import { SearchFilters } from "./search-filters";
import {
  FiltersDisclosure,
  SearchFilterForm,
  SearchPending,
  SearchResultsRegion,
  SortSelect,
} from "./search-island";
import { focusRing, linkButton } from "./styles";

/**
 * The results page (plan 2026-10-29-search.md, section 9), server markup from data: the words and every filter are the
 * address, the results and the facets are the API's. The shopper's words appear only as text in the heading and in the box
 * (React escapes them); nothing here builds HTML from them. Headings: `h1` the page, `h2` the result count (the focus target
 * after a filter change, inside the polite live region that announces the count), the filter legends and the product
 * titles (`h3`).
 */

export type SearchPageOutcome = Exclude<SearchOutcome, { kind: "disabled" }>;

export interface SearchResultsViewProps {
  locale: Locale;
  t: Translator;
  query: SearchQuery;
  outcome: SearchPageOutcome;
  /**
   * The `reason` of a script-less filter submit the parser refused (`resolveSearchAddress`), shown as the form's own
   * "Check the filters" state; `null` (the default) when there is none.
   */
  formFailure?: string | null;
  currency: string;
  exponent: number;
  imageHosts: readonly string[];
}

const chipLink = `inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-foreground ${focusRing}`;

const SEARCH_BASE_PATH = "/search";

function pageHref(locale: Locale, query: SearchQuery, basePath = SEARCH_BASE_PATH): string {
  return localizedHref(locale, searchPath(query, basePath));
}

/** The problem states of a read of `GET /store/search`; the catalog pages show only `invalid` (they fall back otherwise). */
export function ProblemState({
  locale,
  t,
  query,
  outcome,
  basePath = SEARCH_BASE_PATH,
}: Pick<SearchResultsViewProps, "locale" | "t" | "query"> & {
  outcome: Exclude<SearchPageOutcome, { kind: "results" }>;
  /** Locale-less path of the page the links stay on (`/search`, `/catalog`, `/c/<slug>`). */
  basePath?: string;
}) {
  const wait =
    outcome.kind === "rate_limited" || outcome.kind === "unavailable"
      ? outcome.retryAfterSeconds
      : null;
  if (outcome.kind === "invalid") {
    const range = outcome.reason === "range";
    return (
      <Alert
        variant="warning"
        title={t(range ? "search.invalidRange.title" : "search.invalid.title")}
      >
        <p>{t(range ? "search.invalidRange.description" : "search.invalid.description")}</p>
        <p className="mt-3">
          <a href={pageHref(locale, clearFilters(query), basePath)} className={linkButton}>
            {t("search.empty.clear")}
          </a>
        </p>
      </Alert>
    );
  }
  const limited = outcome.kind === "rate_limited";
  return (
    <Alert
      variant="warning"
      title={t(limited ? "search.rateLimited.title" : "search.unavailable.title")}
    >
      <p>{t(limited ? "errors.too_many_requests" : "errors.search_unavailable")}</p>
      {wait === null ? null : <p>{t.plural("errors.retryAfter", wait)}</p>}
      <p className="mt-3 flex flex-wrap gap-3">
        <a href={pageHref(locale, query, basePath)} className={linkButton}>
          {t("search.unavailable.retry")}
        </a>
        <a href={localizedHref(locale, "/catalog")} className={chipLink}>
          {t("search.unavailable.catalog")}
        </a>
      </p>
    </Alert>
  );
}

function EmptyResults({
  locale,
  t,
  query,
}: Pick<SearchResultsViewProps, "locale" | "t" | "query">) {
  const filtered = query.facets.length > 0 || query.price !== null;
  return (
    <EmptyState
      title={t("search.empty.title")}
      description={t(filtered ? "search.empty.filtered" : "search.empty.description")}
      action={
        <a
          href={
            filtered ? pageHref(locale, clearFilters(query)) : localizedHref(locale, "/catalog")
          }
          className={linkButton}
        >
          {t(filtered ? "search.empty.clear" : "search.empty.catalog")}
        </a>
      }
      headingAs="h3"
      className="rounded-md border border-border"
    />
  );
}

export interface FacetedResultsProps extends Omit<SearchResultsViewProps, "outcome"> {
  result: SearchResult;
  /** Locale-less path the filters, chips and pages link to: `/search`, `/catalog` or `/c/<slug>`. */
  basePath: string;
  /** Plural key of the result count heading (`search.count`, `catalog.count`). */
  countKey: string;
  listLabel: string;
  paginationLabel: string;
  /** What the list shows without items (the page's own empty state). */
  empty: ReactNode;
  /** The link of a product card's brand. */
  brandPathFor: (slug: string) => string;
  /**
   * Facets the page itself already decides and must not offer (the category of a category page: its path). Left out of
   * the panel and of the chips.
   */
  hiddenFacetKeys?: readonly string[];
}

/**
 * The facet panel, sort, chips, list and pages of a `GET /store/search` answer: the results page and, with search on, the
 * catalog and category pages (`catalog-search-view.tsx`). Everything links to `basePath`, so the URL state is the same on
 * every page that lists through the index.
 */
export function FacetedResults({
  locale,
  t,
  query,
  result,
  currency,
  exponent,
  imageHosts,
  formFailure,
  basePath,
  countKey,
  listLabel,
  paginationLabel,
  empty,
  brandPathFor,
  hiddenFacetKeys = [],
}: FacetedResultsProps) {
  const facets = result.facets.filter((facet) => !hiddenFacetKeys.includes(facet.key));
  const chips = selectedFilters({ query, facets, t, currency, exponent });
  const sorts = sortChoices(query);
  const pageCount = Math.min(result.pageCount, MAX_SEARCH_PAGE);
  return (
    <SearchPending locale={locale} basePath={basePath}>
      <div className="grid gap-6 lg:grid-cols-4">
        <aside aria-label={t("search.filters.title")} className="lg:col-span-1">
          <FiltersDisclosure title={t("search.filters.title")}>
            {/* Keyed by the address: the checkboxes are uncontrolled and must start over with every new result. */}
            <SearchFilterForm
              key={searchPath(query, basePath)}
              exponent={exponent}
              initialError={
                formFailure === null || formFailure === undefined
                  ? null
                  : t(describeFormFailure(formFailure).messageKey)
              }
            >
              <SearchFilters
                t={t}
                query={query}
                facets={facets}
                price={result.price}
                currency={currency}
                exponent={exponent}
              />
            </SearchFilterForm>
          </FiltersDisclosure>
        </aside>

        <section aria-label={listLabel} className="flex flex-col gap-4 lg:col-span-3">
          <SearchResultsRegion>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <LiveRegion>
                  <h2
                    id={SEARCH_RESULTS_HEADING_ID}
                    tabIndex={-1}
                    className="text-lg font-semibold text-foreground focus:outline-none"
                  >
                    {t.plural(countKey, result.total)}
                  </h2>
                </LiveRegion>
                <SortSelect
                  label={t("search.sort.label")}
                  selected={sorts.selected}
                  options={sorts.options.map((value) => ({
                    value,
                    label: t(`search.sort.${value}`),
                  }))}
                />
              </div>

              {chips.length === 0 ? null : (
                <ul aria-label={t("search.filters.selected")} className="flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <li key={chip.key}>
                      <a
                        href={pageHref(locale, chip.remove, basePath)}
                        aria-label={t("search.filters.remove", { label: chip.label })}
                        className={chipLink}
                      >
                        <span>{chip.label}</span>
                        <span aria-hidden="true">&times;</span>
                      </a>
                    </li>
                  ))}
                  <li>
                    <a
                      href={pageHref(locale, clearFilters(query), basePath)}
                      className={`${chipLink} underline underline-offset-4`}
                    >
                      {t("search.filters.clear")}
                    </a>
                  </li>
                </ul>
              )}

              {result.relaxed ? (
                <Alert variant="info">
                  <p>{t("search.relaxed")}</p>
                </Alert>
              ) : null}

              {result.items.length === 0 ? (
                empty
              ) : (
                <ProductGrid
                  products={result.items}
                  locale={locale}
                  t={t}
                  exponent={exponent}
                  imageHosts={imageHosts}
                  headingLevel="h3"
                  brandPathFor={brandPathFor}
                  label={listLabel}
                />
              )}

              <Pagination
                label={paginationLabel}
                currentPage={result.page}
                pageCount={pageCount}
                hrefForPage={(target) => pageHref(locale, setPage(query, target), basePath)}
                previousLabel={t("catalog.pagination.previous")}
                nextLabel={t("catalog.pagination.next")}
                pageLabel={(target) => t("catalog.pagination.page", { page: target })}
              />

              {result.total >= SEARCH_RESULT_CAP ? (
                <p className="text-muted-foreground">
                  {t("search.limit", {
                    limit: new Intl.NumberFormat(locale).format(SEARCH_RESULT_CAP),
                  })}
                </p>
              ) : null}
            </div>
          </SearchResultsRegion>
        </section>
      </div>
    </SearchPending>
  );
}

export function SearchResultsView(props: SearchResultsViewProps) {
  const { locale, t, query, outcome } = props;
  return (
    <Container className="flex flex-col gap-6 py-8">
      <Breadcrumbs
        label={t("breadcrumbs.label")}
        items={[
          { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") },
          { label: t("search.title") },
        ]}
      />
      <h1 className="text-3xl font-bold text-foreground">
        {query.q === ""
          ? t("search.heading.browse")
          : t("search.heading.query", { query: query.q })}
      </h1>
      {outcome.kind === "results" ? (
        <FacetedResults
          {...props}
          result={outcome.result}
          basePath={SEARCH_BASE_PATH}
          countKey="search.count"
          listLabel={t("search.list.label")}
          paginationLabel={t("search.pagination.label")}
          empty={<EmptyResults locale={locale} t={t} query={query} />}
          brandPathFor={(slug) => catalogPath("/catalog", { brand: slug })}
        />
      ) : (
        <>
          {/* Without results there is no filter form to hold the failure: it is said here (review F3). */}
          {props.formFailure === null || props.formFailure === undefined ? null : (
            <Alert variant="danger" title={t("searchForm.error.title")}>
              <p>{t(describeFormFailure(props.formFailure).messageKey)}</p>
            </Alert>
          )}
          <ProblemState locale={locale} t={t} query={query} outcome={outcome} />
        </>
      )}
    </Container>
  );
}
