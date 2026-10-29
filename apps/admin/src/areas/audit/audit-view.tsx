import type { AdminAuditEvent } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  Input,
  Select,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { actorLabel } from "../../lib/actor-label";
import type { DayRangeFailure } from "../../lib/date-range";
import { formatDateTime } from "../../lib/format";
import { buildPath, PATHS } from "../../router/paths";
import { LoadingView } from "../../views/status-views";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_KINDS,
  actionLabelKey,
  canLoadMore,
  detailText,
  hasAuditFilters,
  isUuid,
  targetKindLabelKey,
  type AuditFeed,
  type AuditQuery,
} from "./audit-model";

const linkClass = "font-medium text-foreground underline underline-offset-4";

export interface AuditFilterFormProps {
  t: Translator;
  query: AuditQuery;
  /** Admin users by id, for the "who" select; `null` when the users could not be read (a uuid field then). */
  adminEmails: ReadonlyMap<string, string> | null;
  rangeError: { field: "from" | "to"; reason: DayRangeFailure } | null;
  onApply: (query: AuditQuery) => void;
}

/** The filters as one labelled form, applied together (the Apply button or Enter). */
export function AuditFilterForm({
  t,
  query,
  adminEmails,
  rangeError,
  onApply,
}: AuditFilterFormProps) {
  const [action, setAction] = useState<string>(query.action ?? "");
  const [targetKind, setTargetKind] = useState<string>(query.targetKind ?? "");
  const [adminUserId, setAdminUserId] = useState(query.adminUserId);
  const [targetId, setTargetId] = useState(query.targetId);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const adminIdBad = adminUserId.trim() !== "" && !isUuid(adminUserId.trim());
  const targetIdBad = targetId.trim() !== "" && !isUuid(targetId.trim());
  const rangeMessage =
    rangeError === null ? undefined : t(`audit.list.dateRange.${rangeError.reason}`);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adminIdBad || targetIdBad) return;
    const chosenAction = (AUDIT_ACTIONS as readonly string[]).includes(action)
      ? (action as (typeof AUDIT_ACTIONS)[number])
      : undefined;
    const chosenKind = (AUDIT_TARGET_KINDS as readonly string[]).includes(targetKind)
      ? (targetKind as (typeof AUDIT_TARGET_KINDS)[number])
      : undefined;
    onApply({
      ...(chosenAction === undefined ? {} : { action: chosenAction }),
      ...(chosenKind === undefined ? {} : { targetKind: chosenKind }),
      adminUserId: adminUserId.trim(),
      targetId: targetId.trim(),
      from,
      to,
    });
  }

  return (
    <FilterBar label={t("audit.list.filtersLabel")} onSubmit={submit}>
      <Field id="audit-filter-action" label={t("audit.list.action")}>
        {(control) => (
          <Select
            {...control}
            name="action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="">{t("audit.list.anyAction")}</option>
            {AUDIT_ACTIONS.map((entry) => (
              <option key={entry} value={entry}>
                {t(actionLabelKey(entry))}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id="audit-filter-admin"
        label={t("audit.list.admin")}
        error={adminIdBad ? t("audit.list.notAnId") : undefined}
      >
        {(control) =>
          adminEmails === null ? (
            <Input
              {...control}
              name="adminUserId"
              value={adminUserId}
              maxLength={36}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setAdminUserId(event.target.value)}
            />
          ) : (
            <Select
              {...control}
              name="adminUserId"
              value={adminUserId}
              onChange={(event) => setAdminUserId(event.target.value)}
            >
              <option value="">{t("audit.list.anyAdmin")}</option>
              {[...adminEmails.entries()].map(([id, email]) => (
                <option key={id} value={id}>
                  {email}
                </option>
              ))}
            </Select>
          )
        }
      </Field>
      <Field id="audit-filter-kind" label={t("audit.list.targetKind")}>
        {(control) => (
          <Select
            {...control}
            name="targetKind"
            value={targetKind}
            onChange={(event) => setTargetKind(event.target.value)}
          >
            <option value="">{t("audit.list.anyTarget")}</option>
            {AUDIT_TARGET_KINDS.map((entry) => (
              <option key={entry} value={entry}>
                {t(targetKindLabelKey(entry))}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id="audit-filter-target"
        label={t("audit.list.targetId")}
        error={targetIdBad ? t("audit.list.notAnId") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name="targetId"
            value={targetId}
            maxLength={36}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTargetId(event.target.value)}
          />
        )}
      </Field>
      <Field
        id="audit-filter-from"
        label={t("audit.list.from")}
        error={rangeError?.field === "from" ? rangeMessage : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name="from"
            type="date"
            min="2000-01-01"
            max="2199-12-31"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        )}
      </Field>
      <Field
        id="audit-filter-to"
        label={t("audit.list.to")}
        error={rangeError?.field === "to" ? rangeMessage : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name="to"
            type="date"
            min="2000-01-01"
            max="2199-12-31"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <Button type="submit" variant="secondary">
          {t("audit.list.apply")}
        </Button>
        {hasAuditFilters(query) ? (
          <Link to={PATHS.auditLog} className={linkClass}>
            {t("audit.list.clearFilters")}
          </Link>
        ) : null}
      </div>
    </FilterBar>
  );
}

function targetLink(event: AdminAuditEvent): string | null {
  switch (event.targetKind) {
    case "customer":
      return buildPath(PATHS.customerDetail, { id: event.targetId });
    case "order":
      return buildPath(PATHS.orderDetail, { id: event.targetId });
    case "admin_user":
      return buildPath(PATHS.userDetail, { id: event.targetId });
    case "privacy_request":
      return buildPath(PATHS.privacyRequestDetail, { id: event.targetId });
    default:
      return null;
  }
}

export function actorText(
  t: Translator,
  event: AdminAuditEvent,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): string {
  const label = actorLabel(event.adminUserId, meId, emails);
  switch (label.kind) {
    case "you":
      return t("audit.actor.you");
    case "email":
      return label.email;
    case "other":
      return t("audit.actor.anotherAdmin", { id: label.shortId });
    case "system":
      return t("audit.actor.gone");
  }
}

export interface AuditResultsViewProps {
  t: Translator;
  uiLocale: string;
  query: AuditQuery;
  feed: AuditFeed;
  meId: string;
  adminEmails: ReadonlyMap<string, string> | null;
  /** "Load more" is running. */
  loadingMore: boolean;
  /** The last "load more" failed (its message), or `null`. */
  moreError: ReactNode;
  onLoadMore: () => void;
}

/** The events so far, newest first, with "load more" under the table. */
export function AuditResultsView({
  t,
  uiLocale,
  query,
  feed,
  meId,
  adminEmails,
  loadingMore,
  moreError,
  onLoadMore,
}: AuditResultsViewProps) {
  const columns: DataTableColumn<AdminAuditEvent>[] = [
    {
      id: "time",
      header: t("audit.list.columnTime"),
      cell: (row) => formatDateTime(row.createdAt, uiLocale),
    },
    {
      id: "actor",
      header: t("audit.list.columnActor"),
      cell: (row) => <span className="break-all">{actorText(t, row, meId, adminEmails)}</span>,
    },
    {
      id: "action",
      header: t("audit.list.columnAction"),
      cell: (row) => t(actionLabelKey(row.action)),
    },
    {
      id: "target",
      header: t("audit.list.columnTarget"),
      cell: (row) => {
        const href = targetLink(row);
        const text = t("audit.list.targetText", {
          kind: t(targetKindLabelKey(row.targetKind)),
          id: row.targetId.slice(0, 8),
        });
        return href === null ? (
          text
        ) : (
          <Link to={href} className={linkClass}>
            {text}
          </Link>
        );
      },
    },
    {
      id: "detail",
      header: t("audit.list.columnDetail"),
      cell: (row) => {
        const text = detailText(row.detail);
        return text === "" ? (
          <span className="text-muted-foreground">{t("audit.list.noDetail")}</span>
        ) : (
          <span className="break-words font-mono text-sm">{text}</span>
        );
      },
    },
  ];
  if (feed.events.length === 0) {
    return hasAuditFilters(query) ? (
      <EmptyState
        title={t("audit.list.noMatchTitle")}
        description={t("audit.list.noMatchBody")}
        action={
          <Link to={PATHS.auditLog} className={linkClass}>
            {t("audit.list.clearFilters")}
          </Link>
        }
      />
    ) : (
      <EmptyState title={t("audit.list.emptyTitle")} description={t("audit.list.emptyBody")} />
    );
  }
  const more = canLoadMore(feed);
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption={t("audit.list.caption")}
        captionHidden
        columns={columns}
        rows={feed.events}
        rowKey={(row) => row.id}
        emptyMessage={null}
      />
      <p className="text-muted-foreground">
        {t("audit.list.shown", { count: feed.events.length, total: feed.total })}
      </p>
      {moreError === null ? null : <Alert variant="danger">{moreError}</Alert>}
      {more === "more" ? (
        <div>
          <Button
            variant="secondary"
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
            onClick={onLoadMore}
          >
            {loadingMore ? t("audit.list.loadingMore") : t("audit.list.loadMore")}
          </Button>
        </div>
      ) : more === "offset_limit" ? (
        <Alert variant="info">{t("audit.list.offsetLimit")}</Alert>
      ) : null}
    </div>
  );
}

export function AuditLoading({ t }: { t: Translator }) {
  return <LoadingView t={t} />;
}
