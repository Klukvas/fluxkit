import type { AdminCustomerSummary, Paginated } from "@fluxkit/api-client";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  Input,
  StatusBadge,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router";
import { formatDate, formatDateTime } from "../../lib/format";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { PATHS } from "../../router/paths";
import {
  PageHeading,
  ResourceFallback,
  type ResourceFallbackState,
} from "../../views/status-views";
import { CUSTOMER_SEARCH_MAX_LENGTH, type CustomerListQuery } from "./customer-list-query";
import { CustomerPager, DescriptorText, linkClass } from "./customer-parts";
import { customerHref, fullName, statusLabelKey, statusTone } from "./customer-view";

export type CustomerListState =
  | { status: "loading" }
  | { status: "ready"; data: Paginated<AdminCustomerSummary> }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

export interface CustomerListViewProps {
  t: Translator;
  query: CustomerListQuery;
  /** The results (the data component around `CustomerResultsView`). */
  results: ReactNode;
  /** What is typed in the search field (not yet in the URL while the debounce runs). */
  searchText: string;
  searchError?: MessageDescriptor;
  onSearchChange: (text: string) => void;
  /** Enter in the filter form: applies the search at once. */
  onSearchSubmit: () => void;
}

/**
 * The customer list screen: the heading, the email search and the results. Presentational: the page reads the URL and
 * the API. The only filter is the start of the email (the API offers no other).
 */
export function CustomerListView({
  t,
  query,
  results,
  searchText,
  searchError,
  onSearchChange,
  onSearchSubmit,
}: CustomerListViewProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearchSubmit();
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeading>{t("page.customers.title")}</PageHeading>
      <FilterBar label={t("customer.list.filtersLabel")} onSubmit={submit}>
        <div className="min-w-64">
          <Field
            id="customer-search"
            label={t("customer.list.search")}
            hint={t("customer.list.searchHint", { max: CUSTOMER_SEARCH_MAX_LENGTH })}
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
                maxLength={CUSTOMER_SEARCH_MAX_LENGTH}
                autoComplete="off"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 pb-1">
          <Button type="submit" variant="secondary">
            {t("customer.list.apply")}
          </Button>
          {query.q === "" ? null : (
            <Link to={PATHS.customers} className={linkClass}>
              {t("customer.list.clearSearch")}
            </Link>
          )}
        </div>
      </FilterBar>
      {results}
    </div>
  );
}

export interface CustomerResultsViewProps {
  t: Translator;
  uiLocale: string;
  query: CustomerListQuery;
  state: CustomerListState;
  onRetry: () => void;
  hrefForOffset: (offset: number) => string;
}

/**
 * The results of the customer list: loading rows, the failure with a retry, "not allowed", an empty state, no match, or
 * the table with its pager. The list answers the summary only: it has no lock state and no order count (those are on
 * the detail), so no row asks for them.
 */
export function CustomerResultsView({
  t,
  uiLocale,
  query,
  state,
  onRetry,
  hrefForOffset,
}: CustomerResultsViewProps) {
  const columns: DataTableColumn<AdminCustomerSummary>[] = [
    {
      id: "email",
      header: t("customer.list.columnEmail"),
      cell: (row) => (
        <Link to={customerHref(row.id)} className={`${linkClass} break-all`}>
          {row.email}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("customer.list.columnName"),
      cell: (row) => {
        const name = fullName(row.firstName, row.lastName);
        return name === "" ? (
          <span className="text-muted-foreground">{t("customer.list.noName")}</span>
        ) : (
          <span className="break-words">{name}</span>
        );
      },
    },
    {
      id: "status",
      header: t("customer.list.columnStatus"),
      cell: (row) => (
        <StatusBadge tone={statusTone(row.isActive)} label={t(statusLabelKey(row.isActive))} />
      ),
    },
    {
      id: "lastLogin",
      header: t("customer.list.columnLastLogin"),
      cell: (row) =>
        row.lastLoginAt === null ? (
          <span className="text-muted-foreground">{t("customer.list.neverSignedIn")}</span>
        ) : (
          formatDateTime(row.lastLoginAt, uiLocale)
        ),
    },
    {
      id: "created",
      header: t("customer.list.columnCreated"),
      cell: (row) => formatDate(row.createdAt, uiLocale),
    },
  ];

  if (state.status === "loading") {
    return (
      <DataTable
        caption={t("customer.list.caption")}
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
          <p className="text-muted-foreground">{t("customer.list.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={linkClass}>
            {t("customer.list.firstPage")}
          </Link>
        </div>
      );
    }
    if (query.q === "") {
      return (
        <EmptyState
          title={t("customer.list.emptyTitle")}
          description={t("customer.list.emptyBody")}
        />
      );
    }
    return (
      <EmptyState
        title={t("customer.list.noMatchTitle")}
        description={t("customer.list.noMatchBody")}
        action={
          <Link to={PATHS.customers} className={linkClass}>
            {t("customer.list.clearSearch")}
          </Link>
        }
      />
    );
  }
  return (
    <>
      <DataTable
        caption={t("customer.list.caption")}
        captionHidden
        columns={columns}
        rows={state.data.items}
        rowKey={(row) => row.id}
        emptyMessage={null}
      />
      <CustomerPager
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
