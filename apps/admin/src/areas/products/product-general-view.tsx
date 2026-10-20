import type { Translator } from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  TextField,
  type ContentLocales,
} from "../catalog-dictionaries/form-parts";
import {
  SLUG_MAX_LENGTH,
  SLUG_PATTERN_SOURCE,
  type FormIssues,
} from "../catalog-dictionaries/form-rules";
import { GENERAL_FIELD_IDS } from "./field-ids";
import type { ProductFormValues } from "./product-form";

export interface ProductGeneralViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  mode: "create" | "edit";
  values: ProductFormValues;
  onChange: (next: ProductFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canWrite: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Create: the product type picker (required). Edit: nothing (the type cannot change; the header names it). */
  typePicker?: ReactNode;
  brandPicker: ReactNode;
  cancelTo?: string;
}

/**
 * The general fields of a product: title and description per content locale, slug, brand, and on create the product type.
 * Descriptions are plain text in a textarea, never HTML. Read-only without write permission (no actions at all).
 */
export function ProductGeneralView({
  t,
  uiLocale,
  content,
  mode,
  values,
  onChange,
  issues,
  summary,
  summaryRef,
  busy,
  canWrite,
  onSubmit,
  typePicker,
  brandPicker,
  cancelTo,
}: ProductGeneralViewProps) {
  const create = mode === "create";
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      {typePicker}
      <LocaleFields
        t={t}
        id={GENERAL_FIELD_IDS.title}
        legend={t("products.form.title")}
        field="title"
        content={content}
        uiLocale={uiLocale}
        values={values.title}
        errors={issues}
        readOnly={!canWrite}
        onChange={(locale, text) =>
          onChange({ ...values, title: { ...values.title, [locale]: text } })
        }
      />
      <LocaleFields
        t={t}
        id={GENERAL_FIELD_IDS.description}
        legend={t("products.form.description")}
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
        id={GENERAL_FIELD_IDS.slug}
        name="slug"
        label={t("products.form.slug")}
        hint={t(create ? "products.form.slugHintCreate" : "products.form.slugHintEdit")}
        value={values.slug}
        readOnly={!canWrite}
        required={!create}
        maxLength={SLUG_MAX_LENGTH}
        pattern={SLUG_PATTERN_SOURCE}
        patternHint={t("dict.error.slugFormat")}
        error={issues["slug"]}
        onChange={(slug) => onChange({ ...values, slug })}
      />
      {brandPicker}
      {canWrite ? (
        <FormActions
          t={t}
          busy={busy}
          submitLabel={t(create ? "products.form.create" : "products.form.save")}
          busyLabel={t(create ? "products.form.creating" : "products.form.saving")}
          cancelTo={cancelTo}
        />
      ) : null}
    </form>
  );
}
