import {
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  Select,
  StatusBadge,
  type DataTableColumn,
  type StatusTone,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { buildPath } from "../../router/paths";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import { standaloneLinkClass } from "../../views/links";
import type { ContentLocales } from "../../areas/catalog-dictionaries/form-parts";
import { resolveLocalized } from "../../areas/catalog-dictionaries/locale-text";
import { ListPager } from "../../areas/catalog-dictionaries/list-screen";
import { PageHeading } from "../../views/status-views";
import {
  BLOG_POST_STATES,
  type BlogPostPage,
  type BlogPostState,
  type BlogPostSummary,
} from "./blog-api";
import { BLOG_PATHS, offsetOfPage, type BlogListQuery } from "./blog-paths";
import { BLOG_LIST_LIMIT } from "./blog-rules";

/** The tone of a state badge; the badge always carries the state as text too (never colour alone). */
export const STATE_TONES: Readonly<Record<BlogPostState, StatusTone>> = {
  draft: "neutral",
  scheduled: "warning",
  published: "success",
};

export function postHref(id: string): string {
  return buildPath(BLOG_PATHS.detail, { id });
}

/** A post's name for lists and headings: its title in the UI language, else the default locale's. */
export function postTitle(
  post: Pick<BlogPostSummary, "title" | "slug">,
  uiLocale: string,
  content: ContentLocales,
): string {
  const title = resolveLocalized(post.title, uiLocale, content.defaultLocale);
  return title === "" ? post.slug : title;
}

export function StateBadge({ t, state }: { t: Translator; state: BlogPostState }) {
  return <StatusBadge tone={STATE_TONES[state]} label={t(`features.blog.state.${state}`)} />;
}

/** Every blog screen: the one `h1`, an optional action beside it, then the content. */
export function BlogFrame({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{title}</PageHeading>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** The state filter: applied at once on change (one select, nothing half-typed to protect). */
export function BlogStateFilter({
  t,
  query,
  onChange,
}: {
  t: Translator;
  query: BlogListQuery;
  onChange: (state: BlogPostState | undefined) => void;
}) {
  return (
    <FilterBar
      label={t("features.blog.list.filtersLabel")}
      onSubmit={(event) => event.preventDefault()}
    >
      <Field id="blog-filter-state" label={t("features.blog.list.state")}>
        {(control) => (
          <Select
            {...control}
            name="status"
            value={query.status ?? ""}
            onChange={(event) => {
              const chosen = (BLOG_POST_STATES as readonly string[]).includes(event.target.value)
                ? (event.target.value as BlogPostState)
                : undefined;
              onChange(chosen);
            }}
          >
            <option value="">{t("features.blog.list.anyState")}</option>
            {BLOG_POST_STATES.map((state) => (
              <option key={state} value={state}>
                {t(`features.blog.state.${state}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </FilterBar>
  );
}

export type BlogListState =
  | { status: "loading" }
  | { status: "ready"; data: BlogPostPage }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

/** The list: loading rows, the failure with a retry, "not allowed", an empty state, or the table and its pager. */
export function BlogListView({
  t,
  uiLocale,
  content,
  query,
  state,
  onRetry,
  createLink,
  hrefForOffset,
}: {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  query: BlogListQuery;
  state: BlogListState;
  onRetry: () => void;
  /** The "New post" link for a writer, else `null`. */
  createLink: ReactNode;
  hrefForOffset: (offset: number) => string;
}) {
  const columns: DataTableColumn<BlogPostSummary>[] = [
    {
      id: "title",
      header: t("features.blog.list.columnTitle"),
      cell: (row) => (
        <Link to={postHref(row.id)} className={standaloneLinkClass}>
          {postTitle(row, uiLocale, content)}
        </Link>
      ),
    },
    {
      id: "state",
      header: t("features.blog.list.columnState"),
      cell: (row) => <StateBadge t={t} state={row.state} />,
    },
    {
      id: "published",
      header: t("features.blog.list.columnPublished"),
      cell: (row) =>
        row.publishedAt === null
          ? t("features.blog.list.noDate")
          : formatDateTime(row.publishedAt, uiLocale),
    },
    {
      id: "updated",
      header: t("features.blog.list.columnUpdated"),
      cell: (row) => formatDateTime(row.updatedAt, uiLocale),
    },
  ];
  const caption = t("features.blog.list.caption");
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
  const offset = offsetOfPage(query.page);
  if (state.data.items.length === 0) {
    if (query.page > 1) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">{t("dict.list.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={standaloneLinkClass}>
            {t("dict.list.firstPage")}
          </Link>
        </div>
      );
    }
    return (
      <EmptyState
        title={t(
          query.status === undefined
            ? "features.blog.list.emptyTitle"
            : "features.blog.list.emptyFilteredTitle",
        )}
        description={t(
          query.status === undefined
            ? "features.blog.list.emptyBody"
            : "features.blog.list.emptyFilteredBody",
        )}
        action={query.status === undefined && createLink !== null ? createLink : undefined}
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
      <ListPager
        t={t}
        total={state.data.total}
        limit={BLOG_LIST_LIMIT}
        offset={offset}
        count={state.data.items.length}
        hrefForOffset={hrefForOffset}
      />
    </>
  );
}
