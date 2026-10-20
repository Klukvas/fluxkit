import type { AdminProductSummary } from "@fluxkit/api-client";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Field,
  Select,
  StatusBadge,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { PATHS, buildPath } from "../../router/paths";
import { PageHeading, ResourceFallback } from "../../views/status-views";
import { linkClass, primaryLinkClass } from "../catalog-dictionaries/dictionary-frame";
import { TextField } from "../catalog-dictionaries/form-parts";
import { ListPager, type ListState } from "../catalog-dictionaries/list-screen";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";
import {
  PRODUCT_STATUSES,
  SEARCH_MAX_LENGTH,
  SEARCH_PATTERN_SOURCE,
  type ProductListQuery,
} from "./product-list-query";
import { shortId } from "./product-pickers";
import { STATUS_TONES, statusLabelKey } from "./product-status";

export interface ProductListViewProps {
  t: Translator;
  uiLocale: string;
  defaultLocale: string;
  query: ProductListQuery;
  state: ListState<AdminProductSummary>;
  onRetry: () => void;
  /** Brand names by id for the brand column; an id without a name shows a short id. */
  brandNames: ReadonlyMap<string, string>;
  canCreate: boolean;
  searchText: string;
  searchError?: MessageDescriptor;
  onSearchChange: (text: string) => void;
  /** Enter in the filter form: applies the search at once. */
  onSearchSubmit: () => void;
  onStatusChange: (status: string) => void;
  brandFilter: ReactNode;
  categoryFilter: ReactNode;
  hrefForOffset: (offset: number) => string;
}

function hasFilters(query: ProductListQuery): boolean {
  return (
    query.status !== undefined ||
    query.brandId !== undefined ||
    query.categoryId !== undefined ||
    query.q !== ""
  );
}

/**
 * The product list: filters (search, status, brand, category), then loading rows, the failure with a retry, "not
 * allowed", an empty state, or the table with its pager. Presentational: the page reads the URL and the API.
 */
export function ProductListView({
  t,
  uiLocale,
  defaultLocale,
  query,
  state,
  onRetry,
  brandNames,
  canCreate,
  searchText,
  searchError,
  onSearchChange,
  onSearchSubmit,
  onStatusChange,
  brandFilter,
  categoryFilter,
  hrefForOffset,
}: ProductListViewProps) {
  const createLink = canCreate ? (
    <Link to={PATHS.productNew} className={primaryLinkClass}>
      {t("products.list.create")}
    </Link>
  ) : null;

  const columns: DataTableColumn<AdminProductSummary>[] = [
    {
      id: "title",
      header: t("products.list.columnTitle"),
      cell: (row) => (
        <Link to={buildPath(PATHS.productDetail, { id: row.id })} className={linkClass}>
          {resolveLocalized(row.title, uiLocale, defaultLocale) || row.slug}
        </Link>
      ),
    },
    { id: "slug", header: t("products.list.columnSlug"), cell: (row) => row.slug },
    {
      id: "status",
      header: t("products.list.columnStatus"),
      cell: (row) => (
        <StatusBadge tone={STATUS_TONES[row.status]} label={t(statusLabelKey(row.status))} />
      ),
    },
    {
      id: "brand",
      header: t("products.list.columnBrand"),
      cell: (row) =>
        row.brandId === null ? (
          <span className="text-muted-foreground">{t("products.list.noBrand")}</span>
        ) : (
          (brandNames.get(row.brandId) ?? shortId(row.brandId))
        ),
    },
    {
      id: "updated",
      header: t("products.list.columnUpdated"),
      cell: (row) => formatDateTime(row.updatedAt, uiLocale),
    },
  ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearchSubmit();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{t("page.products.title")}</PageHeading>
        {createLink}
      </div>
      <FilterBar label={t("products.list.filtersLabel")} onSubmit={submit}>
        <div className="min-w-64">
          <TextField
            t={t}
            id="product-search"
            name="q"
            label={t("products.list.search")}
            hint={t("products.list.searchHint", { max: SEARCH_MAX_LENGTH })}
            error={searchError}
            value={searchText}
            onChange={onSearchChange}
            maxLength={SEARCH_MAX_LENGTH}
            pattern={SEARCH_PATTERN_SOURCE}
            patternHint={t("products.list.searchPattern")}
          />
        </div>
        <Field id="product-status-filter" label={t("products.list.status")}>
          {(control) => (
            <Select
              {...control}
              name="status"
              value={query.status ?? ""}
              onChange={(event) => onStatusChange(event.target.value)}
            >
              <option value="">{t("products.list.anyStatus")}</option>
              {PRODUCT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(statusLabelKey(status))}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {brandFilter}
        {categoryFilter}
        <div className="flex flex-wrap items-center gap-3 pb-1">
          <Button type="submit" variant="secondary">
            {t("products.list.apply")}
          </Button>
          {hasFilters(query) ? (
            <Link to={PATHS.products} className={linkClass}>
              {t("products.list.clearFilters")}
            </Link>
          ) : null}
        </div>
      </FilterBar>
      {state.status === "loading" ? (
        <DataTable
          caption={t("products.list.caption")}
          captionHidden
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          emptyMessage={null}
          loading
          loadingLabel={t("status.loading")}
        />
      ) : state.status !== "ready" ? (
        <ResourceFallback t={t} state={state} onRetry={onRetry} />
      ) : state.data.items.length === 0 ? (
        query.offset > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("dict.list.pastEnd")}</p>
            <Link to={hrefForOffset(0)} className={linkClass}>
              {t("dict.list.firstPage")}
            </Link>
          </div>
        ) : hasFilters(query) ? (
          <EmptyState
            title={t("products.list.noMatchTitle")}
            description={t("products.list.noMatchBody")}
            action={
              <Link to={PATHS.products} className={linkClass}>
                {t("products.list.clearFilters")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={t("products.list.emptyTitle")}
            description={t("products.list.emptyBody")}
            action={createLink ?? undefined}
          />
        )
      ) : (
        <>
          <DataTable
            caption={t("products.list.caption")}
            captionHidden
            columns={columns}
            rows={state.data.items}
            rowKey={(row) => row.id}
            emptyMessage={null}
          />
          <ListPager
            t={t}
            total={state.data.total}
            limit={query.limit}
            offset={query.offset}
            count={state.data.items.length}
            hrefForOffset={hrefForOffset}
          />
        </>
      )}
    </div>
  );
}
