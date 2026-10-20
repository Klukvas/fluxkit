import type { AdminOption, AdminOptionWithValues } from "@fluxkit/api-client";
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
import { useSession } from "../../session/session-context";
import { ResourceFallback } from "../../views/status-views";
import { CodeNameFormView } from "./code-name-form-view";
import { ConfigGate, useContentLocales } from "./config-gate";
import {
  emptyOptionForm,
  optionCreateBody,
  optionFormFrom,
  optionPatchBody,
  validateOptionForm,
  type OptionFormValues,
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
import { canWriteDictionaries } from "./dictionary-permissions";
import { ConfirmDelete } from "./form-dialog";
import type { ContentLocales } from "./form-parts";
import { hasIssues } from "./form-rules";
import { ItemsSection } from "./items-section";
import { ListScreen } from "./list-screen";
import { localeFieldNames, resolveLocalized } from "./locale-text";
import { useEditorState } from "./use-editor-state";
import { useFormSubmit } from "./use-form-submit";

const DEFAULT_LIMIT = 50;

export function optionFieldNames(locales: readonly string[]): string[] {
  return ["code", ...localeFieldNames("name", locales)];
}

function useCanWrite(): boolean {
  const session = useSession();
  return canWriteDictionaries(session.state.me?.permissions ?? null);
}

function OptionsList() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [params] = useSearchParams();
  const { limit, offset } = readPaging(params, { defaultLimit: DEFAULT_LIMIT });
  const resource = useResource(
    (signal) => adminClient.listOptions({ limit, offset, signal }),
    [limit, offset],
  );
  const columns: DataTableColumn<AdminOption>[] = [
    {
      id: "code",
      header: t("dict.option.columnCode"),
      cell: (row) => (
        <Link to={buildPath(PATHS.optionDetail, { id: row.id })} className={linkClass}>
          {row.code}
        </Link>
      ),
    },
    {
      id: "name",
      header: t("dict.option.columnName"),
      cell: (row) => resolveLocalized(row.name, locale, content.defaultLocale),
    },
  ];
  return (
    <ListScreen
      t={t}
      current="options"
      title={t("page.options.title")}
      state={resource}
      onRetry={resource.reload}
      canWrite={canWrite}
      createTo={pathTo("optionNew")}
      createLabel={t("dict.option.new")}
      caption={t("dict.option.listCaption")}
      columns={columns}
      rowKey={(row) => row.id}
      emptyTitle={t("dict.option.emptyTitle")}
      emptyBody={t("dict.option.emptyBody")}
      limit={limit}
      offset={offset}
      hrefForOffset={(next) =>
        `${PATHS.options}${writeQuery({ limit, offset: next }, { limit: DEFAULT_LIMIT, offset: 0 })}`
      }
    />
  );
}

export function OptionsPage() {
  return (
    <ConfigGate>
      <OptionsList />
    </ConfigGate>
  );
}

function OptionCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => emptyOptionForm(content.locales));
  const [values, setValues] = useState<OptionFormValues>(initial);
  const [created, setCreated] = useState<AdminOption | null>(null);
  const [unknown, setUnknown] = useState(false);
  const form = useFormSubmit(optionFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(
    !jsonEqual(initial, values) && created === null && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const issues = validateOptionForm(values, "create", content);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createOption(optionCreateBody(values, content.locales)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyOptionForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <DictionaryPage t={t} current="options" title={t("page.optionNew.title")}>
      {created !== null ? (
        <FocusedPanel title={t("dict.option.created", { code: created.code })}>
          <p className="flex flex-wrap gap-4">
            <Link to={buildPath(PATHS.optionDetail, { id: created.id })} className={linkClass}>
              {t("dict.option.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.options} className={linkClass}>
              {t("dict.form.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          {unknown ? <CreateUnknown t={t} listTo={PATHS.options} /> : null}
          <CodeNameFormView
            t={t}
            uiLocale={locale}
            content={content}
            prefix="option"
            mode="create"
            idPrefix="option"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canWrite={canWrite}
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.options}
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </DictionaryPage>
  );
}

export function OptionNewPage() {
  return (
    <ConfigGate>
      <OptionCreate />
    </ConfigGate>
  );
}

function OptionEditForm({
  option,
  content,
  onChanged,
}: {
  option: AdminOptionWithValues;
  content: ContentLocales;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const canWrite = useCanWrite();
  const [initial, setInitial] = useState(() => optionFormFrom(option, content.locales));
  const [values, setValues] = useState<OptionFormValues>(initial);
  const form = useFormSubmit(optionFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(!jsonEqual(initial, values) && !form.state.busy);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    const issues = validateOptionForm(values, "edit", content);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = optionPatchBody(initial, values, content.locales);
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateOption(option.id, body));
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
        prefix="option"
        mode="edit"
        idPrefix="option"
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        onSubmit={(event) => void submit(event)}
        cancelTo={PATHS.options}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

function OptionEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCanWrite();
  const resource = useRefreshingResource((signal) => adminClient.getOption(id, { signal }), [id]);
  const editor = useEditorState(resource.reload);
  const option = resource.data;
  const title =
    option === null
      ? t("page.optionDetail.title")
      : resolveLocalized(option.name, locale, content.defaultLocale) || option.code;

  if (editor.deleted) {
    return (
      <DictionaryPage t={t} current="options" title={t("page.optionDetail.title")}>
        <DeletedPanel t={t} title={t("dict.option.deleted")} listTo={PATHS.options} />
      </DictionaryPage>
    );
  }

  return (
    <DictionaryPage t={t} current="options" title={title}>
      <BackLink to={PATHS.options} label={t("dict.form.backToList")} />
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : option === null ? null : (
        <div className="flex flex-col gap-8" aria-busy={resource.refreshing || undefined}>
          <OptionEditForm
            key={option.updatedAt}
            option={option}
            content={content}
            onChanged={editor.changed}
          />
          <ItemsSection
            t={t}
            prefix="optionValue"
            content={content}
            uiLocale={locale}
            items={option.values}
            canWrite={canWrite}
            create={(body) => adminClient.createOptionValue(option.id, body)}
            update={(valueId, body) => adminClient.updateOptionValue(option.id, valueId, body)}
            remove={(valueId) => adminClient.deleteOptionValue(option.id, valueId)}
            onChanged={editor.changed}
          />
          <DangerZone
            t={t}
            canWrite={canWrite}
            id="option-danger"
            info={t("dict.option.deleteInfo")}
            buttonLabel={t("dict.option.delete")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDelete
              t={t}
              canWrite={canWrite}
              open
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => adminClient.deleteOption(option.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
              title={t("dict.option.deleteTitle", { code: option.code })}
              description={t("dict.option.deleteBody")}
              hint={t("dict.option.deleteHint")}
              confirmLabel={t("dict.option.deleteConfirm")}
            />
          ) : null}
        </div>
      )}
    </DictionaryPage>
  );
}

export function OptionDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The option route has no id parameter.");
  return (
    <ConfigGate>
      <OptionEditor key={id} id={id} />
    </ConfigGate>
  );
}
