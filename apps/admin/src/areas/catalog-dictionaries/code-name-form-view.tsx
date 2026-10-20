import type { Translator } from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { LocaleValues } from "./locale-text";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  TextField,
  type ContentLocales,
} from "./form-parts";
import { CODE_PATTERN_SOURCE, type FormIssues } from "./form-rules";

/** The prefixes whose message keys this form reads: `dict.<prefix>.code`, `.codeHint`, `.name`, `.create`. */
export type CodeNamePrefix = "option" | "productType";

export interface CodeNameFormViewProps<Values extends { code: string; name: LocaleValues }> {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  prefix: CodeNamePrefix;
  mode: "create" | "edit";
  idPrefix: string;
  values: Values;
  onChange: (next: Values) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canWrite: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelTo: string;
  /** More fields between the name and the actions (a product type's `requiresShipping`). */
  extra?: ReactNode;
}

/** A code (chosen once) and a translated name: the form of an option and of a product type. Read-only without write permission. */
export function CodeNameFormView<Values extends { code: string; name: LocaleValues }>({
  t,
  uiLocale,
  content,
  prefix,
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
  extra,
}: CodeNameFormViewProps<Values>) {
  const create = mode === "create";
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      <TextField
        t={t}
        id={`${idPrefix}-code`}
        name="code"
        label={t(`dict.${prefix}.code`)}
        hint={t(`dict.${prefix}.codeHint`)}
        value={values.code}
        readOnly={!create || !canWrite}
        required={create}
        maxLength={64}
        pattern={create ? CODE_PATTERN_SOURCE : undefined}
        patternHint={t(`dict.${prefix}.codeHint`)}
        error={issues["code"]}
        onChange={(code) => onChange({ ...values, code })}
      />
      <LocaleFields
        t={t}
        id={`${idPrefix}-name`}
        legend={t(`dict.${prefix}.name`)}
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
      {extra}
      {canWrite ? (
        <FormActions
          t={t}
          busy={busy}
          submitLabel={t(create ? `dict.${prefix}.create` : "dict.form.save")}
          busyLabel={t("dict.form.saving")}
          cancelTo={cancelTo}
          cancelLabel={t("dict.form.backToList")}
        />
      ) : null}
    </form>
  );
}
