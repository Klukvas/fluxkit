import type {
  AdminResult,
  CreateAdminOptionValueBody,
  LocalizedText,
  UpdateAdminOptionValueBody,
} from "@fluxkit/api-client";
import { Button, DataTable, type Translator } from "@fluxkit/ui";
import { useId, useState, type FormEvent } from "react";
import { ConfirmDelete, FormDialog, useDialogTarget } from "./form-dialog";
import { LocaleFields, TextField, type ContentLocales } from "./form-parts";
import { VALUE_CODE_PATTERN_SOURCE, hasIssues } from "./form-rules";
import {
  emptyItemForm,
  itemCreateBody,
  itemFormFrom,
  itemPatchBody,
  validateItemForm,
  type ItemFormValues,
} from "./dictionary-forms";
import { localeFieldNames, resolveLocalized } from "./locale-text";
import type { NoticeKind } from "./dictionary-frame";
import { useFormSubmit } from "./use-form-submit";

/** A row of an attribute's options or an option's values: the two have the same shape and the same screen. */
export interface ItemRow {
  id: string;
  code: string;
  label: LocalizedText;
  position: number;
}

/** The message keys a section needs, below its prefix (`dict.attributeOption.heading` ...); a spec checks both prefixes. */
export const ITEM_MESSAGE_SUFFIXES = [
  "heading",
  "caption",
  "empty",
  "add",
  "addTitle",
  "editTitle",
  "editLabel",
  "deleteLabel",
  "deleteTitle",
  "deleteBody",
  "deleteHint",
  "deleteConfirm",
  "columnCode",
  "columnLabel",
  "columnPosition",
  "columnActions",
  "code",
  "codeHint",
  "label",
  "position",
  "positionHint",
  "save",
  "saving",
] as const;

export type ItemPrefix = "attributeOption" | "optionValue";

export interface ItemsSectionProps {
  t: Translator;
  prefix: ItemPrefix;
  content: ContentLocales;
  uiLocale: string;
  items: readonly ItemRow[];
  /** Without it there is no add, edit or delete control (a viewer reads). */
  canWrite: boolean;
  create: (body: CreateAdminOptionValueBody) => Promise<AdminResult<unknown>>;
  update: (id: string, body: UpdateAdminOptionValueBody) => Promise<AdminResult<unknown>>;
  remove: (id: string) => Promise<AdminResult<undefined>>;
  /** After a write: the page reloads what the server has and shows the notice. */
  onChanged: (kind: NoticeKind) => void;
}

type Target = { mode: "add" } | { mode: "edit"; item: ItemRow };

function ItemDialog({
  t,
  prefix,
  content,
  uiLocale,
  target,
  create,
  update,
  onClose,
  onChanged,
}: Pick<
  ItemsSectionProps,
  "t" | "prefix" | "content" | "uiLocale" | "create" | "update" | "onChanged"
> & {
  target: Target;
  onClose: () => void;
}) {
  const formId = useId();
  const options = { defaultLocale: content.defaultLocale, locales: content.locales };
  const initial: ItemFormValues =
    target.mode === "edit"
      ? itemFormFrom(target.item, content.locales)
      : emptyItemForm(content.locales);
  const [values, setValues] = useState<ItemFormValues>(initial);
  const form = useFormSubmit(["code", "position", ...localeFieldNames("label", content.locales)]);
  const issues = form.state.fieldErrors;
  const edit = target.mode === "edit";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const local = validateItemForm(values, edit ? "edit" : "create", options);
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    if (target.mode === "add") {
      const outcome = await form.submit(() => create(itemCreateBody(values, content.locales)));
      if (outcome.kind === "ok") {
        onClose();
        onChanged("itemSaved");
      } else if (outcome.kind === "unknown") {
        onClose();
        onChanged("unknown");
      }
      return;
    }
    const body = itemPatchBody(initial, values, content.locales);
    if (Object.keys(body).length === 0) {
      onClose();
      onChanged("noChanges");
      return;
    }
    const itemId = target.item.id;
    const outcome = await form.submit(() => update(itemId, body));
    if (outcome.kind === "ok") {
      onClose();
      onChanged("itemSaved");
    } else if (outcome.kind === "unknown") {
      onClose();
      onChanged("unknown");
    }
  }

  return (
    <FormDialog
      t={t}
      title={t(`dict.${prefix}.${edit ? "editTitle" : "addTitle"}`)}
      formId={formId}
      busy={form.state.busy}
      submitLabel={t(`dict.${prefix}.save`)}
      busyLabel={t(`dict.${prefix}.saving`)}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      summary={form.state.summary}
      summaryRef={form.summaryRef}
    >
      <TextField
        t={t}
        id={`${formId}-code`}
        name="code"
        label={t(`dict.${prefix}.code`)}
        hint={t(`dict.${prefix}.codeHint`)}
        value={values.code}
        readOnly={edit}
        required
        maxLength={64}
        pattern={VALUE_CODE_PATTERN_SOURCE}
        patternHint={t(`dict.${prefix}.codeHint`)}
        error={issues["code"]}
        onChange={(code) => setValues((current) => ({ ...current, code }))}
      />
      <LocaleFields
        t={t}
        id={`${formId}-label`}
        legend={t(`dict.${prefix}.label`)}
        field="label"
        content={content}
        uiLocale={uiLocale}
        values={values.label}
        errors={issues}
        onChange={(locale, text) =>
          setValues((current) => ({ ...current, label: { ...current.label, [locale]: text } }))
        }
      />
      <TextField
        t={t}
        id={`${formId}-position`}
        name="position"
        label={t(`dict.${prefix}.position`)}
        hint={t(`dict.${prefix}.positionHint`)}
        value={values.position}
        inputMode="numeric"
        error={issues["position"]}
        onChange={(position) => setValues((current) => ({ ...current, position }))}
      />
    </FormDialog>
  );
}

/**
 * The rows of an attribute's options or an option's values, with add, edit (label, position) and delete. The rows come
 * from the server in its order (position, then code); a write is followed by a reload of the page, never by a local change.
 */
export function ItemsSection({
  t,
  prefix,
  content,
  uiLocale,
  items,
  canWrite,
  create,
  update,
  remove,
  onChanged,
}: ItemsSectionProps) {
  const dialog = useDialogTarget<Target>();
  const deleting = useDialogTarget<ItemRow>();
  const toDelete = deleting.target;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold">
          {t(`dict.${prefix}.heading`)}
        </h2>
        {canWrite ? (
          <Button variant="secondary" onClick={() => dialog.open({ mode: "add" })}>
            {t(`dict.${prefix}.add`)}
          </Button>
        ) : null}
      </div>
      <DataTable
        caption={t(`dict.${prefix}.caption`)}
        captionHidden
        columns={[
          { id: "code", header: t(`dict.${prefix}.columnCode`), cell: (row) => row.code },
          {
            id: "label",
            header: t(`dict.${prefix}.columnLabel`),
            cell: (row) => resolveLocalized(row.label, uiLocale, content.defaultLocale),
          },
          {
            id: "position",
            header: t(`dict.${prefix}.columnPosition`),
            align: "end",
            cell: (row) => row.position,
          },
        ]}
        rows={items}
        rowKey={(row) => row.id}
        emptyMessage={t(`dict.${prefix}.empty`)}
        actions={
          canWrite
            ? {
                header: t(`dict.${prefix}.columnActions`),
                render: (row) => (
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      aria-label={t(`dict.${prefix}.editLabel`, { code: row.code })}
                      onClick={() => dialog.open({ mode: "edit", item: row })}
                    >
                      {t("dict.form.edit")}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={t(`dict.${prefix}.deleteLabel`, { code: row.code })}
                      onClick={() => deleting.open(row)}
                    >
                      {t("dict.form.delete")}
                    </Button>
                  </span>
                ),
              }
            : undefined
        }
      />
      {canWrite && dialog.target !== null ? (
        <ItemDialog
          key={dialog.key}
          t={t}
          prefix={prefix}
          content={content}
          uiLocale={uiLocale}
          target={dialog.target}
          create={create}
          update={update}
          onClose={dialog.close}
          onChanged={onChanged}
        />
      ) : null}
      {canWrite && toDelete !== null ? (
        <ConfirmDelete
          key={deleting.key}
          t={t}
          canWrite={canWrite}
          open
          onClose={deleting.close}
          remove={() => remove(toDelete.id)}
          onDeleted={() => {
            deleting.close();
            onChanged("itemDeleted");
          }}
          onUnknown={() => {
            deleting.close();
            onChanged("unknown");
          }}
          title={t(`dict.${prefix}.deleteTitle`)}
          description={t(`dict.${prefix}.deleteBody`, { code: toDelete.code })}
          hint={t(`dict.${prefix}.deleteHint`)}
          confirmLabel={t(`dict.${prefix}.deleteConfirm`)}
        />
      ) : null}
    </section>
  );
}
