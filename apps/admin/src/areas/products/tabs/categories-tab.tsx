import type { AdminCategory } from "@fluxkit/api-client";
import { Button, type Translator } from "@fluxkit/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import { failureFromError } from "../../../lib/failure";
import { loadByIds } from "../../../lib/load-by-ids";
import type { MessageDescriptor } from "../../../lib/problem-messages";
import { useCrash } from "../../../lib/use-crash";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { LoadingView, ResourceFallback } from "../../../views/status-views";
import { treeItems, type TreeItem } from "../../catalog-dictionaries/category-tree";
import { CategoryTreeView, TruncatedNotice } from "../../catalog-dictionaries/category-tree-view";
import {
  FormActions,
  FormErrorSummary,
  describe,
  type ContentLocales,
} from "../../catalog-dictionaries/form-parts";
import { useContentLocales } from "../../catalog-dictionaries/config-gate";
import { resolveLocalized } from "../../catalog-dictionaries/locale-text";
import { useCategoryTree } from "../../catalog-dictionaries/use-category-tree";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import {
  MAX_PRODUCT_CATEGORIES,
  addCategory,
  assignmentsDirty,
  assignmentsFrom,
  categoriesBody,
  removeCategory,
  setPrimary,
  type AssignmentState,
} from "../category-assignments";
import { CATEGORIES_FOCUS_ID } from "../field-ids";
import { shortId } from "../product-pickers";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { useCan } from "../use-can";

export interface CategoryAssignmentsViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  state: AssignmentState;
  /** Categories by id, for names; an id without one shows its short id. */
  known: ReadonlyMap<string, AdminCategory>;
  canWrite: boolean;
  onPrimary: (id: string) => void;
  onRemove: (id: string) => void;
  /** Problems of the last publish attempt and of the last save without a place of their own. */
  problems: readonly MessageDescriptor[];
}

function nameOf(
  category: AdminCategory | undefined,
  id: string,
  uiLocale: string,
  defaultLocale: string,
): string {
  if (category === undefined) return shortId(id);
  return resolveLocalized(category.name, uiLocale, defaultLocale) || category.slug;
}

/**
 * The categories of the product, in order: the primary one chosen with a radio button, each with a remove button. The
 * list is the focus target of a categories problem. Read-only (no controls) without write permission.
 */
export function CategoryAssignmentsView({
  t,
  uiLocale,
  content,
  state,
  known,
  canWrite,
  onPrimary,
  onRemove,
  problems,
}: CategoryAssignmentsViewProps) {
  return (
    <section
      id={CATEGORIES_FOCUS_ID}
      tabIndex={-1}
      aria-labelledby={`${CATEGORIES_FOCUS_ID}-heading`}
      className="flex flex-col gap-3"
    >
      <h2 id={`${CATEGORIES_FOCUS_ID}-heading`} className="text-lg font-semibold">
        {t("products.categories.assigned")}
      </h2>
      {problems.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-danger">
          {problems.map((problem, index) => (
            <li key={`${problem.key}-${index}`}>{describe(t, problem)}</li>
          ))}
        </ul>
      )}
      {state.ids.length === 0 ? (
        <p className="text-muted-foreground">{t("products.categories.none")}</p>
      ) : (
        <ul
          className="flex flex-col gap-2"
          role={canWrite ? "radiogroup" : undefined}
          aria-label={canWrite ? t("products.categories.primary") : undefined}
        >
          {state.ids.map((id) => {
            const category = known.get(id);
            const name = nameOf(category, id, uiLocale, content.defaultLocale);
            const primary = state.primaryId === id;
            return (
              <li key={id} className="flex flex-wrap items-center gap-3">
                {canWrite ? (
                  <label className="inline-flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="primaryCategoryId"
                      value={id}
                      checked={primary}
                      onChange={() => onPrimary(id)}
                      className="size-5 accent-primary"
                    />
                    <span>{name}</span>
                  </label>
                ) : (
                  <span className="font-medium">{name}</span>
                )}
                {category === undefined ? null : (
                  <span className="text-sm text-muted-foreground">{category.slug}</span>
                )}
                {primary ? (
                  <span className="text-sm text-muted-foreground">
                    {t("products.categories.primaryMark")}
                  </span>
                ) : null}
                {canWrite ? (
                  <Button
                    variant="secondary"
                    aria-label={t("products.categories.removeLabel", { name })}
                    onClick={() => onRemove(id)}
                  >
                    {t("products.categories.remove")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The assigned categories' data: what the tree loaded, plus one read per other assigned id (at most six at a time). */
function useAssignedCategories(ids: readonly string[]): {
  known: Map<string, AdminCategory>;
  remember: (category: AdminCategory) => void;
} {
  const [known, setKnown] = useState<Map<string, AdminCategory>>(() => new Map());
  const knownRef = useRef(known);
  knownRef.current = known;
  const crash = useCrash();
  const missing = ids.filter((id) => !known.has(id));
  const key = missing.join(",");
  useEffect(() => {
    if (key === "") return undefined;
    const controller = new AbortController();
    loadByIds(key.split(","), (id) =>
      adminClient.getCategory(id, { signal: controller.signal }),
    ).then(
      (found) => {
        if (!controller.signal.aborted) setKnown(new Map([...knownRef.current, ...found]));
      },
      (error: unknown) => {
        // A lost answer only costs the names (short ids stay); a bug goes to the boundary.
        try {
          failureFromError(error);
        } catch (bug) {
          crash(bug);
        }
      },
    );
    return () => controller.abort();
  }, [key, crash]);
  return {
    known,
    remember: (category) => {
      if (!knownRef.current.has(category.id)) {
        setKnown(new Map([...knownRef.current, [category.id, category]]));
      }
    },
  };
}

/** The lazy category tree with an "Add" button per category (already assigned ones are marked, not hidden). */
function CategoryPicker({
  state,
  onAdd,
}: {
  state: AssignmentState;
  onAdd: (category: AdminCategory) => void;
}) {
  const { t, locale } = useI18n();
  const data = useCategoryTree();
  const full = state.ids.length >= MAX_PRODUCT_CATEGORIES;
  const content = useContentLocales();
  return (
    <section aria-labelledby="product-category-picker" className="flex flex-col gap-3">
      <h2 id="product-category-picker" className="text-lg font-semibold">
        {t("products.categories.add")}
      </h2>
      {full ? (
        <p className="text-muted-foreground">
          {t("products.categories.limit", { max: MAX_PRODUCT_CATEGORIES })}
        </p>
      ) : null}
      {data.tree.roots.status === "loading" ? (
        <LoadingView t={t} />
      ) : data.tree.roots.status === "error" ? (
        <ResourceFallback
          t={t}
          state={data.rootsFailure ?? { status: "loading" }}
          onRetry={data.retryRoots}
        />
      ) : (
        <>
          {data.tree.roots.truncated ? <TruncatedNotice t={t} scanned={data.scanned} /> : null}
          {data.tree.roots.ids.length === 0 ? (
            <p className="text-muted-foreground">{t("dict.category.emptyBody")}</p>
          ) : (
            <CategoryTreeView
              t={t}
              uiLocale={locale}
              content={content}
              items={treeItems(data.tree)}
              canWrite={false}
              mode="pick"
              label={t("products.categories.treeLabel")}
              idPrefix="product-category-tree"
              onToggle={data.toggle}
              onLoadMore={data.loadMore}
              onRetryChildren={data.retryChildren}
              renderActions={(item: TreeItem, name: string) =>
                state.ids.includes(item.category.id) ? (
                  <span className="text-sm text-muted-foreground">
                    {t("products.categories.alreadyAssigned")}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={full}
                    aria-label={t("products.categories.addLabel", { name })}
                    onClick={() => onAdd(item.category)}
                  >
                    {t("products.categories.addOne")}
                  </Button>
                )
              }
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Categories: the product's categories with the primary one, a lazy tree to add more, remove, and save the whole set
 * with `PUT /admin/products/{id}/categories`. Never optimistic: the editor reloads the product after the save.
 */
export function CategoriesTab({
  product,
  content,
  problems,
  onChanged,
  onDirtyChange,
}: ProductTabProps) {
  const { t, locale } = useI18n();
  const canWrite = useCan("putProductCategories");
  const [initial, setInitial] = useState(() => assignmentsFrom(product.categories));
  const [state, setState] = useState<AssignmentState>(initial);
  const { known, remember } = useAssignedCategories(state.ids);
  const form = useFormSubmit(["categories", "primaryCategoryId"]);
  const dirty = assignmentsDirty(initial, state) && !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);
  const fieldProblems = [
    ...problems.filter((entry) => entry.tab === "categories").map((entry) => entry.message),
    ...Object.values(form.state.fieldErrors).filter(
      (entry): entry is MessageDescriptor => entry !== undefined,
    ),
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    if (!assignmentsDirty(initial, state)) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.putProductCategories(product.id, categoriesBody(state)),
    );
    if (outcome.kind === "ok") {
      setInitial(state);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <div className="flex flex-col gap-8">
      <form method="post" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <FormErrorSummary t={t} summary={form.state.summary} summaryRef={form.summaryRef} />
        <CategoryAssignmentsView
          t={t}
          uiLocale={locale}
          content={content}
          state={state}
          known={known}
          canWrite={canWrite}
          onPrimary={(id) => setState(setPrimary(state, id))}
          onRemove={(id) => setState(removeCategory(state, id))}
          problems={fieldProblems}
        />
        {canWrite ? (
          <FormActions
            t={t}
            busy={form.state.busy}
            submitLabel={t("products.categories.save")}
            busyLabel={t("products.form.saving")}
          />
        ) : null}
      </form>
      {canWrite ? (
        <CategoryPicker
          state={state}
          onAdd={(category) => {
            remember(category);
            setState(addCategory(state, category.id));
          }}
        />
      ) : null}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
