import type { AdminAttribute, AdminAttributeWithOptions } from "@fluxkit/api-client";
import { Button, StatusBadge, type DataTableColumn } from "@fluxkit/ui";
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
import {
  attributeCreateBody,
  attributeFormFrom,
  attributePatchBody,
  emptyAttributeForm,
  validateAttributeForm,
  ATTRIBUTE_FLAGS,
  type AttributeFormValues,
} from "./attribute-form";
import { AttributeFormView } from "./attribute-form-view";
import { ConfigGate, useContentLocales } from "./config-gate";
import {
  BackLink,
  DangerZone,
  DeletedPanel,
  CreateUnknown,
  DictionaryPage,
  FocusedPanel,
  NoticeBar,
  linkClass,
  type NoticeKind,
} from "./dictionary-frame";
import { ConfirmDelete } from "./form-dialog";
import type { ContentLocales } from "./form-parts";
import { hasIssues } from "./form-rules";
import { ItemsSection } from "./items-section";
import { ListScreen } from "./list-screen";
import { localeFieldNames, resolveLocalized } from "./locale-text";
import { useCanWrite } from "./use-can-write";
import { useEditorState } from "./use-editor-state";
import { useFormSubmit } from "./use-form-submit";

const DEFAULT_LIMIT = 50;

/** The server's field names of the attribute form, for mapping `errors[].path`. */
export function attributeFieldNames(locales: readonly string[]): string[] {
  return [
    "code",
    "unit",
    "inputType",
    "isLocalized",
    ...ATTRIBUTE_FLAGS,
    ...localeFieldNames("name", locales),
    ...localeFieldNames("description", locales),
    "validation.min_length",
    "validation.max_length",
    "validation.min",
    "validation.max",
    "validation.integer",
    "validation.max_decimals",
    "validation.min_items",
    "validation.max_items",
  ];
}

// ------------------------------------------------------------------------- list

function AttributesList() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [params] = useSearchParams();
  const { limit, offset } = readPaging(params, { defaultLimit: DEFAULT_LIMIT });
  const resource = useResource(
    (signal) => adminClient.listAttributes({ limit, offset, signal }),
    [limit, offset],
  );
  const columns: DataTableColumn<AdminAttribute>[] = [
    {
      id: "code",
      header: t("dict.attribute.columnCode"),
      cell: (row) => (
        <Link to={buildPath(PATHS.attributeDetail, { id: row.id })} className={linkClass}>
          {row.code}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("dict.attribute.columnName"),
      cell: (row) => resolveLocalized(row.name, locale, content.defaultLocale),
    },
    {
      id: "inputType",
      header: t("dict.attribute.columnType"),
      cell: (row) => t(`dict.inputType.${row.inputType}`),
    },
    {
      id: "flags",
      header: t("dict.attribute.columnFlags"),
      cell: (row) => (
        <span className="inline-flex flex-wrap gap-1">
          {ATTRIBUTE_FLAGS.filter((flag) => row[flag] && flag !== "isVisibleOnStorefront").map(
            (flag) => (
              <StatusBadge
                key={flag}
                tone={flag === "isInternal" ? "warning" : "neutral"}
                label={t(`dict.attribute.flag.${flag}`)}
              />
            ),
          )}
        </span>
      ),
    },
  ];
  return (
    <ListScreen
      t={t}
      current="attributes"
      title={t("page.attributes.title")}
      state={resource}
      onRetry={resource.reload}
      canWrite={canWrite}
      createTo={pathTo("attributeNew")}
      createLabel={t("dict.attribute.new")}
      caption={t("dict.attribute.listCaption")}
      columns={columns}
      rowKey={(row) => row.id}
      emptyTitle={t("dict.attribute.emptyTitle")}
      emptyBody={t("dict.attribute.emptyBody")}
      limit={limit}
      offset={offset}
      hrefForOffset={(next) =>
        `${PATHS.attributes}${writeQuery({ limit, offset: next }, { limit: DEFAULT_LIMIT, offset: 0 })}`
      }
    />
  );
}

export function AttributesPage() {
  return (
    <ConfigGate>
      <AttributesList />
    </ConfigGate>
  );
}

// ----------------------------------------------------------------------- create

function AttributeCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => emptyAttributeForm(content.locales));
  const [values, setValues] = useState<AttributeFormValues>(initial);
  const [created, setCreated] = useState<AdminAttribute | null>(null);
  const [unknown, setUnknown] = useState(false);
  const form = useFormSubmit(attributeFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(
    !jsonEqual(initial, values) && created === null && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const issues = validateAttributeForm(values, "create", content);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createAttribute(attributeCreateBody(values, content.locales)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyAttributeForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <DictionaryPage t={t} current="attributes" title={t("page.attributeNew.title")}>
      {created !== null ? (
        <FocusedPanel title={t("dict.attribute.created", { code: created.code })}>
          <p className="flex flex-wrap gap-4">
            <Link to={buildPath(PATHS.attributeDetail, { id: created.id })} className={linkClass}>
              {t("dict.attribute.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.attributes} className={linkClass}>
              {t("dict.form.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          {unknown ? <CreateUnknown t={t} listTo={PATHS.attributes} /> : null}
          <AttributeFormView
            t={t}
            uiLocale={locale}
            content={content}
            mode="create"
            idPrefix="attribute"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canWrite={canWrite}
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.attributes}
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </DictionaryPage>
  );
}

export function AttributeNewPage() {
  return (
    <ConfigGate>
      <AttributeCreate />
    </ConfigGate>
  );
}

// ------------------------------------------------------------------------ detail

function AttributeEditForm({
  attribute,
  content,
  onChanged,
}: {
  attribute: AdminAttributeWithOptions;
  content: ContentLocales;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => attributeFormFrom(attribute, content.locales));
  const [values, setValues] = useState<AttributeFormValues>(initial);
  const form = useFormSubmit(attributeFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(!jsonEqual(initial, values) && !form.state.busy);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    const issues = validateAttributeForm(values, "edit", content);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = attributePatchBody(initial, values, content.locales);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateAttribute(attribute.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <AttributeFormView
        t={t}
        uiLocale={locale}
        content={content}
        mode="edit"
        idPrefix="attribute"
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        onSubmit={(event) => void submit(event)}
        cancelTo={PATHS.attributes}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

function AttributeEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const resource = useRefreshingResource(
    (signal) => adminClient.getAttribute(id, { signal }),
    [id],
  );
  const editor = useEditorState(resource.reload);
  const attribute = resource.data;
  const title =
    attribute === null
      ? t("page.attributeDetail.title")
      : resolveLocalized(attribute.name, locale, content.defaultLocale) || attribute.code;

  if (editor.deleted) {
    return (
      <DictionaryPage t={t} current="attributes" title={t("page.attributeDetail.title")}>
        <DeletedPanel t={t} title={t("dict.attribute.deleted")} listTo={PATHS.attributes} />
      </DictionaryPage>
    );
  }

  return (
    <DictionaryPage t={t} current="attributes" title={title}>
      <BackLink to={PATHS.attributes} label={t("dict.form.backToList")} />
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : attribute === null ? null : (
        <div className="flex flex-col gap-8" aria-busy={resource.refreshing || undefined}>
          <AttributeEditForm
            key={attribute.updatedAt}
            attribute={attribute}
            content={content}
            onChanged={editor.changed}
          />
          {attribute.inputType === "select" || attribute.inputType === "multiselect" ? (
            <ItemsSection
              t={t}
              prefix="attributeOption"
              content={content}
              uiLocale={locale}
              items={attribute.options}
              canWrite={canWrite}
              create={(body) => adminClient.createAttributeOption(attribute.id, body)}
              update={(optionId, body) =>
                adminClient.updateAttributeOption(attribute.id, optionId, body)
              }
              remove={(optionId) => adminClient.deleteAttributeOption(attribute.id, optionId)}
              onChanged={editor.changed}
            />
          ) : null}
          <DangerZone
            t={t}
            canWrite={canWrite}
            id="attribute-danger"
            info={t("dict.attribute.deleteInfo")}
            buttonLabel={t("dict.attribute.delete")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDelete
              t={t}
              canWrite={canWrite}
              open
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => adminClient.deleteAttribute(attribute.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
              title={t("dict.attribute.deleteTitle", { code: attribute.code })}
              description={t("dict.attribute.deleteBody")}
              hint={t("dict.attribute.deleteHint")}
              confirmLabel={t("dict.attribute.deleteConfirm")}
            />
          ) : null}
        </div>
      )}
    </DictionaryPage>
  );
}

export function AttributeDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The attribute route has no id parameter.");
  return (
    <ConfigGate>
      <AttributeEditor key={id} id={id} />
    </ConfigGate>
  );
}
