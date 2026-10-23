import { Alert, Button, Field, Input, LocaleTextField, type Translator } from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { FormIssues } from "./form-rules";
import { languageName, type LocaleValues } from "./locale-text";

/** The content locales the admin edits (`GET /admin/config`), independent of the UI language. */
export interface ContentLocales {
  defaultLocale: string;
  locales: readonly string[];
}

export function describe(t: Translator, descriptor: MessageDescriptor): string {
  return t(descriptor.key, descriptor.values);
}

/** The error summary of a form: a focusable alert listing what is wrong; the unknown code in small print. */
export function FormErrorSummary({
  t,
  summary,
  summaryRef,
}: {
  t: Translator;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
}) {
  if (summary.length === 0) return null;
  return (
    <div ref={summaryRef} tabIndex={-1}>
      <Alert variant="danger">
        <ul className="flex flex-col gap-1">
          {summary.map((descriptor, index) => (
            <li key={`${descriptor.key}-${index}`}>
              {describe(t, descriptor)}
              {descriptor.code === undefined ? null : (
                <small className="ms-2 text-muted-foreground">
                  {t("errors.reference", { code: descriptor.code })}
                </small>
              )}
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}

/** The result of a write that got no answer: the admin must look at what the server has before doing it again. */
export function UnknownResultNotice({ t, children }: { t: Translator; children?: ReactNode }) {
  return (
    <Alert variant="warning" title={t("dict.unknown.title")}>
      <p>{t("dict.unknown.body")}</p>
      {children}
    </Alert>
  );
}

/** One field per content locale of a locale map (`name`, `label`, `description`); the default locale is required. */
export function LocaleFields({
  t,
  id,
  legend,
  field,
  content,
  uiLocale,
  values,
  onChange,
  errors,
  readOnly,
  multiline,
  required = true,
}: {
  t: Translator;
  id: string;
  legend: string;
  /** The API's field name, for error paths (`name.uk`). */
  field: string;
  content: ContentLocales;
  uiLocale: string;
  values: LocaleValues;
  onChange: (locale: string, value: string) => void;
  errors: FormIssues;
  readOnly?: boolean;
  multiline?: boolean;
  /** The default locale is required (`false` for an optional text such as a description). */
  required?: boolean;
}) {
  return (
    <LocaleTextField
      id={id}
      legend={legend}
      values={values}
      onChange={onChange}
      readOnly={readOnly}
      multiline={multiline}
      requiredIndicator={t("dict.form.requiredMark")}
      locales={content.locales.map((locale) => {
        const error = errors[`${field}.${locale}`];
        return {
          locale,
          label: t("dict.form.localeLabel", {
            field: legend,
            language: languageName(locale, uiLocale),
          }),
          required: required && locale === content.defaultLocale,
          error: error === undefined ? undefined : describe(t, error),
        };
      })}
    />
  );
}

/** A labelled text input with its server or local error. */
export function TextField({
  t,
  id,
  name,
  label,
  hint,
  error,
  value,
  onChange,
  readOnly,
  required,
  maxLength,
  pattern,
  type,
  inputMode,
  autoComplete,
  patternHint,
}: {
  t: Translator;
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: MessageDescriptor;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  required?: boolean;
  maxLength?: number;
  pattern?: string;
  type?: "text" | "url";
  inputMode?: "numeric" | "decimal" | "text";
  autoComplete?: string;
  patternHint?: string;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error === undefined ? undefined : describe(t, error)}
      required={required}
      requiredIndicator={t("dict.form.requiredMark")}
    >
      {(control) => (
        <Input
          {...control}
          type={type ?? "text"}
          name={name}
          value={value}
          readOnly={readOnly}
          maxLength={maxLength}
          pattern={pattern}
          title={patternHint}
          inputMode={inputMode}
          autoComplete={autoComplete ?? "off"}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** Save and cancel. Without write permission a form has no actions at all. */
export function FormActions({
  t,
  busy,
  submitLabel,
  busyLabel,
  cancelTo,
  cancelLabel,
  locked = false,
}: {
  t: Translator;
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  cancelTo?: string;
  cancelLabel?: string;
  /** Disables the submit button without the "saving" label (uploads still running: a save must not race them). */
  locked?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={busy || locked} aria-busy={busy || undefined}>
        {busy ? busyLabel : submitLabel}
      </Button>
      {cancelTo === undefined ? null : (
        <Link to={cancelTo} className="font-medium text-foreground underline underline-offset-4">
          {cancelLabel ?? t("dict.form.cancel")}
        </Link>
      )}
    </div>
  );
}
