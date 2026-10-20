import type { AdminOrderSummary, Paginated } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  Input,
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
import {
  PageHeading,
  ResourceFallback,
  type ResourceFallbackState,
} from "../../views/status-views";
import type { DayRangeFailure } from "./date-range";
import {
  ORDER_SEARCH_MAX_LENGTH,
  ORDER_STATUS_FILTERS,
  looksLikeOrderId,
  type OrderListQuery,
} from "./order-list-query";
import { DescriptorText, OrderPager, linkClass } from "./order-parts";
import { ORDER_STATUS_TONES, orderStatusLabelKey } from "./order-view";

export type OrderListState =
  | { status: "loading" }
  | { status: "ready"; data: Paginated<AdminOrderSummary> }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

function hasFilters(query: OrderListQuery): boolean {
  return (
    query.status !== undefined ||
    query.from !== "" ||
    query.to !== "" ||
    query.q !== "" ||
    query.customerId !== undefined
  );
}

export interface OrderListViewProps {
  t: Translator;
  query: OrderListQuery;
  /** Why the date range is not sent (nothing is requested then), or `null`. */
  rangeError: { field: "from" | "to"; reason: DayRangeFailure } | null;
  /** The results (the data component around `OrderResultsView`); ignored while `rangeError` is set. */
  results: ReactNode;
  searchText: string;
  searchError?: MessageDescriptor;
  onSearchChange: (text: string) => void;
  /** Enter in the filter form: applies the search at once. */
  onSearchSubmit: () => void;
  onStatusChange: (status: string) => void;
  onFromChange: (day: string) => void;
  onToChange: (day: string) => void;
  /** The list without the customer filter (the chip's remove link). */
  hrefWithoutCustomer: string;
}

/**
 * The order list screen: the heading, the filters (search, status, placed from and to, the customer chip) and the
 * results, or the date-range problem instead of them. Presentational: the page reads the URL and the API.
 */
export function OrderListView({
  t,
  query,
  rangeError,
  results,
  searchText,
  searchError,
  onSearchChange,
  onSearchSubmit,
  onStatusChange,
  onFromChange,
  onToChange,
  hrefWithoutCustomer,
}: OrderListViewProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearchSubmit();
  }

  const rangeMessage =
    rangeError === null ? undefined : t(`order.list.dateRange.${rangeError.reason}`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading>{t("page.orders.title")}</PageHeading>
      <FilterBar label={t("order.list.filtersLabel")} onSubmit={submit}>
        <div className="min-w-64">
          <Field
            id="order-search"
            label={t("order.list.search")}
            hint={t("order.list.searchHint", { max: ORDER_SEARCH_MAX_LENGTH })}
            error={
              searchError === undefined ? undefined : (
                <DescriptorText t={t} descriptor={searchError} />
              )
            }
          >
            {(control) => (
              <Input
                {...control}
                name="q"
                type="search"
                value={searchText}
                maxLength={ORDER_SEARCH_MAX_LENGTH}
                autoComplete="off"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field id="order-status-filter" label={t("order.list.status")}>
          {(control) => (
            <Select
              {...control}
              name="status"
              value={query.status ?? ""}
              onChange={(event) => onStatusChange(event.target.value)}
            >
              <option value="">{t("order.list.anyStatus")}</option>
              {ORDER_STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {t(orderStatusLabelKey(status))}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id="order-placed-from"
          label={t("order.list.placedFrom")}
          error={rangeError?.field === "from" ? rangeMessage : undefined}
        >
          {(control) => (
            <Input
              {...control}
              name="from"
              type="date"
              min="2000-01-01"
              max="2199-12-31"
              value={query.from}
              onChange={(event) => onFromChange(event.target.value)}
            />
          )}
        </Field>
        <Field
          id="order-placed-to"
          label={t("order.list.placedTo")}
          error={rangeError?.field === "to" ? rangeMessage : undefined}
        >
          {(control) => (
            <Input
              {...control}
              name="to"
              type="date"
              min="2000-01-01"
              max="2199-12-31"
              value={query.to}
              onChange={(event) => onToChange(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-3 pb-1">
          <Button type="submit" variant="secondary">
            {t("order.list.apply")}
          </Button>
          {hasFilters(query) ? (
            <Link to={PATHS.orders} className={linkClass}>
              {t("order.list.clearFilters")}
            </Link>
          ) : null}
        </div>
      </FilterBar>
      <p className="text-sm text-muted-foreground">{t("order.list.timeZoneHint")}</p>
      {query.customerId === undefined ? null : (
        <p className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-border px-3 py-1 text-foreground">
            {t("order.list.customerChip", { id: query.customerId.slice(0, 8) })}
          </span>
          <Link to={hrefWithoutCustomer} className={linkClass}>
            {t("order.list.removeCustomer")}
          </Link>
        </p>
      )}
      {rangeError === null ? (
        results
      ) : (
        <Alert variant="warning">{t("order.list.rangeNotSent")}</Alert>
      )}
    </div>
  );
}

export interface OrderResultsViewProps {
  t: Translator;
  uiLocale: string;
  query: OrderListQuery;
  state: OrderListState;
  onRetry: () => void;
  /** Money of a row (the config's exponent), formatted by the page. */
  totalText: (row: AdminOrderSummary) => string;
  hrefForOffset: (offset: number) => string;
}

/**
 * The results of the order list: loading rows, the failure with a retry, "not allowed", an empty state, no match, or
 * the table with its pager.
 */
export function OrderResultsView({
  t,
  uiLocale,
  query,
  state,
  onRetry,
  totalText,
  hrefForOffset,
}: OrderResultsViewProps) {
  const columns: DataTableColumn<AdminOrderSummary>[] = [
    {
      id: "number",
      header: t("order.list.columnNumber"),
      cell: (row) => (
        <Link to={buildPath(PATHS.orderDetail, { id: row.id })} className={linkClass}>
          {row.number}
        </Link>
      ),
    },
    {
      id: "placed",
      header: t("order.list.columnPlaced"),
      cell: (row) => formatDateTime(row.placedAt, uiLocale),
    },
    {
      id: "status",
      header: t("order.list.columnStatus"),
      cell: (row) => (
        <StatusBadge
          tone={ORDER_STATUS_TONES[row.status]}
          label={t(orderStatusLabelKey(row.status))}
        />
      ),
    },
    {
      id: "customer",
      header: t("order.list.columnCustomer"),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="break-all">{row.email}</span>
          {row.customerId === null ? (
            <small className="text-muted-foreground">{t("order.list.noAccount")}</small>
          ) : null}
        </span>
      ),
    },
    {
      id: "items",
      header: t("order.list.columnItems"),
      align: "end",
      cell: (row) => new Intl.NumberFormat(uiLocale).format(row.itemCount),
    },
    {
      id: "total",
      header: t("order.list.columnTotal"),
      align: "end",
      cell: (row) => totalText(row),
    },
  ];

  if (state.status === "loading") {
    return (
      <DataTable
        caption={t("order.list.caption")}
        captionHidden
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        emptyMessage={null}
        loading
        loadingLabel={t("status.loading")}
      />
    );
  }
  if (state.status !== "ready") return <ResourceFallback t={t} state={state} onRetry={onRetry} />;
  if (state.data.items.length === 0) {
    if (query.offset > 0) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">{t("order.list.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={linkClass}>
            {t("order.list.firstPage")}
          </Link>
        </div>
      );
    }
    if (!hasFilters(query)) {
      return (
        <EmptyState title={t("order.list.emptyTitle")} description={t("order.list.emptyBody")} />
      );
    }
    return (
      <EmptyState
        title={t("order.list.noMatchTitle")}
        description={t("order.list.noMatchBody")}
        action={
          <span className="flex flex-col items-center gap-2">
            {looksLikeOrderId(query.q) ? (
              <Link to={buildPath(PATHS.orderDetail, { id: query.q })} className={linkClass}>
                {t("order.list.openById")}
              </Link>
            ) : null}
            <Link to={PATHS.orders} className={linkClass}>
              {t("order.list.clearFilters")}
            </Link>
          </span>
        }
      />
    );
  }
  return (
    <>
      <DataTable
        caption={t("order.list.caption")}
        captionHidden
        columns={columns}
        rows={state.data.items}
        rowKey={(row) => row.id}
        emptyMessage={null}
      />
      <OrderPager
        t={t}
        total={state.data.total}
        limit={query.limit}
        offset={query.offset}
        count={state.data.items.length}
        hrefForOffset={hrefForOffset}
      />
    </>
  );
}
