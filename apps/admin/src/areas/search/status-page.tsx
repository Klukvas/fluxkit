import { Button } from "@fluxkit/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { LoadingView, ResourceFallback } from "../../views/status-views";
import { SearchFrame, SearchOffView } from "./search-frame";
import { rebuildNotice, type RebuildNotice } from "./search-outcome";
import { useCanManageSearch, whenCanManage } from "./search-permissions";
import { RebuildPanel, StatusView } from "./search-status-view";
import { searchScreenState } from "./search-view";

/** `/search`: the engine, the index of every language, the sync queue and the rebuild action. */
export function SearchStatusPage() {
  const { t, locale } = useI18n();
  const canManage = useCanManageSearch();
  // The previous status stays on screen while a refresh runs, so the rebuild notice below it is not unmounted.
  const resource = useRefreshingResource((signal) => adminClient.getSearchStatus({ signal }), []);
  const now = useMemo(() => new Date(), [resource.data]);
  const [notice, setNotice] = useState<RebuildNotice>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notice.kind !== "idle") noticeRef.current?.focus();
  }, [notice]);

  async function confirmRebuild() {
    // Only with the permission (whenCanManage), one request per confirmation, never repeated by the screen: the API treats
    // a request while a build runs as already recorded, and a lost answer is said as it is (the status below shows whether
    // it was recorded).
    const running = whenCanManage(canManage, () =>
      flight.run(() => runWrite(() => adminClient.requestSearchRebuild())),
    );
    if (running === null) return;
    setBusy(true);
    const outcome = await running.finally(() => setBusy(false));
    setConfirming(false);
    setNotice(rebuildNotice(outcome));
    if (outcome.kind !== "aborted") resource.reload();
  }

  const screen =
    resource.fallback !== null
      ? searchScreenState(resource.fallback)
      : resource.data !== null
        ? ({ kind: "data" } as const)
        : ({ kind: "fallback" } as const);

  let body;
  if (screen.kind === "off") {
    body = <SearchOffView t={t} />;
  } else if (screen.kind === "fallback" || resource.data === null) {
    body =
      resource.fallback === null ? (
        <LoadingView t={t} />
      ) : (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      );
  } else {
    body = (
      <StatusView
        t={t}
        uiLocale={locale}
        status={resource.data}
        now={now}
        rebuild={
          <RebuildPanel
            t={t}
            uiLocale={locale}
            canManage={canManage}
            busy={busy}
            notice={notice}
            confirming={confirming}
            onAsk={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onConfirm={() => void confirmRebuild()}
            noticeRef={noticeRef}
          />
        }
      />
    );
  }

  return (
    <SearchFrame
      t={t}
      current="search"
      title={t("page.search.title")}
      actions={
        screen.kind === "data" ? (
          <Button
            variant="secondary"
            disabled={resource.refreshing}
            aria-busy={resource.refreshing || undefined}
            onClick={resource.reload}
          >
            {resource.refreshing ? t("search.status.refreshing") : t("search.status.refresh")}
          </Button>
        ) : undefined
      }
    >
      <p className="max-w-prose text-muted-foreground">{t("search.status.intro")}</p>
      {screen.kind === "data" ? (
        <p className="text-muted-foreground">
          {t("search.status.updated", { time: formatDateTime(now, locale) })}
        </p>
      ) : null}
      {body}
    </SearchFrame>
  );
}
