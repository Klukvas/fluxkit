import { DataTable, EmptyState, type DataTableColumn, type Translator } from "@fluxkit/ui";
import { Link } from "react-router";
import type { Paginated } from "@fluxkit/api-client";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import { DictionaryPage, linkClass, type DictionaryId } from "./dictionary-frame";

export type ListState<Row> =
  | { status: "loading" }
  | { status: "ready"; data: Paginated<Row> }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

/** Previous and next page as links (the page is in the URL); the range is spelled out for assistive technology too. */
export function ListPager({
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
  /** Rows on this page. */
  count: number;
  hrefForOffset: (offset: number) => string;
}) {
  if (total === 0) return null;
  const hasPrevious = offset > 0;
  const hasNext = offset + count < total;
  return (
    <nav aria-label={t("dict.list.pagerLabel")} className="flex flex-wrap items-center gap-4">
      <p className="text-muted-foreground">
        {t("dict.list.range", { from: offset + 1, to: offset + count, total })}
      </p>
      {hasPrevious ? (
        <Link to={hrefForOffset(Math.max(0, offset - limit))} rel="prev" className={linkClass}>
          {t("dict.list.previous")}
        </Link>
      ) : null}
      {hasNext ? (
        <Link to={hrefForOffset(offset + limit)} rel="next" className={linkClass}>
          {t("dict.list.next")}
        </Link>
      ) : null}
    </nav>
  );
}

export interface ListScreenProps<Row> {
  t: Translator;
  current: DictionaryId;
  title: string;
  state: ListState<Row>;
  onRetry: () => void;
  /** Whether the admin may create: without it the create link and the empty state's action do not exist. */
  canWrite: boolean;
  createTo: string;
  createLabel: string;
  caption: string;
  columns: DataTableColumn<Row>[];
  rowKey: (row: Row) => string;
  emptyTitle: string;
  emptyBody: string;
  limit: number;
  offset: number;
  hrefForOffset: (offset: number) => string;
}

const createLinkClass =
  "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A dictionary list: loading rows, the failure with a retry, "not allowed", an empty state, or the table and its pager. */
export function ListScreen<Row>({
  t,
  current,
  title,
  state,
  onRetry,
  canWrite,
  createTo,
  createLabel,
  caption,
  columns,
  rowKey,
  emptyTitle,
  emptyBody,
  limit,
  offset,
  hrefForOffset,
}: ListScreenProps<Row>) {
  const createLink = canWrite ? (
    <Link to={createTo} className={createLinkClass}>
      {createLabel}
    </Link>
  ) : null;
  return (
    <DictionaryPage t={t} current={current} title={title} actions={createLink}>
      {state.status === "loading" ? (
        <DataTable
          caption={caption}
          captionHidden
          columns={columns}
          rows={[]}
          rowKey={rowKey}
          emptyMessage={null}
          loading
          loadingLabel={t("status.loading")}
        />
      ) : state.status !== "ready" ? (
        <ResourceFallback t={t} state={state} onRetry={onRetry} />
      ) : state.data.items.length === 0 ? (
        offset > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("dict.list.pastEnd")}</p>
            <Link to={hrefForOffset(0)} className={linkClass}>
              {t("dict.list.firstPage")}
            </Link>
          </div>
        ) : (
          <EmptyState
            title={emptyTitle}
            description={emptyBody}
            action={
              canWrite ? (
                <Link to={createTo} className={createLinkClass}>
                  {createLabel}
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <DataTable
            caption={caption}
            captionHidden
            columns={columns}
            rows={state.data.items}
            rowKey={rowKey}
            emptyMessage={null}
          />
          <ListPager
            t={t}
            total={state.data.total}
            limit={limit}
            offset={offset}
            count={state.data.items.length}
            hrefForOffset={hrefForOffset}
          />
        </>
      )}
    </DictionaryPage>
  );
}
