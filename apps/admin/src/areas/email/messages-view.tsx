import type { AdminEmailMessage, AdminEmailMessageStatus, Paginated } from "@fluxkit/api-client";
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
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { DayRangeFailure } from "../../lib/date-range";
import { formatDateTime } from "../../lib/format";
import { PATHS } from "../../router/paths";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import { ErrorCodeText, linkClass } from "./email-frame";
import {
  MESSAGE_STATUSES,
  MESSAGE_STATUS_TONES,
  messageHref,
  statusLabelKey,
  templateHref,
} from "./email-view";
import {
  RECIPIENT_MAX_LENGTH,
  checkRecipient,
  hasFilters,
  readTemplateKey,
  type MessageFilters,
  type MessageListQuery,
} from "./message-list-query";

export type MessageListState =
  | { status: "loading" }
  | { status: "ready"; data: Paginated<AdminEmailMessage> }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

export interface MessageFilterFormProps {
  t: Translator;
  query: MessageListQuery;
  /** Registered template keys for the select; the current key is added when it is not among them. */
  templateKeys: readonly string[];
  /** Why the date range is not sent, or `null`. */
  rangeError: { field: "from" | "to"; reason: DayRangeFailure } | null;
  onApply: (filters: MessageFilters) => void;
}

/**
 * The filters as one labelled form: they are typed into local fields and applied together (the Apply button or Enter), so
 * a half-typed address never reloads the list. The page keys this component by the applied query, so Back, a link or
 * "clear filters" reset the fields.
 */
export function MessageFilterForm({
  t,
  query,
  templateKeys,
  rangeError,
  onApply,
}: MessageFilterFormProps) {
  const [status, setStatus] = useState<string>(query.status ?? "");
  const [template, setTemplate] = useState(query.template);
  const [recipient, setRecipient] = useState(query.recipient);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const check = checkRecipient(recipient);
  const keys =
    query.template !== "" && !templateKeys.includes(query.template)
      ? [...templateKeys, query.template]
      : templateKeys;
  const rangeMessage =
    rangeError === null ? undefined : t(`mail.list.dateRange.${rangeError.reason}`);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.ok) return;
    const chosen = (MESSAGE_STATUSES as readonly string[]).includes(status)
      ? (status as AdminEmailMessageStatus)
      : undefined;
    onApply({
      ...(chosen === undefined ? {} : { status: chosen }),
      template: readTemplateKey(template),
      recipient: check.value,
      from,
      to,
    });
  }

  return (
    <FilterBar label={t("mail.list.filtersLabel")} onSubmit={submit}>
      <Field id="email-filter-status" label={t("mail.list.status")}>
        {(control) => (
          <Select
            {...control}
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("mail.list.anyStatus")}</option>
            {MESSAGE_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {t(statusLabelKey(entry))}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="email-filter-template" label={t("mail.list.template")}>
        {(control) => (
          <Select
            {...control}
            name="template"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          >
            <option value="">{t("mail.list.anyTemplate")}</option>
            {keys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="min-w-64">
        <Field
          id="email-filter-recipient"
          label={t("mail.list.recipient")}
          hint={t("mail.list.recipientHint")}
          error={
            check.ok ? undefined : t("mail.list.recipientTooLong", { max: RECIPIENT_MAX_LENGTH })
          }
        >
          {(control) => (
            <Input
              {...control}
              name="recipient"
              type="search"
              value={recipient}
              maxLength={RECIPIENT_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setRecipient(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field
        id="email-filter-from"
        label={t("mail.list.from")}
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
        id="email-filter-to"
        label={t("mail.list.to")}
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
          {t("mail.list.apply")}
        </Button>
        {hasFilters(query) ? (
          <Link to={PATHS.emailMessages} className={linkClass}>
            {t("mail.list.clearFilters")}
          </Link>
        ) : null}
      </div>
    </FilterBar>
  );
}

export interface MessagesScreenProps {
  t: Translator;
  query: MessageListQuery;
  rangeError: { field: "from" | "to"; reason: DayRangeFailure } | null;
  templateKeys: readonly string[];
  onApply: (filters: MessageFilters) => void;
  /** Key of the filter form: the applied query, so the fields follow Back and links. */
  formKey: string;
  /** The results (the data component around `MessageResultsView`); ignored while `rangeError` is set. */
  results: ReactNode;
}

/** The message list screen: heading, filters and the results, or the date-range problem instead of them. */
export function MessagesScreen({
  t,
  query,
  rangeError,
  templateKeys,
  onApply,
  formKey,
  results,
}: MessagesScreenProps) {
  return (
    <>
      <MessageFilterForm
        key={formKey}
        t={t}
        query={query}
        templateKeys={templateKeys}
        rangeError={rangeError}
        onApply={onApply}
      />
      <p className="text-sm text-muted-foreground">{t("mail.list.timeZoneHint")}</p>
      {rangeError === null ? (
        results
      ) : (
        <Alert variant="warning">{t("mail.list.rangeNotSent")}</Alert>
      )}
    </>
  );
}

export interface MessageResultsViewProps {
  t: Translator;
  uiLocale: string;
  query: MessageListQuery;
  state: MessageListState;
  onRetry: () => void;
  hrefForOffset: (offset: number) => string;
}

/** Loading rows, the failure with a retry, an empty state, no match, past the end, or the table with its pager. */
export function MessageResultsView({
  t,
  uiLocale,
  query,
  state,
  onRetry,
  hrefForOffset,
}: MessageResultsViewProps) {
  const columns: DataTableColumn<AdminEmailMessage>[] = [
    {
      id: "created",
      header: t("mail.list.columnCreated"),
      cell: (row) => (
        <Link to={messageHref(row.id)} className={linkClass}>
          {formatDateTime(row.createdAt, uiLocale)}
        </Link>
      ),
    },
    {
      id: "status",
      header: t("mail.list.columnStatus"),
      cell: (row) => (
        <StatusBadge
          tone={MESSAGE_STATUS_TONES[row.status]}
          label={t(statusLabelKey(row.status))}
        />
      ),
    },
    {
      id: "template",
      header: t("mail.list.columnTemplate"),
      cell: (row) => (
        <Link to={templateHref(row.templateKey)} className={`${linkClass} break-all font-mono`}>
          {row.templateKey}
        </Link>
      ),
    },
    {
      id: "recipient",
      header: t("mail.list.columnRecipient"),
      cell: (row) => <span className="break-all">{row.to}</span>,
    },
    {
      id: "attempts",
      header: t("mail.list.columnAttempts"),
      align: "end",
      cell: (row) => new Intl.NumberFormat(uiLocale).format(row.attempts),
    },
    {
      id: "error",
      header: t("mail.list.columnError"),
      cell: (row) =>
        row.lastErrorCode === null ? (
          <span className="text-muted-foreground">{t("mail.list.noError")}</span>
        ) : (
          <ErrorCodeText t={t} code={row.lastErrorCode} />
        ),
    },
  ];
  const caption = t("mail.list.caption");
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
          <p className="text-muted-foreground">{t("mail.list.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={linkClass}>
            {t("mail.list.firstPage")}
          </Link>
        </div>
      );
    }
    if (!hasFilters(query)) {
      return (
        <EmptyState title={t("mail.list.emptyTitle")} description={t("mail.list.emptyBody")} />
      );
    }
    return (
      <EmptyState
        title={t("mail.list.noMatchTitle")}
        description={t("mail.list.noMatchBody")}
        action={
          <Link to={PATHS.emailMessages} className={linkClass}>
            {t("mail.list.clearFilters")}
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
      <MessagePager
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
export function MessagePager({
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
    <nav aria-label={t("mail.list.pagerLabel")} className="flex flex-wrap items-center gap-4">
      <p className="text-muted-foreground">
        {t("mail.list.pageRange", { from: offset + 1, to: offset + count, total })}
      </p>
      {hasPrevious ? (
        <Link to={hrefForOffset(Math.max(0, offset - limit))} rel="prev" className={linkClass}>
          {t("mail.list.previous")}
        </Link>
      ) : null}
      {hasNext ? (
        <Link to={hrefForOffset(offset + limit)} rel="next" className={linkClass}>
          {t("mail.list.next")}
        </Link>
      ) : null}
    </nav>
  );
}
