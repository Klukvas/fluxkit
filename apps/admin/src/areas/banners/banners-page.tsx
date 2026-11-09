import type { AdminHomeBanner, AdminHomeBannerList } from "@fluxkit/api-client";
import { LiveRegion, type Translator } from "@fluxkit/ui";
import { useRef, useState, type Ref } from "react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { PATHS } from "../../router/paths";
import { ResourceFallback } from "../../views/status-views";
import { ConfigGate, useContentLocales } from "../catalog-dictionaries/config-gate";
import { primaryLinkClass } from "../catalog-dictionaries/dictionary-frame";
import { ConfirmDelete } from "../catalog-dictionaries/form-dialog";
import { FormErrorSummary, UnknownResultNotice } from "../catalog-dictionaries/form-parts";
import { useFormSubmit } from "../catalog-dictionaries/use-form-submit";
import { BannerListView, bannerName, moveButtonId } from "./banner-list-view";
import { moveBy, moveTo } from "./banner-order";
import { useCanWriteBanners } from "./banner-permissions";
import { BANNER_LIMITS } from "./banner-rules";
import { BannersFrame } from "./banners-frame";

/** What the list's status line says after a write. */
export type ListStatus =
  | { kind: "moved"; name: string; position: number; count: number }
  | { kind: "deleted"; name: string }
  | { kind: "unknown" };

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The status line of the list: always in the page (a live region announces a change of a region that was already there).
 * A move keeps the focus on its button and is announced here; after a delete the focus comes here (the row is gone).
 */
export function ListStatusView({
  t,
  status,
  innerRef,
}: {
  t: Translator;
  status: ListStatus | null;
  innerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>
        {status === null ? null : status.kind === "unknown" ? (
          <UnknownResultNotice t={t} />
        ) : (
          <p className="rounded-panel border border-success p-3 text-foreground">
            {status.kind === "moved"
              ? t("banners.list.moved", {
                  name: status.name,
                  position: status.position,
                  count: status.count,
                })
              : t("banners.list.deleted", { name: status.name })}
          </p>
        )}
      </LiveRegion>
    </div>
  );
}

function BannersList() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWriteBanners();
  const resource = useRefreshingResource((signal) => adminClient.listHomeBanners({ signal }), []);
  // The order the last reorder answered, shown until the next load of the list replaces it.
  const [reordered, setReordered] = useState<{
    from: AdminHomeBannerList;
    items: AdminHomeBanner[];
  } | null>(null);
  const [status, setStatus] = useState<ListStatus | null>(null);
  const [deleting, setDeleting] = useState<AdminHomeBanner | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();
  // No field: a refusal (`order_mismatch` at `ids`) goes to the summary as text.
  const reorder = useFormSubmit([]);
  const data = resource.data;
  const banners =
    data === null
      ? null
      : reordered !== null && reordered.from === data
        ? reordered.items
        : data.items;

  async function sendOrder(next: AdminHomeBanner[], movedId: string, delta: -1 | 1 | null) {
    if (data === null || reorder.pending()) return;
    setStatus(null);
    const outcome = await reorder.submit(() =>
      adminClient.reorderHomeBanners({ ids: next.map((banner) => banner.id) }),
    );
    if (outcome.kind === "ok") {
      const items = outcome.data.items;
      setReordered({ from: data, items });
      const index = items.findIndex((banner) => banner.id === movedId);
      const moved = items[index];
      if (moved !== undefined) {
        setStatus({
          kind: "moved",
          name: bannerName(t, moved, locale, content),
          position: index + 1,
          count: items.length,
        });
        // The focus stays on the button that moved the row, or its twin when the row reached an end.
        if (delta !== null) {
          const atEnd = delta === -1 ? index === 0 : index === items.length - 1;
          const direction = (delta === -1) !== atEnd ? "up" : "down";
          focusAfterCommit(moveButtonId(movedId, direction));
        }
      }
    } else if (outcome.kind === "unknown") {
      setStatus({ kind: "unknown" });
      resource.reload();
      focusAfterCommit(statusRef);
    } else if (outcome.kind === "problem") {
      // Another admin changed the list meanwhile (`order_mismatch`): the summary says so, the list is loaded again.
      resource.reload();
    }
  }

  const atCap = banners !== null && banners.length >= BANNER_LIMITS.maxStored;
  return (
    <BannersFrame
      title={t("page.banners.title")}
      actions={
        canWrite && banners !== null && banners.length > 0 && !atCap ? (
          <Link to={PATHS.bannerNew} className={primaryLinkClass}>
            {t("banners.new")}
          </Link>
        ) : null
      }
    >
      <ListStatusView t={t} status={status} innerRef={statusRef} />
      <FormErrorSummary t={t} summary={reorder.state.summary} summaryRef={reorder.summaryRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : banners === null ? null : (
        <div aria-busy={resource.refreshing || reorder.state.busy || undefined}>
          <BannerListView
            t={t}
            uiLocale={locale}
            content={content}
            banners={banners}
            canWrite={canWrite}
            busy={reorder.state.busy}
            onMove={(index, delta) => {
              const next = moveBy(banners, index, delta);
              const moved = banners[index];
              if (next !== null && moved !== undefined) void sendOrder(next, moved.id, delta);
            }}
            onDrop={(from, to) => {
              const next = moveTo(banners, from, to);
              const moved = banners[from];
              if (next !== null && moved !== undefined) void sendOrder(next, moved.id, null);
            }}
            onDelete={setDeleting}
          />
        </div>
      )}
      {deleting === null ? null : (
        <ConfirmDelete
          t={t}
          canWrite={canWrite}
          open
          onClose={() => setDeleting(null)}
          remove={() => adminClient.deleteHomeBanner(deleting.id)}
          onDeleted={() => {
            setStatus({ kind: "deleted", name: bannerName(t, deleting, locale, content) });
            setDeleting(null);
            resource.reload();
            focusAfterCommit(statusRef);
          }}
          onUnknown={() => {
            setStatus({ kind: "unknown" });
            setDeleting(null);
            resource.reload();
            focusAfterCommit(statusRef);
          }}
          title={t("banners.delete.title", { name: bannerName(t, deleting, locale, content) })}
          description={t("banners.delete.body")}
          hint={t("banners.delete.hint")}
          confirmLabel={t("banners.delete.confirm")}
        />
      )}
    </BannersFrame>
  );
}

/** `/storefront/banners`: the home banners in their order. */
export function BannersPage() {
  return (
    <ConfigGate>
      <BannersList />
    </ConfigGate>
  );
}
