import type { AdminEmailStatus } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  DescriptionList,
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
import { ErrorCodeText, StatusLine, linkClass } from "./email-frame";
import { MESSAGE_STATUSES, ageText, mailboxText, messageHref, statusLabelKey } from "./email-view";
import type { TestSendView } from "./test-send";

export type StatusState =
  | { status: "loading" }
  | { status: "ready"; data: AdminEmailStatus }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

/** The setup steps shown while no provider is configured: environment variable NAMES only, never a key or a value. */
export const SETUP_STEP_KEYS = [
  "mail.setup.step1",
  "mail.setup.step2",
  "mail.setup.step3",
  "mail.setup.step4",
] as const;

export function NotConfigured({ t }: { t: Translator }) {
  return (
    <section aria-labelledby="email-setup" className="flex max-w-2xl flex-col gap-3">
      <Alert variant="info" title={t("mail.notConfigured.title")}>
        <p>{t("mail.notConfigured.body")}</p>
      </Alert>
      <h2 id="email-setup" className="text-lg font-semibold text-foreground">
        {t("mail.setup.title")}
      </h2>
      <ol className="flex list-decimal flex-col gap-1 ps-6">
        {SETUP_STEP_KEYS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <p className="text-muted-foreground">{t("mail.setup.secretNote")}</p>
    </section>
  );
}

export interface TestSendPanelProps {
  t: Translator;
  configured: boolean;
  canManage: boolean;
  locales: readonly string[];
  locale: string;
  onLocaleChange: (locale: string) => void;
  busy: boolean;
  view: TestSendView;
  onSend: () => void;
  resultRef?: Ref<HTMLDivElement>;
}

/** The test send: the language, the button (off without a provider) and the live result. */
export function TestSendPanel({
  t,
  configured,
  canManage,
  locales,
  locale,
  onLocaleChange,
  busy,
  view,
  onSend,
  resultRef,
}: TestSendPanelProps) {
  return (
    <section aria-labelledby="email-test" className="flex max-w-2xl flex-col gap-3">
      <h2 id="email-test" className="text-lg font-semibold text-foreground">
        {t("mail.test.title")}
      </h2>
      <p className="text-muted-foreground">{t("mail.test.intro")}</p>
      {canManage ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field id="email-test-locale" label={t("mail.test.locale")}>
            {(control) => (
              <Select
                {...control}
                name="locale"
                value={locale}
                disabled={!configured || busy}
                onChange={(event) => onLocaleChange(event.target.value)}
              >
                {locales.map((entry) => (
                  <option key={entry} value={entry}>
                    {t(`mail.locale.${entry}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="pb-1">
            <Button
              type="button"
              disabled={!configured || busy}
              aria-busy={busy || undefined}
              aria-describedby={configured ? undefined : "email-test-disabled"}
              onClick={onSend}
            >
              {busy ? t("mail.test.sending") : t("mail.test.send")}
            </Button>
          </div>
        </div>
      ) : null}
      {configured ? null : (
        <p id="email-test-disabled" className="text-muted-foreground">
          {t("mail.test.disabled")}
        </p>
      )}
      <StatusLine innerRef={resultRef}>
        <TestSendResult t={t} view={view} />
      </StatusLine>
    </section>
  );
}

export function TestSendResult({ t, view }: { t: Translator; view: TestSendView }) {
  switch (view.kind) {
    case "idle":
      return null;
    case "queued":
      return (
        <Alert variant="success">
          <p>{t("mail.test.queued")}</p>
          <p>
            <Link to={messageHref(view.messageId)} className={linkClass}>
              {t("mail.test.openMessage")}
            </Link>
          </p>
        </Alert>
      );
    case "refused":
      return (
        <Alert variant="danger" title={t("mail.test.refusedTitle")}>
          <p>{t(view.descriptor.key, view.descriptor.values)}</p>
          {view.descriptor.code === undefined ? null : (
            <p className="text-sm">
              <small>{t("errors.reference", { code: view.descriptor.code })}</small>
            </p>
          )}
        </Alert>
      );
    case "unknown":
      return (
        <Alert variant="warning" title={t("mail.unknown.title")}>
          <p>{t("mail.test.unknownBody")}</p>
          <p>
            <Link to={PATHS.emailMessages} className={linkClass}>
              {t("mail.unknown.openList")}
            </Link>
          </p>
        </Alert>
      );
  }
}

export interface StatusViewProps {
  t: Translator;
  uiLocale: string;
  state: StatusState;
  now: Date;
  onRetry: () => void;
  /** The test send panel (a container with its own state), rendered under the facts. */
  testSend: (status: AdminEmailStatus) => ReactNode;
}

interface CountRow {
  status: (typeof MESSAGE_STATUSES)[number];
  count: number;
}

/** The delivery status: loading, the failure, or the facts (provider, sender, 24 hour counts, queue, error codes). */
export function StatusView({ t, uiLocale, state, now, onRetry, testSend }: StatusViewProps) {
  if (state.status !== "ready") {
    return state.status === "loading" ? (
      <p className="text-muted-foreground" aria-busy="true">
        {t("status.loading")}
      </p>
    ) : (
      <ResourceFallback t={t} state={state} onRetry={onRetry} />
    );
  }
  const status = state.data;
  const countRows: CountRow[] = MESSAGE_STATUSES.map((entry) => ({
    status: entry,
    count: status.counts[entry],
  }));
  const countColumns: DataTableColumn<CountRow>[] = [
    {
      id: "status",
      header: t("mail.status.columnStatus"),
      cell: (row) => (
        <Link to={`${PATHS.emailMessages}?status=${row.status}`} className={linkClass}>
          {t(statusLabelKey(row.status))}
        </Link>
      ),
    },
    {
      id: "count",
      header: t("mail.status.columnCount"),
      align: "end",
      cell: (row) => new Intl.NumberFormat(uiLocale).format(row.count),
    },
  ];
  const codeColumns: DataTableColumn<AdminEmailStatus["errorCodes"][number]>[] = [
    {
      id: "code",
      header: t("mail.status.columnError"),
      cell: (row) => <ErrorCodeText t={t} code={row.code} />,
    },
    {
      id: "count",
      header: t("mail.status.columnCount"),
      align: "end",
      cell: (row) => new Intl.NumberFormat(uiLocale).format(row.count),
    },
  ];
  const facts = [
    {
      id: "provider",
      term: t("mail.status.provider"),
      description:
        status.providerCode === null ? (
          <span className="text-muted-foreground">{t("mail.status.noProvider")}</span>
        ) : (
          <span className="break-all font-mono">{status.providerCode}</span>
        ),
    },
    {
      id: "from",
      term: t("mail.status.from"),
      description:
        status.from === null ? (
          <span className="text-muted-foreground">{t("mail.status.notSet")}</span>
        ) : (
          <span className="break-all">{mailboxText(status.from)}</span>
        ),
    },
    {
      id: "replyTo",
      term: t("mail.status.replyTo"),
      description:
        status.replyTo === null ? (
          <span className="text-muted-foreground">{t("mail.status.notSet")}</span>
        ) : (
          <span className="break-all">{mailboxText(status.replyTo)}</span>
        ),
    },
  ];
  const queue = [
    {
      id: "depth",
      term: t("mail.status.queueDepth"),
      description: new Intl.NumberFormat(uiLocale).format(status.queueDepth),
    },
    {
      id: "oldest",
      term: t("mail.status.oldestPending"),
      description:
        status.oldestPendingAt === null ? (
          <span className="text-muted-foreground">{t("mail.status.nonePending")}</span>
        ) : (
          t("mail.status.oldestValue", {
            time: formatDateTime(status.oldestPendingAt, uiLocale),
            age: ageText(status.oldestPendingAt, now, uiLocale),
          })
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-8">
      {status.configured ? null : <NotConfigured t={t} />}
      <section aria-labelledby="email-delivery" className="flex max-w-2xl flex-col gap-3">
        <h2 id="email-delivery" className="text-lg font-semibold text-foreground">
          {t("mail.status.deliveryTitle")}
        </h2>
        <DescriptionList items={facts} />
      </section>
      <section aria-labelledby="email-counts" className="flex max-w-2xl flex-col gap-3">
        <h2 id="email-counts" className="text-lg font-semibold text-foreground">
          {t("mail.status.countsTitle")}
        </h2>
        <p className="text-muted-foreground">
          {t("mail.status.since", { time: formatDateTime(status.since, uiLocale) })}
        </p>
        <DataTable
          caption={t("mail.status.countsCaption")}
          captionHidden
          columns={countColumns}
          rows={countRows}
          rowKey={(row) => row.status}
          emptyMessage={null}
        />
      </section>
      <section aria-labelledby="email-queue" className="flex max-w-2xl flex-col gap-3">
        <h2 id="email-queue" className="text-lg font-semibold text-foreground">
          {t("mail.status.queueTitle")}
        </h2>
        <DescriptionList items={queue} />
      </section>
      <section aria-labelledby="email-errors" className="flex max-w-2xl flex-col gap-3">
        <h2 id="email-errors" className="text-lg font-semibold text-foreground">
          {t("mail.status.errorsTitle")}
        </h2>
        {status.errorCodes.length === 0 ? (
          <EmptyState
            title={t("mail.status.noErrorsTitle")}
            description={t("mail.status.noErrorsBody")}
          />
        ) : (
          <DataTable
            caption={t("mail.status.errorsCaption")}
            captionHidden
            columns={codeColumns}
            rows={status.errorCodes}
            rowKey={(row) => row.code}
            emptyMessage={null}
          />
        )}
      </section>
      {testSend(status)}
    </div>
  );
}
