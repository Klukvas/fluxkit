import type { AdminCategory } from "@fluxkit/api-client";
import { Button, ConfirmDialog } from "@fluxkit/ui";
import { useId, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { jsonEqual } from "../../lib/diff-for-patch";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { useResource } from "../../lib/use-resource";
import { PATHS, buildPath, pathTo } from "../../router/paths";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { LoadingView, ResourceFallback } from "../../views/status-views";
import { CategoryFormView } from "./category-form-view";
import { treeItems } from "./category-tree";
import { CategoryTreeView, TruncatedNotice } from "./category-tree-view";
import { ConfigGate, useContentLocales } from "./config-gate";
import {
  categoryCreateBody,
  categoryFormFrom,
  categoryPatchBody,
  emptyCategoryForm,
  moveCategoryBody,
  validateCategoryForm,
  validateMoveForm,
  type CategoryFormValues,
  type MoveFormValues,
} from "./dictionary-forms";
import {
  BackLink,
  CreateUnknown,
  DangerZone,
  DeletedPanel,
  DictionaryPage,
  FocusedPanel,
  NoticeBar,
  linkClass,
  primaryLinkClass,
  type NoticeKind,
} from "./dictionary-frame";
import { ConfirmDelete } from "./form-dialog";
import { FormErrorSummary, TextField, type ContentLocales } from "./form-parts";
import { hasIssues } from "./form-rules";
import { localeFieldNames, resolveLocalized } from "./locale-text";
import { ServerPicker } from "./server-picker";
import { useCanWrite } from "./use-can-write";
import { useCategoryTree } from "./use-category-tree";
import { useEditorState } from "./use-editor-state";
import { useFormSubmit } from "./use-form-submit";

export function categoryFieldNames(locales: readonly string[]): string[] {
  return [
    "slug",
    "isActive",
    "parentId",
    ...localeFieldNames("name", locales),
    ...localeFieldNames("description", locales),
  ];
}

// ------------------------------------------------------------------------- tree

function CategoryTree() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const { tree, scanned, rootsFailure, retryRoots, toggle, retryChildren, loadMore } =
    useCategoryTree();

  const createLink = canWrite ? (
    <Link to={pathTo("categoryNew")} className={primaryLinkClass}>
      {t("dict.category.new")}
    </Link>
  ) : null;

  return (
    <DictionaryPage
      t={t}
      current="categories"
      title={t("page.categories.title")}
      actions={createLink}
    >
      {tree.roots.status === "loading" ? (
        <LoadingView t={t} />
      ) : tree.roots.status === "error" ? (
        <ResourceFallback
          t={t}
          state={rootsFailure ?? { status: "loading" }}
          onRetry={retryRoots}
        />
      ) : (
        <>
          {tree.roots.truncated ? <TruncatedNotice t={t} scanned={scanned} /> : null}
          {tree.roots.ids.length === 0 ? (
            <p className="text-muted-foreground">{t("dict.category.emptyBody")}</p>
          ) : (
            <CategoryTreeView
              t={t}
              uiLocale={locale}
              content={content}
              items={treeItems(tree)}
              canWrite={canWrite}
              onToggle={toggle}
              onLoadMore={loadMore}
              onRetryChildren={retryChildren}
            />
          )}
        </>
      )}
    </DictionaryPage>
  );
}

export function CategoriesPage() {
  return (
    <ConfigGate>
      <CategoryTree />
    </ConfigGate>
  );
}

// ----------------------------------------------------------------------- create

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function CategoryCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [params] = useSearchParams();
  const requested = params.get("parentId");
  const parentId = requested !== null && UUID.test(requested) ? requested : null;
  const parent = useResource(
    (signal) =>
      parentId === null
        ? Promise.resolve({ ok: true as const, status: 200, data: null })
        : adminClient.getCategory(parentId, { signal }),
    [parentId],
  );
  const [initial, setInitial] = useState(() => emptyCategoryForm(content.locales, parentId));
  const [values, setValues] = useState<CategoryFormValues>(initial);
  const [created, setCreated] = useState<AdminCategory | null>(null);
  const [unknown, setUnknown] = useState(false);
  const form = useFormSubmit(categoryFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(
    !jsonEqual(initial, values) && created === null && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const issues = validateCategoryForm(values, content);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createCategory(categoryCreateBody(values, content.locales)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyCategoryForm(content.locales, parentId);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  const parentName =
    parentId === null
      ? t("dict.category.rootLevel")
      : parent.status === "ready" && parent.data !== null
        ? resolveLocalized(parent.data.name, locale, content.defaultLocale) || parent.data.slug
        : t("status.loading");

  return (
    <DictionaryPage t={t} current="categories" title={t("page.categoryNew.title")}>
      {parentId !== null && (parent.status === "notFound" || parent.status === "error") ? (
        <ResourceFallback t={t} state={parent} onRetry={parent.reload} />
      ) : created !== null ? (
        <FocusedPanel
          title={t("dict.category.created", {
            name: resolveLocalized(created.name, locale, content.defaultLocale) || created.slug,
          })}
        >
          <p className="flex flex-wrap gap-4">
            <Link to={buildPath(PATHS.categoryDetail, { id: created.id })} className={linkClass}>
              {t("dict.category.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.categories} className={linkClass}>
              {t("dict.category.backToTree")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          {unknown ? <CreateUnknown t={t} listTo={PATHS.categories} /> : null}
          <CategoryFormView
            t={t}
            uiLocale={locale}
            content={content}
            mode="create"
            idPrefix="category"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canWrite={canWrite}
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.categories}
            parentLabel={parentName}
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </DictionaryPage>
  );
}

export function CategoryNewPage() {
  return (
    <ConfigGate>
      <CategoryCreate />
    </ConfigGate>
  );
}

// ------------------------------------------------------------------------ detail

function CategoryEditForm({
  category,
  content,
  parentLabel,
  onChanged,
}: {
  category: AdminCategory;
  content: ContentLocales;
  parentLabel: string;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => categoryFormFrom(category, content.locales));
  const [values, setValues] = useState<CategoryFormValues>(initial);
  const form = useFormSubmit(categoryFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(!jsonEqual(initial, values) && !form.state.busy);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    const issues = validateCategoryForm(values, content, "edit");
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = categoryPatchBody(initial, values, content.locales);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateCategory(category.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <CategoryFormView
        t={t}
        uiLocale={locale}
        content={content}
        mode="edit"
        idPrefix="category"
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        onSubmit={(event) => void submit(event)}
        cancelTo={PATHS.categories}
        parentLabel={parentLabel}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

/** The parent's name for the edit form: loaded on its own (a failed load shows the id, the form still works). */
function useParentLabel(
  category: AdminCategory | null,
  content: ContentLocales,
  uiLocale: string,
  rootLabel: string,
): string {
  const parentId = category?.parentId ?? null;
  const parent = useResource(
    (signal) =>
      parentId === null
        ? Promise.resolve({ ok: true as const, status: 200, data: null })
        : adminClient.getCategory(parentId, { signal }),
    [parentId],
  );
  if (parentId === null) return rootLabel;
  if (parent.status === "ready" && parent.data !== null) {
    return resolveLocalized(parent.data.name, uiLocale, content.defaultLocale) || parent.data.slug;
  }
  return parentId;
}

/**
 * Moves a category under another parent (or to the root level) at a position among its siblings. The parent is chosen from
 * the server's flat list, 100 at a time; the API refuses a move under itself or a descendant and a tree deeper than five
 * levels, and says so. Asks for a confirmation: the subcategories move with it.
 */
function MoveSection({
  category,
  content,
  onChanged,
}: {
  category: AdminCategory;
  content: ContentLocales;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const formId = useId();
  const [values, setValues] = useState<MoveFormValues>({
    parentId: category.parentId ?? "",
    position: "",
  });
  const [confirming, setConfirming] = useState(false);
  const form = useFormSubmit(["parentId", "position"]);

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const issues = validateMoveForm(values);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    form.clear();
    setConfirming(true);
  }

  async function confirm() {
    const outcome = await form.submit(() =>
      adminClient.moveCategory(category.id, moveCategoryBody(values)),
    );
    if (outcome.kind === "ok") {
      setConfirming(false);
      onChanged("moved");
    } else if (outcome.kind === "unknown") {
      setConfirming(false);
      onChanged("unknown");
    } else if (outcome.kind === "problem") setConfirming(false);
  }

  return (
    <section aria-labelledby={`${formId}-heading`} className="flex flex-col gap-3">
      <h2 id={`${formId}-heading`} className="text-lg font-semibold">
        {t("dict.category.moveHeading")}
      </h2>
      <p className="text-muted-foreground">{t("dict.category.moveInfo")}</p>
      <form method="post" onSubmit={ask} className="flex max-w-2xl flex-col gap-4">
        <FormErrorSummary t={t} summary={form.state.summary} summaryRef={form.summaryRef} />
        <ServerPicker
          t={t}
          id={`${formId}-parent`}
          name="parentId"
          label={t("dict.category.moveTo")}
          value={values.parentId}
          emptyChoiceLabel={t("dict.category.rootLevel")}
          error={form.state.fieldErrors["parentId"]}
          onChange={(parentId) => setValues((current) => ({ ...current, parentId }))}
          fetchPage={(offset, limit, signal) =>
            adminClient.listCategories({ offset, limit, signal })
          }
          keyOf={(item) => item.id}
          labelOf={(item) =>
            `${resolveLocalized(item.name, locale, content.defaultLocale) || item.slug} (${item.slug})`
          }
          disabledReason={(item) =>
            item.id === category.id ? t("dict.category.thisCategory") : null
          }
        />
        <TextField
          t={t}
          id={`${formId}-position`}
          name="position"
          label={t("dict.category.movePosition")}
          hint={t("dict.category.movePositionHint")}
          value={values.position}
          inputMode="numeric"
          error={form.state.fieldErrors["position"]}
          onChange={(position) => setValues((current) => ({ ...current, position }))}
        />
        <div>
          <Button type="submit" variant="secondary" disabled={form.state.busy}>
            {t("dict.category.move")}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        busy={form.state.busy}
        title={t("dict.category.moveTitle")}
        description={t("dict.category.moveBody")}
        confirmLabel={t("dict.category.moveConfirm")}
        cancelLabel={t("dict.form.cancel")}
        onClose={() => setConfirming(false)}
        onConfirm={() => void confirm()}
      />
    </section>
  );
}

function CategoryEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const resource = useRefreshingResource((signal) => adminClient.getCategory(id, { signal }), [id]);
  const editor = useEditorState(resource.reload);
  const category = resource.data;
  const parentLabel = useParentLabel(category, content, locale, t("dict.category.rootLevel"));
  const title =
    category === null
      ? t("page.categoryDetail.title")
      : resolveLocalized(category.name, locale, content.defaultLocale) || category.slug;

  if (editor.deleted) {
    return (
      <DictionaryPage t={t} current="categories" title={t("page.categoryDetail.title")}>
        <DeletedPanel t={t} title={t("dict.category.deleted")} listTo={PATHS.categories} />
      </DictionaryPage>
    );
  }

  return (
    <DictionaryPage t={t} current="categories" title={title}>
      <BackLink to={PATHS.categories} label={t("dict.category.backToTree")} />
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : category === null ? null : (
        <div className="flex flex-col gap-8" aria-busy={resource.refreshing || undefined}>
          <CategoryEditForm
            key={category.updatedAt}
            category={category}
            content={content}
            parentLabel={parentLabel}
            onChanged={editor.changed}
          />
          {canWrite ? (
            <MoveSection
              key={`${category.updatedAt}-${category.parentId ?? "root"}-${category.position}`}
              category={category}
              content={content}
              onChanged={editor.changed}
            />
          ) : null}
          <DangerZone
            t={t}
            canWrite={canWrite}
            id="category-danger"
            info={t("dict.category.deleteInfo")}
            buttonLabel={t("dict.category.delete")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDelete
              t={t}
              canWrite={canWrite}
              open
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => adminClient.deleteCategory(category.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
              title={t("dict.category.deleteTitle", { slug: category.slug })}
              description={t("dict.category.deleteBody")}
              hint={t("dict.category.deleteHint")}
              confirmLabel={t("dict.category.deleteConfirm")}
            />
          ) : null}
        </div>
      )}
    </DictionaryPage>
  );
}

export function CategoryDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The category route has no id parameter.");
  return (
    <ConfigGate>
      <CategoryEditor key={id} id={id} />
    </ConfigGate>
  );
}
