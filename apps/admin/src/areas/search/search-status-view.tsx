import type { AdminSearchStatus } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  StatusBadge,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { formatDateTime } from "../../lib/format";
import { DescriptorText, StatusLine, localeLabel } from "./search-frame";
import type { RebuildNotice } from "./search-outcome";
import {
  ageText,
  engineView,
  laneView,
  localeView,
  queueView,
  rejectedView,
  type LaneView,
  type LocaleView,
  type QueueView,
} from "./search-view";

/**
 * The Search status screen: props in, markup out, every word from the translator. The page (`status-page.tsx`) owns the
 * data, the refresh and the rebuild; this file only shows it.
 */

export const LOCALE_STATES = [
  "building",
  "never_indexed",
  "rebuild_requested",
  "documents_stale",
  "settings_pending",
  "fresh",
] as const;

function Code({ code }: { code: string | null }) {
  return code === null ? null : (
    <small className="break-all font-mono text-muted-foreground">{code}</small>
  );
}

function when(t: Translator, uiLocale: string, value: string | null, now: Date): ReactNode {
  if (value === null)
    return <span className="text-muted-foreground">{t("search.field.none")}</span>;
  return t("search.field.timeAge", {
    time: formatDateTime(value, uiLocale),
    age: ageText(value, now, uiLocale),
  });
}

function EngineSection({
  t,
  uiLocale,
  engine,
}: {
  t: Translator;
  uiLocale: string;
  engine: AdminSearchStatus["engine"];
}) {
  const view = engineView(engine);
  const rejected = rejectedView(engine.rejectedSearches);
  return (
    <section aria-labelledby="search-engine" className="flex max-w-2xl flex-col gap-3">
      <h2 id="search-engine" className="text-lg font-semibold text-foreground">
        {t("search.engine.title")}
      </h2>
      {view.kind === "reachable" ? (
        <p>
          <StatusBadge tone="success" label={t("search.engine.reachable")} />
        </p>
      ) : (
        <Alert variant="danger" title={t("search.engine.unreachable")}>
          <p>
            <DescriptorText t={t} descriptor={view.code} />
          </p>
          <p>
            <Code code={view.raw} />
          </p>
          <p className="mt-1 text-muted-foreground">{t("search.engine.unreachableNote")}</p>
        </Alert>
      )}
      {rejected.kind === "none" ? (
        <p className="text-muted-foreground">{t("search.rejected.none")}</p>
      ) : (
        <Alert variant="warning" title={t("search.rejected.title")}>
          <p>{t("search.rejected.body", { count: rejected.count })}</p>
          {rejected.lastAt === null ? null : (
            <p>{t("search.rejected.last", { time: formatDateTime(rejected.lastAt, uiLocale) })}</p>
          )}
          <p>
            <Code code={rejected.lastCode} />
          </p>
        </Alert>
      )}
      <LaneBlock t={t} uiLocale={uiLocale} lane={laneView(engine.interactiveLane)} />
    </section>
  );
}

/** The engine client's interactive lane (ADR 0041, 0042): how full it is, how full it got, what it refused. */
function LaneBlock({ t, uiLocale, lane }: { t: Translator; uiLocale: string; lane: LaneView }) {
  const number = new Intl.NumberFormat(uiLocale);
  const percent = new Intl.NumberFormat(uiLocale, { style: "percent", maximumFractionDigits: 1 });
  const facts = [
    {
      id: "inFlight",
      term: t("search.lane.inFlight"),
      description: t("search.lane.ofLimit", {
        value: number.format(lane.inFlight),
        limit: number.format(lane.maxConcurrency),
      }),
    },
    {
      id: "queued",
      term: t("search.lane.queued"),
      description: t("search.lane.ofLimit", {
        value: number.format(lane.queued),
        limit: number.format(lane.maxQueue),
      }),
    },
    {
      id: "peaks",
      term: t("search.lane.peaks"),
      description: t("search.lane.peaksValue", {
        inFlight: number.format(lane.inFlightHighWater),
        queued: number.format(lane.queuedHighWater),
      }),
    },
    { id: "admitted", term: t("search.lane.admitted"), description: number.format(lane.admitted) },
    { id: "calls", term: t("search.lane.calls"), description: number.format(lane.calls) },
    {
      id: "refusedQueueFull",
      term: t("search.lane.refusedQueueFull"),
      description: number.format(lane.queueFull),
    },
    {
      id: "refusedWaitExceeded",
      term: t("search.lane.refusedWaitExceeded"),
      description: number.format(lane.waitExceeded),
    },
    { id: "abandoned", term: t("search.lane.abandoned"), description: number.format(lane.abandoned) },
  ];
  return (
    <section aria-labelledby="search-lane" className="flex flex-col gap-3">
      <h3 id="search-lane" className="text-base font-semibold text-foreground">
        {t("search.lane.title")}
      </h3>
      <p className="text-muted-foreground">
        {t("search.lane.intro", { time: formatDateTime(lane.since, uiLocale) })}
      </p>
      {lane.state === "refused" ? (
        <Alert variant="warning" title={t("search.lane.refusedTitle")}>
          <p>
            {t("search.lane.refusedBody", {
              count: number.format(lane.refused),
              share: percent.format(lane.refusedShare ?? 0),
            })}
          </p>
          <p>{t("search.lane.advice")}</p>
        </Alert>
      ) : (
        <p className="text-muted-foreground">{t("search.lane.noneRefused")}</p>
      )}
      <DescriptionList items={facts} />
    </section>
  );
}

function LocaleCard({
  t,
  uiLocale,
  view,
  now,
}: {
  t: Translator;
  uiLocale: string;
  view: LocaleView;
  now: Date;
}) {
  const headingId = `search-locale-${view.locale}`;
  const facts = [
    {
      id: "liveIndex",
      term: t("search.field.liveIndex"),
      description:
        view.liveIndex === null ? (
          <span className="text-muted-foreground">{t("search.field.none")}</span>
        ) : (
          <span className="break-all font-mono">{view.liveIndex}</span>
        ),
    },
    {
      id: "documents",
      term: t("search.field.documents"),
      description:
        view.documents === null ? (
          <span className="text-muted-foreground">{t("search.field.none")}</span>
        ) : (
          new Intl.NumberFormat(uiLocale).format(view.documents)
        ),
    },
    {
      id: "builtAt",
      term: t("search.field.builtAt"),
      description:
        view.builtAt === null ? (
          <span className="text-muted-foreground">{t("search.field.never")}</span>
        ) : (
          when(t, uiLocale, view.builtAt, now)
        ),
    },
    ...(view.rebuildRequestedAt === null
      ? []
      : [
          {
            id: "rebuildRequestedAt",
            term: t("search.field.rebuildRequestedAt"),
            description: when(t, uiLocale, view.rebuildRequestedAt, now),
          },
        ]),
    ...(view.build === null
      ? []
      : [
          {
            id: "build",
            term: t("search.field.build"),
            description: t("search.field.buildValue", {
              documents: new Intl.NumberFormat(uiLocale).format(view.build.documents),
              time: formatDateTime(view.build.startedAt, uiLocale),
            }),
          },
        ]),
  ];
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={headingId} className="text-base font-semibold text-foreground">
          {localeLabel(t, view.locale)}
        </h3>
        <StatusBadge tone={view.tone} label={t(`search.state.${view.state}`)} />
      </div>
      <p className="text-muted-foreground">{t(`search.stateHelp.${view.state}`)}</p>
      <DescriptionList items={facts} />
      {view.error === null ? null : (
        <Alert variant="danger" title={t("search.localeError.title")}>
          <p>
            <DescriptorText t={t} descriptor={view.error.code} />
          </p>
          <p>
            <Code code={view.error.raw} />
          </p>
          <p>{t("search.localeError.attempts", { count: view.error.attempts })}</p>
          {view.error.at === null ? null : (
            <p>{t("search.localeError.last", { time: formatDateTime(view.error.at, uiLocale) })}</p>
          )}
          {view.error.retryAt === null ? null : (
            <p>
              {t("search.localeError.retry", {
                time: formatDateTime(view.error.retryAt, uiLocale),
              })}
            </p>
          )}
        </Alert>
      )}
    </section>
  );
}

function QueueSection({
  t,
  uiLocale,
  queue,
}: {
  t: Translator;
  uiLocale: string;
  queue: QueueView;
}) {
  const number = new Intl.NumberFormat(uiLocale);
  const facts = [
    { id: "depth", term: t("search.queue.depth"), description: number.format(queue.depth) },
    { id: "due", term: t("search.queue.due"), description: number.format(queue.due) },
    { id: "leased", term: t("search.queue.leased"), description: number.format(queue.leased) },
    { id: "dead", term: t("search.queue.dead"), description: number.format(queue.dead) },
    {
      id: "oldest",
      term: t("search.queue.oldest"),
      description:
        queue.lagMinutes === null ? (
          <span className="text-muted-foreground">{t("search.queue.nothingDue")}</span>
        ) : (
          t("search.queue.lag", { minutes: number.format(queue.lagMinutes) })
        ),
    },
  ];
  const codeColumns: DataTableColumn<QueueView["errorCodes"][number]>[] = [
    {
      id: "code",
      header: t("search.queue.columnError"),
      cell: (row) => (
        <span className="flex flex-col">
          <span>
            <DescriptorText t={t} descriptor={row.code} />
          </span>
          <Code code={row.raw} />
        </span>
      ),
    },
    {
      id: "count",
      header: t("search.queue.columnCount"),
      align: "end",
      cell: (row) => number.format(row.count),
    },
  ];
  return (
    <section aria-labelledby="search-queue" className="flex max-w-2xl flex-col gap-3">
      <h2 id="search-queue" className="text-lg font-semibold text-foreground">
        {t("search.queue.title")}
      </h2>
      <p className="text-muted-foreground">{t("search.queue.intro")}</p>
      {queue.state === "attention" ? (
        <Alert variant="warning">
          <p>{t("search.queue.state.attention")}</p>
        </Alert>
      ) : (
        <p>{t(`search.queue.state.${queue.state}`)}</p>
      )}
      <DescriptionList items={facts} />
      {queue.errorCodes.length === 0 ? (
        <EmptyState
          headingAs="h3"
          title={t("search.queue.noErrorsTitle")}
          description={t("search.queue.noErrorsBody")}
        />
      ) : (
        <DataTable
          caption={t("search.queue.errorsCaption")}
          captionHidden
          columns={codeColumns}
          rows={queue.errorCodes}
          rowKey={(row) => row.raw}
          emptyMessage={null}
        />
      )}
    </section>
  );
}

export interface RebuildPanelProps {
  t: Translator;
  uiLocale: string;
  /** Whether the admin may change the catalog (the rebuild needs `catalog.write`). */
  canManage: boolean;
  busy: boolean;
  notice: RebuildNotice;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  noticeRef?: Ref<HTMLDivElement>;
}

/** The rebuild action: a button that only asks, the confirmation, and the live outcome. */
export function RebuildPanel({
  t,
  uiLocale,
  canManage,
  busy,
  notice,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
  noticeRef,
}: RebuildPanelProps) {
  return (
    <section aria-labelledby="search-rebuild" className="flex max-w-2xl flex-col gap-3">
      <h2 id="search-rebuild" className="text-lg font-semibold text-foreground">
        {t("search.rebuild.title")}
      </h2>
      <p className="text-muted-foreground">{t("search.rebuild.body")}</p>
      {canManage ? (
        <div>
          <Button type="button" disabled={busy} aria-busy={busy || undefined} onClick={onAsk}>
            {busy ? t("search.rebuild.busy") : t("search.rebuild.button")}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("search.rebuild.readOnly")}</p>
      )}
      <StatusLine innerRef={noticeRef}>
        <RebuildNoticeView t={t} uiLocale={uiLocale} notice={notice} />
      </StatusLine>
      <ConfirmDialog
        open={confirming}
        onClose={onCancel}
        onConfirm={onConfirm}
        busy={busy}
        title={t("search.rebuild.confirmTitle")}
        description={t("search.rebuild.confirmBody")}
        confirmLabel={t("search.rebuild.confirm")}
        cancelLabel={t("search.rebuild.cancel")}
      />
    </section>
  );
}

export function RebuildNoticeView({
  t,
  uiLocale,
  notice,
}: {
  t: Translator;
  uiLocale: string;
  notice: RebuildNotice;
}) {
  switch (notice.kind) {
    case "idle":
      return null;
    case "requested":
      return (
        <Alert variant="success">
          <p>
            {t("search.rebuild.requested", {
              time: formatDateTime(notice.requestedAt, uiLocale),
              locales: notice.locales.map((entry) => localeLabel(t, entry)).join(", "),
            })}
          </p>
          <p>{t("search.rebuild.requestedNote")}</p>
        </Alert>
      );
    case "off":
      return <Alert variant="info">{t("search.rebuild.off")}</Alert>;
    case "forbidden":
      return <Alert variant="warning">{t("search.rebuild.forbidden")}</Alert>;
    case "refused":
      return (
        <Alert variant="danger" title={t("search.rebuild.refusedTitle")}>
          <p>
            <DescriptorText t={t} descriptor={notice.descriptor} />
          </p>
        </Alert>
      );
    case "unknown":
      return (
        <Alert variant="warning" title={t("search.rebuild.unknownTitle")}>
          <p>{t("search.rebuild.unknownBody")}</p>
        </Alert>
      );
  }
}

export interface StatusViewProps {
  t: Translator;
  uiLocale: string;
  status: AdminSearchStatus;
  now: Date;
  /** The rebuild action (a container with its own state), rendered under the facts. */
  rebuild: ReactNode;
}

/** The facts: the engine, one card per language, the queue, then the rebuild action. */
export function StatusView({ t, uiLocale, status, now, rebuild }: StatusViewProps) {
  const locales = status.locales.map((entry) => localeView(entry));
  const queue = queueView(status.queue, now);
  return (
    <div className="flex flex-col gap-8">
      <EngineSection t={t} uiLocale={uiLocale} engine={status.engine} />
      <section aria-labelledby="search-indexes" className="flex flex-col gap-3">
        <h2 id="search-indexes" className="text-lg font-semibold text-foreground">
          {t("search.indexes.title")}
        </h2>
        <p className="max-w-prose text-muted-foreground">{t("search.indexes.intro")}</p>
        <div className="grid max-w-5xl gap-4 md:grid-cols-2">
          {locales.map((view) => (
            <LocaleCard key={view.locale} t={t} uiLocale={uiLocale} view={view} now={now} />
          ))}
        </div>
      </section>
      <QueueSection t={t} uiLocale={uiLocale} queue={queue} />
      {rebuild}
    </div>
  );
}
