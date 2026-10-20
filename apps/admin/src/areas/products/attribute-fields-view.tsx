import { Button, Checkbox, Field, Input, Select, StatusBadge, type Translator } from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  describe,
  type ContentLocales,
} from "../catalog-dictionaries/form-parts";
import type { FormIssues } from "../catalog-dictionaries/form-rules";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";
import {
  setCodes,
  setLocale,
  setText,
  toggleCode,
  type AttributeFieldSpec,
  type AttributeFieldValue,
  type AttributeFormValues,
  type AttributeRules,
} from "./attribute-values-form";
import { attributeControlId } from "./field-ids";

export interface AttributeFieldsViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  specs: readonly AttributeFieldSpec[];
  values: AttributeFormValues;
  onChange: (next: AttributeFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canWrite: boolean;
  /** `publish` for an active product: required attributes are required on every save. */
  mode: "draft" | "publish";
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const requiredMark = "dict.form.requiredMark";

/** What the definition's rules allow, in words (the hint under a field). */
function rulesHint(t: Translator, rules: AttributeRules | null): string | null {
  if (rules === null) return null;
  switch (rules.inputType) {
    case "text":
      return t("products.attributes.hint.text", { min: rules.minLength, max: rules.maxLength });
    case "number": {
      const parts = [
        rules.integer
          ? t("products.attributes.hint.integer")
          : t("products.attributes.hint.decimals", { max: rules.maxDecimals }),
      ];
      if (rules.min !== undefined)
        parts.push(t("products.attributes.hint.min", { min: rules.min }));
      if (rules.max !== undefined)
        parts.push(t("products.attributes.hint.max", { max: rules.max }));
      return parts.join(" ");
    }
    case "multiselect":
      return t("products.attributes.hint.items", { min: rules.minItems, max: rules.maxItems });
    case "date": {
      const parts: string[] = [];
      if (rules.min !== undefined)
        parts.push(t("products.attributes.hint.dateMin", { min: rules.min }));
      if (rules.max !== undefined)
        parts.push(t("products.attributes.hint.dateMax", { max: rules.max }));
      return parts.length === 0 ? null : parts.join(" ");
    }
    case "boolean":
    case "select":
      return null;
  }
}

function textOf(value: AttributeFieldValue | undefined): string {
  return value?.kind === "text" ? value.text : "";
}

/** One generated field. Every label, hint and choice comes from the definition or the translator. */
function AttributeField({
  t,
  uiLocale,
  content,
  spec,
  values,
  onChange,
  issues,
  canWrite,
  mode,
}: Omit<AttributeFieldsViewProps, "specs" | "summary" | "summaryRef" | "busy" | "onSubmit"> & {
  spec: AttributeFieldSpec;
}) {
  const id = attributeControlId(spec.code);
  const path = `attributes.${spec.code}`;
  const name = resolveLocalized(spec.name, uiLocale, content.defaultLocale) || spec.code;
  const label =
    spec.unit === null ? name : t("products.attributes.labelWithUnit", { name, unit: spec.unit });
  const required = mode === "publish" && spec.isRequired;
  const description = resolveLocalized(spec.description, uiLocale, content.defaultLocale);
  const hint = [
    description,
    rulesHint(t, spec.rules),
    spec.isRequired && mode === "draft" ? t("products.attributes.requiredToPublish") : "",
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ");
  const error = issues[path];
  const errorText = error === undefined ? undefined : describe(t, error);
  const value = values[spec.code];
  const badges: ReactNode = (
    <span className="flex flex-wrap gap-2">
      <span className="text-sm text-muted-foreground">{spec.code}</span>
      {spec.isInternal ? (
        <StatusBadge tone="warning" label={t("products.attributes.internal")} />
      ) : null}
    </span>
  );

  if (spec.isLocalized) {
    return (
      <div className="flex flex-col gap-1">
        {badges}
        <LocaleFields
          t={t}
          id={id}
          legend={label}
          field={path}
          content={content}
          uiLocale={uiLocale}
          values={value?.kind === "locales" ? value.values : {}}
          errors={issues}
          readOnly={!canWrite}
          required={required}
          onChange={(locale, text) => onChange(setLocale(values, spec.code, locale, text))}
        />
        {hint === "" ? null : <p className="text-sm text-muted-foreground">{hint}</p>}
        {errorText === undefined ? null : <p className="text-sm text-danger">{errorText}</p>}
      </div>
    );
  }

  if (spec.inputType === "multiselect") {
    const chosen = value?.kind === "codes" ? value.codes : [];
    const unknown = chosen.filter((code) => !spec.options.some((entry) => entry.code === code));
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    return (
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={
          [hint === "" ? null : hintId, errorText === undefined ? null : errorId]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        <legend className="font-medium text-foreground">
          {label}
          {required ? (
            <span aria-hidden="true" className="ms-1 text-danger">
              {t(requiredMark)}
            </span>
          ) : null}
        </legend>
        {badges}
        {hint === "" ? null : (
          <p id={hintId} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )}
        {spec.options.length === 0 ? (
          <p className="text-muted-foreground">{t("products.attributes.noChoices")}</p>
        ) : (
          <div className="flex flex-wrap gap-x-6">
            {spec.options.map((entry, index) => (
              <Checkbox
                key={entry.code}
                id={index === 0 ? id : `${id}-${index}`}
                name={path}
                value={entry.code}
                checked={chosen.includes(entry.code)}
                disabled={!canWrite}
                aria-invalid={errorText === undefined ? undefined : true}
                onChange={() => onChange(toggleCode(values, spec.code, entry.code))}
                label={resolveLocalized(entry.label, uiLocale, content.defaultLocale) || entry.code}
              />
            ))}
          </div>
        )}
        {unknown.length === 0 ? null : (
          <p className="text-sm text-muted-foreground">
            {t("products.attributes.unknownChoices", { codes: unknown.join(", ") })}
            {canWrite ? (
              <Button
                variant="secondary"
                className="ms-2"
                onClick={() =>
                  onChange(
                    setCodes(
                      values,
                      spec.code,
                      chosen.filter((code) => !unknown.includes(code)),
                    ),
                  )
                }
              >
                {t("products.attributes.removeUnknown")}
              </Button>
            ) : null}
          </p>
        )}
        {errorText === undefined ? null : (
          <p id={errorId} className="text-sm text-danger">
            {errorText}
          </p>
        )}
      </fieldset>
    );
  }

  const text = textOf(value);
  const change = (next: string) => onChange(setText(values, spec.code, next));
  const choice = (code: string, labelText: string) => (
    <option key={code} value={code}>
      {labelText}
    </option>
  );
  return (
    <div className="flex flex-col gap-1">
      {badges}
      <Field
        id={id}
        label={label}
        hint={hint === "" ? undefined : hint}
        error={errorText}
        required={required}
        requiredIndicator={t(requiredMark)}
      >
        {(control) => {
          switch (spec.inputType) {
            case "boolean":
              return (
                <Select
                  {...control}
                  name={path}
                  value={text}
                  disabled={!canWrite}
                  onChange={(event) => change(event.target.value)}
                >
                  {choice("", t("products.attributes.notSet"))}
                  {choice("true", t("products.attributes.yes"))}
                  {choice("false", t("products.attributes.no"))}
                  {text === "" || text === "true" || text === "false"
                    ? null
                    : choice(text, t("products.attributes.unknownChoice", { code: text }))}
                </Select>
              );
            case "select":
              return (
                <Select
                  {...control}
                  name={path}
                  value={text}
                  disabled={!canWrite}
                  onChange={(event) => change(event.target.value)}
                >
                  {choice("", t("products.attributes.notSet"))}
                  {spec.options.map((entry) =>
                    choice(
                      entry.code,
                      resolveLocalized(entry.label, uiLocale, content.defaultLocale) || entry.code,
                    ),
                  )}
                  {text === "" || spec.options.some((entry) => entry.code === text)
                    ? null
                    : choice(text, t("products.attributes.unknownChoice", { code: text }))}
                </Select>
              );
            case "date":
              return (
                <Input
                  {...control}
                  type="date"
                  name={path}
                  value={text}
                  readOnly={!canWrite}
                  min={spec.rules?.inputType === "date" ? spec.rules.min : undefined}
                  max={spec.rules?.inputType === "date" ? spec.rules.max : undefined}
                  onChange={(event) => change(event.target.value)}
                />
              );
            case "number":
              return (
                <Input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  name={path}
                  value={text}
                  readOnly={!canWrite}
                  autoComplete="off"
                  onChange={(event) => change(event.target.value)}
                />
              );
            default:
              return (
                <Input
                  {...control}
                  type="text"
                  name={path}
                  value={text}
                  readOnly={!canWrite}
                  maxLength={spec.rules?.inputType === "text" ? spec.rules.maxLength : undefined}
                  autoComplete="off"
                  onChange={(event) => change(event.target.value)}
                />
              );
          }
        }}
      </Field>
    </div>
  );
}

/**
 * The product's attribute values, one generated field per product-level attribute of its type (text, localized text,
 * number with its unit, yes/no, one choice, several choices, date). Internal attributes carry an "internal" badge (admin
 * data the shop never shows). Read-only for an admin who may not update products: no actions at all.
 */
export function AttributeFieldsView(props: AttributeFieldsViewProps) {
  const { t, specs, summary, summaryRef, busy, canWrite, onSubmit } = props;
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      {specs.map((spec) => (
        <AttributeField key={spec.code} {...props} spec={spec} />
      ))}
      {canWrite ? (
        <FormActions
          t={t}
          busy={busy}
          submitLabel={t("products.form.save")}
          busyLabel={t("products.form.saving")}
        />
      ) : null}
    </form>
  );
}
