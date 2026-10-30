import type { AdminProduct, AdminProductTypeDetail, AdminResult } from "@fluxkit/api-client";
import { ConfirmDialog, Tabs } from "@fluxkit/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { PRODUCT_EDITOR_TABS } from "../../layout/product-editor";
import { adminClient } from "../../lib/api";
import { describeProblem, type MessageDescriptor } from "../../lib/problem-messages";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useCrash } from "../../lib/use-crash";
import { focusWhenPresent, useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { PATHS } from "../../router/paths";
import { useSession } from "../../session/session-context";
import { FailureMessage, PageHeading, ResourceFallback } from "../../views/status-views";
import { ConfigGate, useAdminConfig, useContentLocales } from "../catalog-dictionaries/config-gate";
import { BackLink, DeletedPanel } from "../catalog-dictionaries/dictionary-frame";
import { ConfirmDelete } from "../catalog-dictionaries/form-dialog";
import { EditorNoticeBar, type EditorNotice, type EditorNoticeKind } from "./editor-notice";
import {
  NO_DIRTY_TABS,
  dirtyTab,
  productRevision,
  readTab,
  tabSearch,
  visibleTabs,
  withDirty,
} from "./editor-tabs";
import {
  LifecycleActionsView,
  ProductSummaryView,
  PublishProblemsView,
  productTitle,
} from "./editor-views";
import { LIFECYCLE_CONFIRMATION, permittedActions, type LifecycleAction } from "./lifecycle";
import { mapPublishProblems, type EditorTabId, type PublishProblem } from "./publish-problems";
import type { ChangeDetail } from "./tab-props";

/** How long to wait for a problem's field to appear after its tab opened. */
const FOCUS_WAIT_MS = 5000;

interface EditorData {
  product: AdminProduct;
  productType: AdminProductTypeDetail;
}

/** The product and its type (the attribute definitions are embedded in the type: one read, no N+1). */
async function loadEditorData(id: string, signal: AbortSignal): Promise<AdminResult<EditorData>> {
  const product = await adminClient.getProduct(id, { signal });
  if (!product.ok) return product;
  const productType = await adminClient.getProductType(product.data.productTypeId, { signal });
  if (!productType.ok) return productType;
  return { ok: true, status: 200, data: { product: product.data, productType: productType.data } };
}

const LIFECYCLE_CALLS: Record<
  Exclude<LifecycleAction, "delete">,
  (id: string) => Promise<AdminResult<AdminProduct>>
> = {
  publish: (id) => adminClient.publishProduct(id),
  unpublish: (id) => adminClient.unpublishProduct(id),
  archive: (id) => adminClient.archiveProduct(id),
  restore: (id) => adminClient.restoreProduct(id),
};

const NOTICE_OF: Record<Exclude<LifecycleAction, "delete">, EditorNoticeKind> = {
  publish: "published",
  unpublish: "unpublished",
  archive: "archived",
  restore: "restored",
};

/**
 * `/products/:id`: the summary (title, status, type, dates, lifecycle actions) and the tabs of `src/layout/product-editor.ts`
 * (WAI-ARIA tabs, the tab in `?tab=`). Every write is sent once and never optimistic: the editor reloads the product and
 * the status line says what happened; a lost answer is "result unknown". A refused publish is listed with links to the
 * tab and field of each problem.
 */
function ProductEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const config = useAdminConfig();
  const session = useSession();
  const permissions = session.state.me?.permissions ?? null;
  const crash = useCrash();
  const resource = useRefreshingResource((signal) => loadEditorData(id, signal), [id]);
  const [params, setParams] = useSearchParams();
  const tabs = visibleTabs(PRODUCT_EDITOR_TABS, permissions);
  const tabIds = tabs.map((tab) => tab.id);
  const selected = readTab(params, tabIds);

  const [notice, setNotice] = useState<EditorNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(NO_DIRTY_TABS);
  const [problems, setProblems] = useState<PublishProblem[]>([]);
  const problemsRef = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<MessageDescriptor | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [flight] = useState(createSingleFlight);
  const [confirming, setConfirming] = useState<LifecycleAction | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{ tab: EditorTabId; id: string } | null>(null);
  const reload = resource.reload;

  const changed = useCallback(
    (kind: EditorNoticeKind, detail?: ChangeDetail) => {
      setNotice((current) => ({
        kind,
        n: (current?.n ?? 0) + 1,
        ...(detail?.values === undefined ? {} : { values: detail.values }),
      }));
      if (kind !== "noChanges") reload();
      // A saved tab's publish problems are out of date (a saved variant: only that variant's); the next publish checks again.
      if (kind === "saved" && selected !== null) {
        const variantId = detail?.variantId;
        setProblems((current) =>
          current.filter(
            (problem) =>
              problem.tab !== selected ||
              (variantId !== undefined && problem.variantId !== variantId),
          ),
        );
      }
      focusAfterCommit(noticeRef);
    },
    [reload, selected, focusAfterCommit],
  );

  const reportDirty = useCallback(
    (value: boolean) => {
      if (selected !== null) setDirty((current) => withDirty(current, selected, value));
    },
    [selected],
  );

  useEffect(() => {
    if (pendingFocus === null || pendingFocus.tab !== selected) return undefined;
    // A tab that reads its own data (Prices, Stock) renders the target only after its read: wait for it, a few seconds
    // at most (then the problem list stays where it is).
    return focusWhenPresent(pendingFocus.id, () => setPendingFocus(null), FOCUS_WAIT_MS);
  }, [pendingFocus, selected]);

  const data = resource.data;
  const product = data?.product ?? null;

  if (deleted) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading>{t("page.productDetail.title")}</PageHeading>
        <DeletedPanel t={t} title={t("products.lifecycle.deleted")} listTo={PATHS.products} />
      </div>
    );
  }

  function selectTab(tab: string) {
    const found = tabIds.find((entry) => entry === tab);
    // A dirty tab's unsaved-changes guard asks first: the switch is a change of the query string.
    if (found !== undefined) setParams(tabSearch(found, tabIds));
  }

  function goTo(problem: PublishProblem) {
    if (problem.tab === null) return;
    if (problem.focusId !== null) setPendingFocus({ tab: problem.tab, id: problem.focusId });
    if (problem.tab !== selected) selectTab(problem.tab);
  }

  async function run(action: Exclude<LifecycleAction, "delete">, target: AdminProduct) {
    // A second action in the same task (before React renders the busy buttons) sends nothing.
    const running = flight.run(() => runWrite(() => LIFECYCLE_CALLS[action](target.id)));
    if (running === null) return;
    setBusy(action);
    setFailure(null);
    let outcome;
    try {
      outcome = await running;
    } catch (bug) {
      crash(bug);
      return;
    }
    setBusy(null);
    setConfirming(null);
    switch (outcome.kind) {
      case "ok":
        if (action === "publish") setProblems([]);
        changed(NOTICE_OF[action]);
        return;
      case "problem": {
        const mapped =
          action === "publish" && outcome.status === 400
            ? mapPublishProblems(outcome.problem, {
                defaultLocale: content.defaultLocale,
                shopCurrency: config.shopCurrency,
                variants: target.variants,
              })
            : [];
        if (mapped.length > 0) {
          setProblems(mapped);
          focusAfterCommit(problemsRef);
        } else {
          setFailure(describeProblem(outcome.status, outcome.problem));
          focusAfterCommit(failureRef);
        }
        return;
      }
      case "unknown":
        changed("unknown");
        return;
      case "aborted":
        return;
    }
  }

  function onAction(action: LifecycleAction, target: AdminProduct) {
    if (LIFECYCLE_CONFIRMATION[action] === "none" && action !== "delete") void run(action, target);
    else setConfirming(action);
  }

  const tabLabel = (tab: EditorTabId) =>
    t(PRODUCT_EDITOR_TABS.find((entry) => entry.id === tab)?.messageKey ?? "products.tab.general");
  const current = tabs.find((tab) => tab.id === selected);
  const Panel = current?.Panel;

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={PATHS.products} label={t("products.backToList")} />
      <EditorNoticeBar t={t} notice={notice} innerRef={noticeRef} />
      {resource.fallback !== null || data === null || product === null ? (
        <>
          <PageHeading>{t("page.productDetail.title")}</PageHeading>
          {resource.fallback === null ? null : (
            <ResourceFallback t={t} state={resource.fallback} onRetry={reload} />
          )}
        </>
      ) : (
        <div className="flex flex-col gap-6" aria-busy={resource.refreshing || undefined}>
          <ProductSummaryView
            t={t}
            uiLocale={locale}
            content={content}
            product={product}
            productType={data.productType}
            actions={
              <LifecycleActionsView
                t={t}
                actions={permittedActions(product, permissions)}
                busy={busy}
                locked={dirtyTab(dirty) !== null}
                onAction={(action) => onAction(action, product)}
              />
            }
          />
          {failure === null ? null : (
            <div ref={failureRef} tabIndex={-1}>
              <FailureMessage t={t} descriptor={failure} />
            </div>
          )}
          <PublishProblemsView
            t={t}
            problems={problems}
            visibleTabs={tabIds}
            tabLabel={tabLabel}
            onGoTo={goTo}
            onDismiss={() => setProblems([])}
            innerRef={problemsRef}
          />
          {Panel === undefined || selected === null ? null : (
            <Tabs
              label={t("products.tabsLabel", {
                title: productTitle(product, locale, content.defaultLocale),
              })}
              tabs={tabs.map((tab) => ({ id: tab.id, label: t(tab.messageKey) }))}
              selectedId={selected}
              onChange={selectTab}
            >
              <Panel
                key={`${selected}-${productRevision(product)}`}
                product={product}
                productType={data.productType}
                content={content}
                problems={problems}
                onChanged={changed}
                onDirtyChange={reportDirty}
              />
            </Tabs>
          )}
          {confirming === "unpublish" || confirming === "archive" ? (
            <ConfirmDialog
              open
              busy={busy !== null}
              title={t(`products.lifecycle.${confirming}Title`)}
              description={t(`products.lifecycle.${confirming}Body`)}
              confirmLabel={t(`products.lifecycle.${confirming}`)}
              cancelLabel={t("dict.form.cancel")}
              onClose={() => setConfirming(null)}
              onConfirm={() => void run(confirming, product)}
            />
          ) : null}
          {confirming === "delete" ? (
            <ConfirmDelete
              t={t}
              canWrite={permittedActions(product, permissions).includes("delete")}
              open
              onClose={() => setConfirming(null)}
              remove={() => adminClient.deleteProduct(product.id)}
              onDeleted={() => {
                setConfirming(null);
                setDeleted(true);
              }}
              onUnknown={() => {
                setConfirming(null);
                changed("unknown");
              }}
              title={t("products.lifecycle.deleteTitle", {
                title: productTitle(product, locale, content.defaultLocale),
              })}
              description={t("products.lifecycle.deleteBody")}
              hint={t("products.lifecycle.deleteHint")}
              confirmLabel={t("products.lifecycle.delete")}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export function ProductDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The product route has no id parameter.");
  return (
    <ConfigGate>
      <ProductEditor key={id} id={id} />
    </ConfigGate>
  );
}
