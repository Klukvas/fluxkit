import type { AdminBrand } from "@fluxkit/api-client";
import { Button, type DataTableColumn } from "@fluxkit/ui";
import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { jsonEqual } from "../../lib/diff-for-patch";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { useResource } from "../../lib/use-resource";
import { PATHS, buildPath, pathTo } from "../../router/paths";
import { readPaging, writeQuery } from "../../router/query";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { ResourceFallback } from "../../views/status-views";
import { BrandFormView } from "./brand-form-view";
import { useBrandLogoUpload } from "./brand-logo-upload";
import { ConfigGate, useContentLocales } from "./config-gate";
import {
  brandCreateBody,
  brandFormFrom,
  brandPatchBody,
  emptyBrandForm,
  validateBrandForm,
  type BrandFormValues,
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
  type NoticeKind,
} from "./dictionary-frame";
import { ConfirmDelete } from "./form-dialog";
import type { ContentLocales } from "./form-parts";
import { hasIssues } from "./form-rules";
import { ListScreen } from "./list-screen";
import { localeFieldNames, resolveLocalized } from "./locale-text";
import { useCanWrite } from "./use-can-write";
import { useEditorState } from "./use-editor-state";
import { useFormSubmit } from "./use-form-submit";

const DEFAULT_LIMIT = 50;

export function brandFieldNames(locales: readonly string[]): string[] {
  return [
    "slug",
    "logoUrl",
    ...localeFieldNames("name", locales),
    ...localeFieldNames("description", locales),
  ];
}

function BrandsList() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [params] = useSearchParams();
  const { limit, offset } = readPaging(params, { defaultLimit: DEFAULT_LIMIT });
  const resource = useResource(
    (signal) => adminClient.listBrands({ limit, offset, signal }),
    [limit, offset],
  );
  const columns: DataTableColumn<AdminBrand>[] = [
    {
      id: "slug",
      header: t("dict.brand.columnSlug"),
      cell: (row) => (
        <Link to={buildPath(PATHS.brandDetail, { id: row.id })} className={linkClass}>
          {row.slug}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("dict.brand.columnName"),
      cell: (row) => resolveLocalized(row.name, locale, content.defaultLocale),
    },
  ];
  return (
    <ListScreen
      t={t}
      current="brands"
      title={t("page.brands.title")}
      state={resource}
      onRetry={resource.reload}
      canWrite={canWrite}
      createTo={pathTo("brandNew")}
      createLabel={t("dict.brand.new")}
      caption={t("dict.brand.listCaption")}
      columns={columns}
      rowKey={(row) => row.id}
      emptyTitle={t("dict.brand.emptyTitle")}
      emptyBody={t("dict.brand.emptyBody")}
      limit={limit}
      offset={offset}
      hrefForOffset={(next) =>
        `${PATHS.brands}${writeQuery({ limit, offset: next }, { limit: DEFAULT_LIMIT, offset: 0 })}`
      }
    />
  );
}

export function BrandsPage() {
  return (
    <ConfigGate>
      <BrandsList />
    </ConfigGate>
  );
}

function BrandCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => emptyBrandForm(content.locales));
  const [values, setValues] = useState<BrandFormValues>(initial);
  const [created, setCreated] = useState<AdminBrand | null>(null);
  const [unknown, setUnknown] = useState(false);
  const form = useFormSubmit(brandFieldNames(content.locales));
  const logo = useBrandLogoUpload((logoUrl) => setValues((current) => ({ ...current, logoUrl })));
  const blocker = useUnsavedChangesGuard(
    (!jsonEqual(initial, values) || logo.controls.running) && created === null && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A save must not race the logo that is still uploading.
    if (form.state.busy || logo.controls.running) return;
    const issues = validateBrandForm(values, content, "create");
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createBrand(brandCreateBody(values, content.locales)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyBrandForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <DictionaryPage t={t} current="brands" title={t("page.brandNew.title")}>
      {created !== null ? (
        <FocusedPanel
          title={t("dict.brand.created", {
            name: resolveLocalized(created.name, locale, content.defaultLocale) || created.slug,
          })}
        >
          <p className="flex flex-wrap gap-4">
            <Link to={buildPath(PATHS.brandDetail, { id: created.id })} className={linkClass}>
              {t("dict.brand.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.brands} className={linkClass}>
              {t("dict.form.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          {unknown ? <CreateUnknown t={t} listTo={PATHS.brands} /> : null}
          <BrandFormView
            t={t}
            uiLocale={locale}
            content={content}
            mode="create"
            idPrefix="brand"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canWrite={canWrite}
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.brands}
            logoAlt={t("dict.brand.logoAlt", {
              name: values.name[content.defaultLocale]?.trim() ?? "",
            })}
            uploadsEnabled={logo.uploadsEnabled}
            upload={logo.controls}
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </DictionaryPage>
  );
}

export function BrandNewPage() {
  return (
    <ConfigGate>
      <BrandCreate />
    </ConfigGate>
  );
}

function BrandEditForm({
  brand,
  content,
  onChanged,
}: {
  brand: AdminBrand;
  content: ContentLocales;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => brandFormFrom(brand, content.locales));
  const [values, setValues] = useState<BrandFormValues>(initial);
  const form = useFormSubmit(brandFieldNames(content.locales));
  const logo = useBrandLogoUpload((logoUrl) => setValues((current) => ({ ...current, logoUrl })));
  const blocker = useUnsavedChangesGuard(
    (!jsonEqual(initial, values) || logo.controls.running) && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A save must not race the logo that is still uploading.
    if (form.state.busy || !canWrite || logo.controls.running) return;
    const issues = validateBrandForm(values, content, "edit");
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = brandPatchBody(initial, values, content.locales);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateBrand(brand.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <BrandFormView
        t={t}
        uiLocale={locale}
        content={content}
        mode="edit"
        idPrefix="brand"
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        onSubmit={(event) => void submit(event)}
        cancelTo={PATHS.brands}
        logoAlt={t("dict.brand.logoAlt", {
          name: resolveLocalized(brand.name, locale, content.defaultLocale) || brand.slug,
        })}
        uploadsEnabled={logo.uploadsEnabled}
        upload={logo.controls}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

function BrandEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const resource = useRefreshingResource((signal) => adminClient.getBrand(id, { signal }), [id]);
  const editor = useEditorState(resource.reload);
  const brand = resource.data;
  const title =
    brand === null
      ? t("page.brandDetail.title")
      : resolveLocalized(brand.name, locale, content.defaultLocale) || brand.slug;

  if (editor.deleted) {
    return (
      <DictionaryPage t={t} current="brands" title={t("page.brandDetail.title")}>
        <DeletedPanel t={t} title={t("dict.brand.deleted")} listTo={PATHS.brands} />
      </DictionaryPage>
    );
  }

  return (
    <DictionaryPage t={t} current="brands" title={title}>
      <BackLink to={PATHS.brands} label={t("dict.form.backToList")} />
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : brand === null ? null : (
        <div className="flex flex-col gap-8" aria-busy={resource.refreshing || undefined}>
          <BrandEditForm
            key={brand.updatedAt}
            brand={brand}
            content={content}
            onChanged={editor.changed}
          />
          <DangerZone
            t={t}
            canWrite={canWrite}
            id="brand-danger"
            info={t("dict.brand.deleteInfo")}
            buttonLabel={t("dict.brand.delete")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDelete
              t={t}
              canWrite={canWrite}
              open
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => adminClient.deleteBrand(brand.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
              title={t("dict.brand.deleteTitle", { slug: brand.slug })}
              description={t("dict.brand.deleteBody")}
              hint={t("dict.brand.deleteHint")}
              confirmLabel={t("dict.brand.deleteConfirm")}
            />
          ) : null}
        </div>
      )}
    </DictionaryPage>
  );
}

export function BrandDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The brand route has no id parameter.");
  return (
    <ConfigGate>
      <BrandEditor key={id} id={id} />
    </ConfigGate>
  );
}
