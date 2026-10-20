import { Checkbox, type Translator } from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { CategoryFormValues } from "./dictionary-forms";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  TextField,
  type ContentLocales,
} from "./form-parts";
import { SLUG_MAX_LENGTH, SLUG_PATTERN_SOURCE, type FormIssues } from "./form-rules";

export interface CategoryFormViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  mode: "create" | "edit";
  idPrefix: string;
  values: CategoryFormValues;
  onChange: (next: CategoryFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canWrite: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelTo: string;
  /** Shown above the name: where the category sits (the parent's name, or "root level"). Read-only here; moving is its own action. */
  parentLabel: string;
}

/** The category form, create and edit. The place in the tree is not a field: a new category goes under the chosen parent, an existing one moves through the move action. */
export function CategoryFormView({
  t,
  uiLocale,
  content,
  mode,
  idPrefix,
  values,
  onChange,
  issues,
  summary,
  summaryRef,
  busy,
  canWrite,
  onSubmit,
  cancelTo,
  parentLabel,
}: CategoryFormViewProps) {
  const create = mode === "create";
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      <TextField
        t={t}
        id={`${idPrefix}-parent`}
        name="parent"
        label={t("dict.category.parent")}
        hint={t(create ? "dict.category.parentHintCreate" : "dict.category.parentHintEdit")}
        value={parentLabel}
        readOnly
        onChange={() => undefined}
      />
      <LocaleFields
        t={t}
        id={`${idPrefix}-name`}
        legend={t("dict.category.name")}
        field="name"
        content={content}
        uiLocale={uiLocale}
        values={values.name}
        errors={issues}
        readOnly={!canWrite}
        onChange={(locale, text) =>
          onChange({ ...values, name: { ...values.name, [locale]: text } })
        }
      />
      <LocaleFields
        t={t}
        id={`${idPrefix}-description`}
        legend={t("dict.category.description")}
        field="description"
        content={content}
        uiLocale={uiLocale}
        values={values.description}
        errors={issues}
        readOnly={!canWrite}
        multiline
        required={false}
        onChange={(locale, text) =>
          onChange({ ...values, description: { ...values.description, [locale]: text } })
        }
      />
      <TextField
        t={t}
        id={`${idPrefix}-slug`}
        name="slug"
        label={t("dict.category.slug")}
        hint={t(create ? "dict.category.slugHintCreate" : "dict.category.slugHintEdit")}
        value={values.slug}
        readOnly={!canWrite}
        required={!create}
        maxLength={SLUG_MAX_LENGTH}
        pattern={SLUG_PATTERN_SOURCE}
        patternHint={t("dict.category.slugHintEdit")}
        error={issues["slug"]}
        onChange={(slug) => onChange({ ...values, slug })}
      />
      <div className="flex flex-col">
        <Checkbox
          id={`${idPrefix}-isActive`}
          name="isActive"
          label={t("dict.category.isActive")}
          checked={values.isActive}
          disabled={!canWrite}
          onChange={(event) => onChange({ ...values, isActive: event.target.checked })}
        />
        <p className="text-sm text-muted-foreground">{t("dict.category.isActiveHint")}</p>
      </div>
      {canWrite ? (
        <FormActions
          t={t}
          busy={busy}
          submitLabel={t(create ? "dict.category.create" : "dict.form.save")}
          busyLabel={t("dict.form.saving")}
          cancelTo={cancelTo}
          cancelLabel={t("dict.form.backToList")}
        />
      ) : null}
    </form>
  );
}
