import type { AdminAuditEventList } from "@fluxkit/api-client";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { browserTimeZone } from "../../lib/date-range";
import { describeProblem, describeFailure } from "../../lib/problem-messages";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useAdminEmails } from "../../lib/use-admin-emails";
import { useResource } from "../../lib/use-resource";
import { useSession } from "../../session/session-context";
import { PageHeading, ResourceFallback } from "../../views/status-views";
import {
  appendPage,
  auditRequest,
  emptyFeed,
  readAuditQuery,
  writeAuditQuery,
  type AuditQuery,
} from "./audit-model";
import { AuditFilterForm, AuditResultsView } from "./audit-view";

/** The first page for a request the API accepts; "load more" asks for the following offsets and appends. */
function AuditResults({
  query,
  timeZone,
  adminEmails,
}: {
  query: AuditQuery;
  timeZone: string;
  adminEmails: ReadonlyMap<string, string> | null;
}) {
  const { t, locale } = useI18n();
  const session = useSession();
  const meId = session.state.me?.user.id ?? "";
  const request = auditRequest(query, timeZone, 0);
  const first = useResource(
    (signal) => {
      const built = auditRequest(query, timeZone, 0);
      if (!built.ok) throw new Error("The audit request was built from an invalid range.");
      return adminClient.listAuditEvents({ ...built.options, signal });
    },
    [writeAuditQuery(query)],
  );
  // The pages after the first, in order. The component is keyed by the query, so a new filter starts empty.
  const [later, setLater] = useState<AdminAuditEventList[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [flight] = useState(createSingleFlight);

  if (!request.ok) return null;
  if (first.status !== "ready") {
    return <ResourceFallback t={t} state={first} onRetry={first.reload} />;
  }
  // Event ids already shown are skipped: new events arrive at the top and shift the offsets of the pages after them.
  const feed = [first.data, ...later].reduce(appendPage, emptyFeed());

  async function loadMore() {
    const built = auditRequest(query, timeZone, feed.nextOffset);
    if (!built.ok) return;
    const running = flight.run(() => runWrite(() => adminClient.listAuditEvents(built.options)));
    if (running === null) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const outcome = await running;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "ok") {
        setLater((pages) => [...pages, outcome.data]);
        return;
      }
      const descriptor =
        outcome.kind === "problem"
          ? describeProblem(outcome.status, outcome.problem)
          : describeFailure(outcome.failure);
      setMoreError(t(descriptor.key, descriptor.values));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AuditResultsView
      t={t}
      uiLocale={locale}
      query={query}
      feed={feed}
      meId={meId}
      adminEmails={adminEmails}
      loadingMore={loadingMore}
      moreError={moreError}
      onLoadMore={() => void loadMore()}
    />
  );
}

/** `/audit`: what admins did (owner only, `users.manage`); filters live in the URL, older events load on request. */
export function AuditLogPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const query = readAuditQuery(params);
  const queryKey = writeAuditQuery(query);
  // The browser's zone (there is no shop time zone setting); read once per screen.
  const [timeZone] = useState(browserTimeZone);
  const adminEmails = useAdminEmails(true);
  const request = auditRequest(query, timeZone, 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeading>{t("page.auditLog.title")}</PageHeading>
      <p className="max-w-prose text-muted-foreground">{t("audit.list.intro")}</p>
      <AuditFilterForm
        key={queryKey}
        t={t}
        query={query}
        adminEmails={adminEmails}
        rangeError={request.ok ? null : { field: request.field, reason: request.reason }}
        onApply={(next) => setParams(writeAuditQuery(next))}
      />
      <p className="text-sm text-muted-foreground">{t("audit.list.timeZoneHint")}</p>
      {request.ok ? (
        <AuditResults key={queryKey} query={query} timeZone={timeZone} adminEmails={adminEmails} />
      ) : (
        <p role="alert" className="text-muted-foreground">
          {t("audit.list.rangeNotSent")}
        </p>
      )}
    </div>
  );
}
