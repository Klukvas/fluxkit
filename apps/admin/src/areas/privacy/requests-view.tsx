import type { AdminPrivacyRequest, Paginated, PrivacyRequestStatus } from "@fluxkit/api-client";
import {
  Badge,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  Select,
  StatusBadge,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { buildPath, PATHS } from "../../router/paths";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import { linkClass } from "./privacy-frame";
import {
  REQUEST_STATUSES,
  REQUEST_STATUS_TONES,
  kindLabelKey,
  statusLabelKey,
} from "./privacy-view";
import type { RequestListQuery } from "./request-list-query";

export type RequestListState =
  | { status: "loading" }
  | { status: "ready"; data: Paginated<AdminPrivacyRequest> }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

export function requestHref(id: string): string {
  return buildPath(PATHS.privacyRequestDetail, { id });
}

/** The status filter: applied at once on change (one select, nothing half-typed to protect). */
export function RequestFilter({
  t,
  query,
  onChange,
}: {
  t: Translator;
  query: RequestListQuery;
  onChange: (status: PrivacyRequestStatus | undefined) => void;
}) {
  return (
    <FilterBar label={t("personal.list.filtersLabel")} onSubmit={(event) => event.preventDefault()}>
      <Field id="privacy-filter-status" label={t("personal.list.status")}>
        {(control) => (
          <Select
            {...control}
            name="status"
            value={query.status ?? ""}
            onChange={(event) => {
              const chosen = (REQUEST_STATUSES as readonly string[]).includes(event.target.value)
                ? (event.target.value as PrivacyRequestStatus)
                : undefined;
              onChange(chosen);
            }}
          >
            <option value="">{t("personal.list.anyStatus")}</option>
            {REQUEST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(statusLabelKey(status))}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </FilterBar>
  );
}

export function RequestResultsView({
  t,
  uiLocale,
  query,
  state,
  onRetry,
  hrefForOffset,
}: {
  t: Translator;
  uiLocale: string;
  query: RequestListQuery;
  state: RequestListState;
  onRetry: () => void;
  hrefForOffset: (offset: number) => string;
}) {
  const columns: DataTableColumn<AdminPrivacyRequest>[] = [
    {
      id: "received",
      header: t("personal.list.columnReceived"),
      cell: (row) => (
        <Link to={requestHref(row.id)} className={linkClass}>
          {formatDateTime(row.receivedAt, uiLocale)}
        </Link>
      ),
    },
    { id: "kind", header: t("personal.list.columnKind"), cell: (row) => t(kindLabelKey(row.kind)) },
    {
      id: "status",
      header: t("personal.list.columnStatus"),
      cell: (row) => (
        <StatusBadge
          tone={REQUEST_STATUS_TONES[row.status]}
          label={t(statusLabelKey(row.status))}
        />
      ),
    },
    {
      id: "due",
      header: t("personal.list.columnDue"),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          {formatDateTime(row.dueAt, uiLocale)}
          {row.overdue ? <Badge variant="danger">{t("personal.list.overdue")}</Badge> : null}
        </span>
      ),
    },
    {
      id: "channel",
      header: t("personal.list.columnChannel"),
      cell: (row) => t(`personal.channel.${row.channel}`),
    },
  ];
  const caption = t("personal.list.caption");
  if (state.status === "loading") {
    return (
      <DataTable
        caption={caption}
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
          <p className="text-muted-foreground">{t("personal.list.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={linkClass}>
            {t("personal.list.firstPage")}
          </Link>
        </div>
      );
    }
    return (
      <EmptyState
        title={t(
          query.status === undefined ? "personal.list.emptyTitle" : "personal.list.noMatchTitle",
        )}
        description={t(
          query.status === undefined ? "personal.list.emptyBody" : "personal.list.noMatchBody",
        )}
        action={
          <Link to={PATHS.privacyLookup} className={linkClass}>
            {t("personal.list.toLookup")}
          </Link>
        }
      />
    );
  }
  return (
    <>
      <DataTable
        caption={caption}
        captionHidden
        columns={columns}
        rows={state.data.items}
        rowKey={(row) => row.id}
        emptyMessage={null}
      />
      <RequestPager
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

/** Previous and next page as links (the page is in the URL); the range is spelled out for assistive technology too. */
export function RequestPager({
  t,
  total,
  limit,
  offset,
  count,
  hrefForOffset,
}: {
  t: Translator;
  total: number;
  limit: number;
  offset: number;
  count: number;
  hrefForOffset: (offset: number) => string;
}) {
  if (total === 0) return null;
  const hasPrevious = offset > 0;
  const hasNext = offset + count < total;
  return (
    <nav aria-label={t("personal.list.pagerLabel")} className="flex flex-wrap items-center gap-4">
      <p className="text-muted-foreground">
        {t("personal.list.pageRange", { from: offset + 1, to: offset + count, total })}
      </p>
      {hasPrevious ? (
        <Link to={hrefForOffset(Math.max(0, offset - limit))} rel="prev" className={linkClass}>
          {t("personal.list.previous")}
        </Link>
      ) : null}
      {hasNext ? (
        <Link to={hrefForOffset(offset + limit)} rel="next" className={linkClass}>
          {t("personal.list.next")}
        </Link>
      ) : null}
    </nav>
  );
}
