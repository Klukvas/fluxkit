import type { AdminProduct, AdminProductTypeDetail } from "@fluxkit/api-client";
import { Button, DescriptionList, StatusBadge, type Translator } from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { formatDateTime } from "../../lib/format";
import { PageHeading } from "../../views/status-views";
import { describe, type ContentLocales } from "../catalog-dictionaries/form-parts";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";
import type { LifecycleAction } from "./lifecycle";
import { STATUS_TONES, statusLabelKey } from "./product-status";
import type { EditorTabId, PublishProblem } from "./publish-problems";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Where a publish problem sits, in words: the variant's row (1-based) and SKU, and the attribute. */
export function problemPlace(t: Translator, problem: PublishProblem): string | null {
  const parts: string[] = [];
  if (problem.variantIndex !== undefined) {
    parts.push(
      problem.variantSku === undefined
        ? t("products.problems.variantRowNoSku", { row: problem.variantIndex + 1 })
        : t("products.problems.variantRow", {
            row: problem.variantIndex + 1,
            sku: problem.variantSku,
          }),
    );
  }
  if (problem.attributeCode !== undefined) {
    parts.push(t("products.problems.attribute", { code: problem.attributeCode }));
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * The publish problems that belong to one tab, listed at the top of that tab (a focus target for problems that have no
 * field of their own, such as a variant that no longer exists or a problem of the whole list).
 */
export function TabProblemsView({
  t,
  id,
  problems,
}: {
  t: Translator;
  id: string;
  problems: readonly PublishProblem[];
}) {
  if (problems.length === 0) return null;
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-heading`}
      className={`flex flex-col gap-2 rounded-md border border-danger p-4 ${focusClass}`}
    >
      <h2 id={`${id}-heading`} className="font-semibold">
        {t("products.problems.onTab")}
      </h2>
      <ul className="flex flex-col gap-1">
        {problems.map((problem, index) => {
          const place = problemPlace(t, problem);
          return (
            <li key={`${problem.path}-${index}`}>
              {place === null ? null : <span className="font-medium">{place}: </span>}
              {describe(t, problem.message)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The editor's title: the product's title in the UI language (with fallback), else its slug. */
export function productTitle(
  product: AdminProduct,
  uiLocale: string,
  defaultLocale: string,
): string {
  return resolveLocalized(product.title, uiLocale, defaultLocale) || product.slug;
}

/** The summary above the tabs: title (the page's one `h1`), status as text, type, slug, dates, and the actions. */
export function ProductSummaryView({
  t,
  uiLocale,
  content,
  product,
  productType,
  actions,
}: {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  product: AdminProduct;
  productType: AdminProductTypeDetail;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PageHeading>{productTitle(product, uiLocale, content.defaultLocale)}</PageHeading>
        <StatusBadge
          tone={STATUS_TONES[product.status]}
          label={t(statusLabelKey(product.status))}
        />
      </div>
      <DescriptionList
        items={[
          {
            id: "type",
            term: t("products.summary.type"),
            description: t("products.form.productTypeChoice", {
              name:
                resolveLocalized(productType.name, uiLocale, content.defaultLocale) ||
                productType.code,
              code: productType.code,
            }),
          },
          { id: "slug", term: t("products.summary.slug"), description: product.slug },
          {
            id: "updated",
            term: t("products.summary.updated"),
            description: formatDateTime(product.updatedAt, uiLocale),
          },
          {
            id: "published",
            term: t("products.summary.published"),
            description:
              product.publishedAt === null
                ? t("products.summary.neverPublished")
                : formatDateTime(product.publishedAt, uiLocale),
          },
        ]}
      />
      {actions}
    </div>
  );
}

/**
 * The lifecycle buttons the session may use for the product's status. While a tab has unsaved changes they are disabled
 * (an action reloads the product, which would drop the input) and a line says why.
 */
export function LifecycleActionsView({
  t,
  actions,
  busy,
  locked,
  onAction,
}: {
  t: Translator;
  actions: readonly LifecycleAction[];
  busy: LifecycleAction | null;
  locked: boolean;
  onAction: (action: LifecycleAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t("products.lifecycle.label")} className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <Button
            key={action}
            variant={
              action === "publish" ? "primary" : action === "delete" ? "danger" : "secondary"
            }
            disabled={busy !== null || locked}
            aria-busy={busy === action || undefined}
            onClick={() => onAction(action)}
          >
            {busy === action ? t("products.lifecycle.running") : t(`products.lifecycle.${action}`)}
          </Button>
        ))}
      </div>
      {locked ? (
        <p className="text-sm text-muted-foreground">{t("products.lifecycle.locked")}</p>
      ) : null}
    </div>
  );
}

/**
 * Why the last publish was refused: one line per problem, with a button that opens the tab that owns it and focuses the
 * field (a variant problem names the variant's row and SKU). Focusable, so the focus moves here after the refusal.
 */
export function PublishProblemsView({
  t,
  problems,
  visibleTabs,
  tabLabel,
  onGoTo,
  onDismiss,
  innerRef,
}: {
  t: Translator;
  problems: readonly PublishProblem[];
  visibleTabs: readonly EditorTabId[];
  tabLabel: (tab: EditorTabId) => string;
  onGoTo: (problem: PublishProblem) => void;
  onDismiss: () => void;
  innerRef?: Ref<HTMLDivElement>;
}) {
  if (problems.length === 0) return null;
  return (
    <div
      ref={innerRef}
      tabIndex={-1}
      role="alert"
      className={`flex flex-col gap-3 rounded-md border border-danger p-4 ${focusClass}`}
    >
      <p className="font-semibold">{t("products.problems.title")}</p>
      <ul className="flex flex-col gap-2">
        {problems.map((problem, index) => {
          const place = problemPlace(t, problem);
          const canGo = problem.tab !== null && visibleTabs.includes(problem.tab);
          return (
            <li key={`${problem.path}-${index}`} className="flex flex-wrap items-center gap-3">
              <span>
                {place === null ? null : <span className="font-medium">{place}: </span>}
                {describe(t, problem.message)}
                {problem.message.code === undefined ? null : (
                  <small className="ms-2 text-muted-foreground">
                    {t("errors.reference", { code: problem.message.code })}
                  </small>
                )}
              </span>
              {canGo && problem.tab !== null ? (
                <Button variant="secondary" onClick={() => onGoTo(problem)}>
                  {t("products.problems.goTo", { tab: tabLabel(problem.tab) })}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div>
        <Button variant="secondary" onClick={onDismiss}>
          {t("products.problems.dismiss")}
        </Button>
      </div>
    </div>
  );
}
