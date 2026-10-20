import type { AdminUser, Paginated } from "@fluxkit/api-client";
import { Badge, DataTable, EmptyState, type DataTableColumn, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDate, formatDateTime } from "../../lib/format";
import type { Paging } from "../../router/query";
import { PATHS } from "../../router/paths";
import {
  PageHeading,
  ResourceFallback,
  type ResourceFallbackState,
} from "../../views/status-views";
import { ActivityBadge, RoleBadge, UserPager, linkClass } from "./user-parts";
import { isSelf, userHref } from "./user-view";

export type UserListState =
  | { status: "loading" }
  | { status: "ready"; data: Paginated<AdminUser> }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

/** The users list screen: heading, the create link (only when the session may create users) and the results. */
export function UserListView({
  t,
  canCreate,
  results,
}: {
  t: Translator;
  canCreate: boolean;
  results: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading>{t("page.users.title")}</PageHeading>
      <p className="max-w-prose text-muted-foreground">{t("user.list.intro")}</p>
      {canCreate ? (
        <p>
          <Link to={PATHS.userNew} className={linkClass}>
            {t("user.list.create")}
          </Link>
        </p>
      ) : null}
      {results}
    </div>
  );
}

export interface UserResultsViewProps {
  t: Translator;
  uiLocale: string;
  /** The signed-in admin's id (from `me`): their own row is marked "you". */
  meId: string | null;
  query: Paging;
  state: UserListState;
  onRetry: () => void;
  hrefForOffset: (offset: number) => string;
}

/**
 * The results of the users list: loading rows, the failure with a retry, "not allowed", empty, past the end, or the table
 * with its pager. One request per page; nothing is read per row.
 */
export function UserResultsView({
  t,
  uiLocale,
  meId,
  query,
  state,
  onRetry,
  hrefForOffset,
}: UserResultsViewProps) {
  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: "email",
      header: t("user.list.columnEmail"),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link to={userHref(row.id)} className={`${linkClass} break-all`}>
            {row.email}
          </Link>
          {isSelf(row.id, meId) ? <Badge>{t("user.you")}</Badge> : null}
        </span>
      ),
    },
    {
      id: "role",
      header: t("user.list.columnRole"),
      cell: (row) => <RoleBadge t={t} role={row.role} />,
    },
    {
      id: "status",
      header: t("user.list.columnStatus"),
      cell: (row) => <ActivityBadge t={t} isActive={row.isActive} />,
    },
    {
      id: "lastLogin",
      header: t("user.list.columnLastLogin"),
      cell: (row) =>
        row.lastLoginAt === null ? (
          <span className="text-muted-foreground">{t("user.neverSignedIn")}</span>
        ) : (
          formatDateTime(row.lastLoginAt, uiLocale)
        ),
    },
    {
      id: "created",
      header: t("user.list.columnCreated"),
      cell: (row) => formatDate(row.createdAt, uiLocale),
    },
  ];

  if (state.status === "loading") {
    return (
      <DataTable
        caption={t("user.list.caption")}
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
          <p className="text-muted-foreground">{t("user.list.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={linkClass}>
            {t("user.list.firstPage")}
          </Link>
        </div>
      );
    }
    // Only reachable without any user, which the last-owner rule prevents; shown rather than an empty table.
    return <EmptyState title={t("user.list.emptyTitle")} description={t("user.list.emptyBody")} />;
  }
  return (
    <>
      <DataTable
        caption={t("user.list.caption")}
        captionHidden
        columns={columns}
        rows={state.data.items}
        rowKey={(row) => row.id}
        emptyMessage={null}
      />
      <UserPager
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
