import type { AdminSearchStatus, AdminSynonymGroup, Paginated } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  Select,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { PATHS } from "../../router/paths";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import { StatusLine, linkClass, localeLabel } from "./search-frame";
import type { SynonymListQuery } from "./synonym-list-query";

export type SynonymListState =
  | { status: "loading" }
  | { status: "ready"; data: Paginated<AdminSynonymGroup> }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

/** What the page line says after a write (the dialog is closed by then, except for a refusal shown inside it). */
export type SynonymNotice =
  | { kind: "none" }
  | { kind: "saved"; action: "create" | "update" | "delete" }
  | { kind: "unchanged" }
  | { kind: "gone" }
  | { kind: "unknown"; action: "create" | "update" | "delete" };

export function SynonymNoticeView({ t, notice }: { t: Translator; notice: SynonymNotice }) {
  switch (notice.kind) {
    case "none":
      return null;
    case "saved":
      return (
        <Alert variant="success">
          <p>{t(`search.synonyms.notice.saved.${notice.action}`)}</p>
          <p>{t("search.synonyms.notice.appliesLater")}</p>
        </Alert>
      );
    case "unchanged":
      return <Alert variant="info">{t("search.synonyms.notice.unchanged")}</Alert>;
    case "gone":
      return <Alert variant="info">{t("search.synonyms.notice.gone")}</Alert>;
    case "unknown":
      return (
        <Alert variant="warning" title={t("search.synonyms.notice.unknownTitle")}>
          <p>{t(`search.synonyms.notice.unknown.${notice.action}`)}</p>
        </Alert>
      );
  }
}

export interface SynonymIntroProps {
  t: Translator;
  uiLocale: string;
  queue: AdminSearchStatus["queue"];
  locales: AdminSearchStatus["locales"];
}

/** When a change takes effect, with the queue number of the status screen and the languages still waiting for settings. */
export function SynonymApplyNote({ t, uiLocale, queue, locales }: SynonymIntroProps) {
  const waiting = locales
    .filter((entry) => !entry.settingsFresh)
    .map((entry) => localeLabel(t, entry.locale));
  return (
    <div className="flex max-w-prose flex-col gap-1 text-muted-foreground">
      <p>{t("search.synonyms.applyNote")}</p>
      <p>
        {t("search.synonyms.queueNow", {
          depth: new Intl.NumberFormat(uiLocale).format(queue.depth),
        })}{" "}
        <Link to={PATHS.search} className={linkClass}>
          {t("search.synonyms.openStatus")}
        </Link>
      </p>
      {waiting.length === 0 ? null : (
        <p>{t("search.synonyms.settingsPending", { locales: waiting.join(", ") })}</p>
      )}
    </div>
  );
}

export function SynonymFilter({
  t,
  locales,
  value,
  onChange,
}: {
  t: Translator;
  locales: readonly string[];
  value: string;
  onChange: (locale: string) => void;
}) {
  return (
    <Field id="search-synonym-filter" label={t("search.synonyms.filterLabel")}>
      {(control) => (
        <Select {...control} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t("search.synonyms.filterAll")}</option>
          {locales.map((entry) => (
            <option key={entry} value={entry}>
              {localeLabel(t, entry)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export interface SynonymResultsProps {
  t: Translator;
  uiLocale: string;
  query: SynonymListQuery;
  state: SynonymListState;
  /** Edit and delete buttons are rendered only when the admin may change the catalog. */
  canManage: boolean;
  onRetry: () => void;
  onEdit: (group: AdminSynonymGroup) => void;
  onDelete: (group: AdminSynonymGroup) => void;
  hrefForOffset: (offset: number) => string;
}

export function SynonymResultsView({
  t,
  uiLocale,
  query,
  state,
  canManage,
  onRetry,
  onEdit,
  onDelete,
  hrefForOffset,
}: SynonymResultsProps) {
  const columns: DataTableColumn<AdminSynonymGroup>[] = [
    {
      id: "locale",
      header: t("search.synonyms.columnLocale"),
      cell: (row) => localeLabel(t, row.locale),
    },
    {
      id: "terms",
      header: t("search.synonyms.columnTerms"),
      cell: (row) => <span className="break-words">{row.terms.join(", ")}</span>,
    },
    {
      id: "updated",
      header: t("search.synonyms.columnUpdated"),
      cell: (row) => formatDateTime(row.updatedAt, uiLocale),
    },
  ];
  const caption = t("search.synonyms.caption");
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
          <p className="text-muted-foreground">{t("search.synonyms.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={linkClass}>
            {t("search.synonyms.firstPage")}
          </Link>
        </div>
      );
    }
    return (
      <EmptyState
        title={t("search.synonyms.emptyTitle")}
        description={t(
          query.locale === "" ? "search.synonyms.emptyBody" : "search.synonyms.emptyLocaleBody",
        )}
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
        {...(canManage
          ? {
              actions: {
                header: t("search.synonyms.columnActions"),
                render: (row: AdminSynonymGroup) => (
                  <span className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      aria-label={t("search.synonyms.editLabel", { terms: row.terms.join(", ") })}
                      onClick={() => onEdit(row)}
                    >
                      {t("search.synonyms.edit")}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={t("search.synonyms.deleteLabel", { terms: row.terms.join(", ") })}
                      onClick={() => onDelete(row)}
                    >
                      {t("search.synonyms.delete")}
                    </Button>
                  </span>
                ),
              },
            }
          : {})}
      />
      <SynonymPager
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
export function SynonymPager({
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
}): ReactNode {
  if (total === 0) return null;
  const hasPrevious = offset > 0;
  const hasNext = offset + count < total;
  return (
    <nav aria-label={t("search.synonyms.pagerLabel")} className="flex flex-wrap items-center gap-4">
      <p className="text-muted-foreground">
        {t("search.synonyms.pageRange", { from: offset + 1, to: offset + count, total })}
      </p>
      {hasPrevious ? (
        <Link to={hrefForOffset(Math.max(0, offset - limit))} rel="prev" className={linkClass}>
          {t("search.synonyms.previous")}
        </Link>
      ) : null}
      {hasNext ? (
        <Link to={hrefForOffset(offset + limit)} rel="next" className={linkClass}>
          {t("search.synonyms.next")}
        </Link>
      ) : null}
    </nav>
  );
}

/** The page line: always in the page (a live region), focusable so the focus can move to it after a write. */
export function SynonymStatusLine({
  t,
  notice,
  innerRef,
}: {
  t: Translator;
  notice: SynonymNotice;
  innerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <StatusLine innerRef={innerRef}>
      <SynonymNoticeView t={t} notice={notice} />
    </StatusLine>
  );
}
