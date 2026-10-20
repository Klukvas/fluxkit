import { Checkbox, Field, Input, Select, type Translator } from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import {
  ATTRIBUTE_FLAGS,
  ATTRIBUTE_INPUT_TYPES,
  UNIT_MAX_LENGTH,
  VALIDATION_FIELDS,
  applyFlag,
  changeInputType,
  flagDisabled,
  localizedAllowed,
  unitAllowed,
  type AttributeFormValues,
  type ValidationFieldSpec,
} from "./attribute-form";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  TextField,
  describe,
  type ContentLocales,
} from "./form-parts";
import { CODE_PATTERN_SOURCE, type FormIssues } from "./form-rules";

export interface AttributeFormViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  mode: "create" | "edit";
  idPrefix: string;
  values: AttributeFormValues;
  onChange: (next: AttributeFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  /** Without it the form is read-only and has no actions. */
  canWrite: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelTo: string;
}

function ValidationField({
  t,
  id,
  spec,
  inputType,
  value,
  error,
  readOnly,
  onChange,
}: {
  t: Translator;
  id: string;
  spec: ValidationFieldSpec;
  inputType: string;
  value: string;
  error: MessageDescriptor | undefined;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const label = t(`dict.attribute.validation.${spec.key}`);
  if (spec.kind === "boolean") {
    return (
      <Checkbox
        id={id}
        name={`validation.${spec.key}`}
        label={label}
        checked={value === "true"}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.checked ? "true" : "false")}
      />
    );
  }
  const hint = t(`dict.attribute.validationHint.${inputType}.${spec.key}`);
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error === undefined ? undefined : describe(t, error)}
    >
      {(control) => (
        <Input
          {...control}
          name={`validation.${spec.key}`}
          type={spec.kind === "date" ? "date" : "text"}
          inputMode={
            spec.kind === "integer" ? "numeric" : spec.kind === "number" ? "decimal" : undefined
          }
          autoComplete="off"
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * The attribute form, create and edit (presentational: values and handlers come from props). The code and the input type
 * are chosen once; the validation fields follow the input type; the flags the type cannot have are disabled. Read-only
 * without write permission.
 */
export function AttributeFormView({
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
}: AttributeFormViewProps) {
  const create = mode === "create";
  const readOnly = !canWrite;
  const specs = VALIDATION_FIELDS[values.inputType];
  const set = (patch: Partial<AttributeFormValues>) => onChange({ ...values, ...patch });
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      <TextField
        t={t}
        id={`${idPrefix}-code`}
        name="code"
        label={t("dict.attribute.code")}
        hint={t("dict.attribute.codeHint")}
        value={values.code}
        readOnly={!create || readOnly}
        required={create}
        maxLength={64}
        pattern={create ? CODE_PATTERN_SOURCE : undefined}
        patternHint={t("dict.attribute.codeHint")}
        error={issues["code"]}
        onChange={(code) => set({ code })}
      />
      <LocaleFields
        t={t}
        id={`${idPrefix}-name`}
        legend={t("dict.attribute.name")}
        field="name"
        content={content}
        uiLocale={uiLocale}
        values={values.name}
        errors={issues}
        readOnly={readOnly}
        onChange={(locale, text) => set({ name: { ...values.name, [locale]: text } })}
      />
      <LocaleFields
        t={t}
        id={`${idPrefix}-description`}
        legend={t("dict.attribute.description")}
        field="description"
        content={content}
        uiLocale={uiLocale}
        values={values.description}
        errors={issues}
        readOnly={readOnly}
        multiline
        required={false}
        onChange={(locale, text) => set({ description: { ...values.description, [locale]: text } })}
      />
      <Field
        id={`${idPrefix}-inputType`}
        label={t("dict.attribute.inputType")}
        hint={t(create ? "dict.attribute.inputTypeHint" : "dict.attribute.inputTypeFixed")}
        required={create}
        requiredIndicator={t("dict.form.requiredMark")}
      >
        {(control) => (
          <Select
            {...control}
            name="inputType"
            value={values.inputType}
            disabled={!create || readOnly}
            onChange={(event) => {
              const next = ATTRIBUTE_INPUT_TYPES.find((type) => type === event.target.value);
              if (next !== undefined) onChange(changeInputType(values, next));
            }}
          >
            {ATTRIBUTE_INPUT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`dict.inputType.${type}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox
        id={`${idPrefix}-isLocalized`}
        name="isLocalized"
        label={t("dict.attribute.isLocalized")}
        checked={values.isLocalized}
        disabled={!create || readOnly || !localizedAllowed(values.inputType)}
        onChange={(event) => set({ isLocalized: event.target.checked })}
      />
      {unitAllowed(values.inputType) ? (
        <TextField
          t={t}
          id={`${idPrefix}-unit`}
          name="unit"
          label={t("dict.attribute.unit")}
          hint={t("dict.attribute.unitHint", { max: UNIT_MAX_LENGTH })}
          value={values.unit}
          readOnly={readOnly}
          error={issues["unit"]}
          onChange={(unit) => set({ unit })}
        />
      ) : null}
      {specs.length === 0 ? null : (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold text-foreground">
            {t("dict.attribute.validation")}
          </legend>
          {specs.map((spec) => (
            <ValidationField
              key={spec.key}
              t={t}
              id={`${idPrefix}-validation-${spec.key}`}
              spec={spec}
              inputType={values.inputType}
              value={values.validation[spec.key] ?? ""}
              error={issues[`validation.${spec.key}`]}
              readOnly={readOnly}
              onChange={(value) => set({ validation: { ...values.validation, [spec.key]: value } })}
            />
          ))}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold text-foreground">{t("dict.attribute.flags")}</legend>
        {ATTRIBUTE_FLAGS.map((flag) => (
          <Checkbox
            key={flag}
            id={`${idPrefix}-${flag}`}
            name={flag}
            label={t(`dict.attribute.flag.${flag}`)}
            checked={values.flags[flag]}
            disabled={readOnly || flagDisabled(values, flag)}
            onChange={(event) => onChange(applyFlag(values, flag, event.target.checked))}
          />
        ))}
        <p className="text-sm text-muted-foreground">{t("dict.attribute.flagsHint")}</p>
      </fieldset>
      {canWrite ? (
        <FormActions
          t={t}
          busy={busy}
          submitLabel={t(create ? "dict.attribute.create" : "dict.form.save")}
          busyLabel={t("dict.form.saving")}
          cancelTo={cancelTo}
          cancelLabel={t("dict.form.backToList")}
        />
      ) : null}
    </form>
  );
}
