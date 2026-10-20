import type { AdminProductType, AdminProductTypeDetail } from "@fluxkit/api-client";
import { Button, Checkbox, StatusBadge, type DataTableColumn } from "@fluxkit/ui";
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
import { CodeNameFormView } from "./code-name-form-view";
import { ConfigGate, useContentLocales } from "./config-gate";
import {
  emptyProductTypeForm,
  productTypeCreateBody,
  productTypeFormFrom,
  productTypePatchBody,
  validateProductTypeForm,
  type ProductTypeFormValues,
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
import { AttributeAssignmentsSection, OptionAssignmentsSection } from "./product-type-assignments";
import { useCanWrite } from "./use-can-write";
import { useEditorState } from "./use-editor-state";
import { useFormSubmit } from "./use-form-submit";

const DEFAULT_LIMIT = 50;

export function productTypeFieldNames(locales: readonly string[]): string[] {
  return ["code", "requiresShipping", ...localeFieldNames("name", locales)];
}

function ProductTypesList() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [params] = useSearchParams();
  const { limit, offset } = readPaging(params, { defaultLimit: DEFAULT_LIMIT });
  const resource = useResource(
    (signal) => adminClient.listProductTypes({ limit, offset, signal }),
    [limit, offset],
  );
  const columns: DataTableColumn<AdminProductType>[] = [
    {
      id: "code",
      header: t("dict.productType.columnCode"),
      cell: (row) => (
        <Link to={buildPath(PATHS.productTypeDetail, { id: row.id })} className={linkClass}>
          {row.code}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("dict.productType.columnName"),
      cell: (row) => resolveLocalized(row.name, locale, content.defaultLocale),
    },
    {
      id: "requiresShipping",
      header: t("dict.productType.columnShipping"),
      cell: (row) => (
        <StatusBadge
          tone={row.requiresShipping ? "neutral" : "warning"}
          label={t(row.requiresShipping ? "dict.productType.shipsYes" : "dict.productType.shipsNo")}
        />
      ),
    },
  ];
  return (
    <ListScreen
      t={t}
      current="productTypes"
      title={t("page.productTypes.title")}
      state={resource}
      onRetry={resource.reload}
      canWrite={canWrite}
      createTo={pathTo("productTypeNew")}
      createLabel={t("dict.productType.new")}
      caption={t("dict.productType.listCaption")}
      columns={columns}
      rowKey={(row) => row.id}
      emptyTitle={t("dict.productType.emptyTitle")}
      emptyBody={t("dict.productType.emptyBody")}
      limit={limit}
      offset={offset}
      hrefForOffset={(next) =>
        `${PATHS.productTypes}${writeQuery({ limit, offset: next }, { limit: DEFAULT_LIMIT, offset: 0 })}`
      }
    />
  );
}

export function ProductTypesPage() {
  return (
    <ConfigGate>
      <ProductTypesList />
    </ConfigGate>
  );
}

function ShippingCheckbox({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col">
      <Checkbox
        id="productType-requiresShipping"
        name="requiresShipping"
        label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function ProductTypeCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => emptyProductTypeForm(content.locales));
  const [values, setValues] = useState<ProductTypeFormValues>(initial);
  const [created, setCreated] = useState<AdminProductType | null>(null);
  const [unknown, setUnknown] = useState(false);
  const form = useFormSubmit(productTypeFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(
    !jsonEqual(initial, values) && created === null && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const issues = validateProductTypeForm(values, "create", content);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createProductType(productTypeCreateBody(values, content.locales)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyProductTypeForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <DictionaryPage t={t} current="productTypes" title={t("page.productTypeNew.title")}>
      {created !== null ? (
        <FocusedPanel title={t("dict.productType.created", { code: created.code })}>
          <p className="flex flex-wrap gap-4">
            <Link to={buildPath(PATHS.productTypeDetail, { id: created.id })} className={linkClass}>
              {t("dict.productType.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.productTypes} className={linkClass}>
              {t("dict.form.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          {unknown ? <CreateUnknown t={t} listTo={PATHS.productTypes} /> : null}
          <CodeNameFormView
            t={t}
            uiLocale={locale}
            content={content}
            prefix="productType"
            mode="create"
            idPrefix="productType"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canWrite={canWrite}
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.productTypes}
            extra={
              <ShippingCheckbox
                checked={values.requiresShipping}
                disabled={!canWrite}
                onChange={(requiresShipping) => setValues({ ...values, requiresShipping })}
                label={t("dict.productType.requiresShipping")}
                hint={t("dict.productType.requiresShippingHint")}
              />
            }
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </DictionaryPage>
  );
}

export function ProductTypeNewPage() {
  return (
    <ConfigGate>
      <ProductTypeCreate />
    </ConfigGate>
  );
}

function ProductTypeEditForm({
  productType,
  content,
  onChanged,
}: {
  productType: AdminProductTypeDetail;
  content: ContentLocales;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => productTypeFormFrom(productType, content.locales));
  const [values, setValues] = useState<ProductTypeFormValues>(initial);
  const form = useFormSubmit(productTypeFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(!jsonEqual(initial, values) && !form.state.busy);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    const issues = validateProductTypeForm(values, "edit", content);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = productTypePatchBody(initial, values, content.locales);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateProductType(productType.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <CodeNameFormView
        t={t}
        uiLocale={locale}
        content={content}
        prefix="productType"
        mode="edit"
        idPrefix="productType"
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        onSubmit={(event) => void submit(event)}
        cancelTo={PATHS.productTypes}
        extra={
          <ShippingCheckbox
            checked={values.requiresShipping}
            disabled={!canWrite}
            onChange={(requiresShipping) => setValues({ ...values, requiresShipping })}
            label={t("dict.productType.requiresShipping")}
            hint={t("dict.productType.requiresShippingHint")}
          />
        }
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

function ProductTypeEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const resource = useRefreshingResource(
    (signal) => adminClient.getProductType(id, { signal }),
    [id],
  );
  const editor = useEditorState(resource.reload);
  const productType = resource.data;
  const title =
    productType === null
      ? t("page.productTypeDetail.title")
      : resolveLocalized(productType.name, locale, content.defaultLocale) || productType.code;

  if (editor.deleted) {
    return (
      <DictionaryPage t={t} current="productTypes" title={t("page.productTypeDetail.title")}>
        <DeletedPanel t={t} title={t("dict.productType.deleted")} listTo={PATHS.productTypes} />
      </DictionaryPage>
    );
  }

  return (
    <DictionaryPage t={t} current="productTypes" title={title}>
      <BackLink to={PATHS.productTypes} label={t("dict.form.backToList")} />
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : productType === null ? null : (
        <div className="flex flex-col gap-8" aria-busy={resource.refreshing || undefined}>
          <ProductTypeEditForm
            key={productType.updatedAt}
            productType={productType}
            content={content}
            onChanged={editor.changed}
          />
          <AttributeAssignmentsSection
            t={t}
            content={content}
            uiLocale={locale}
            productTypeId={productType.id}
            canWrite={canWrite}
            rows={productType.attributes}
            onChanged={editor.changed}
          />
          <OptionAssignmentsSection
            t={t}
            content={content}
            uiLocale={locale}
            productTypeId={productType.id}
            canWrite={canWrite}
            rows={productType.options}
            onChanged={editor.changed}
          />
          <DangerZone
            t={t}
            canWrite={canWrite}
            id="productType-danger"
            info={t("dict.productType.deleteInfo")}
            buttonLabel={t("dict.productType.delete")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDelete
              t={t}
              canWrite={canWrite}
              open
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => adminClient.deleteProductType(productType.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
              title={t("dict.productType.deleteTitle", { code: productType.code })}
              description={t("dict.productType.deleteBody")}
              hint={t("dict.productType.deleteHint")}
              confirmLabel={t("dict.productType.deleteConfirm")}
            />
          ) : null}
        </div>
      )}
    </DictionaryPage>
  );
}

export function ProductTypeDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The product type route has no id parameter.");
  return (
    <ConfigGate>
      <ProductTypeEditor key={id} id={id} />
    </ConfigGate>
  );
}
