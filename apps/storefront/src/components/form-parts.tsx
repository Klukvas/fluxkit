import { Alert, Field, Input, type Translator } from "@fluxkit/ui";
import type { InputHTMLAttributes, Ref } from "react";
import { failureText, type Failure } from "../lib/failure";
import { focusRing } from "./styles";

/**
 * The error summary of a form: one `role="alert"` box that lists every field error as a link to its field (or the single
 * message of a failure that belongs to no field: a wrong password, a 429, a network error). It receives the focus when no
 * field does (`focusAfterFailure`), hence `tabIndex={-1}` on its wrapper.
 */
export function FormErrorSummary({
  failure,
  t,
  labels,
  ids,
  summaryRef,
}: {
  failure: Failure | null;
  t: Translator;
  /** Visible label of each field path on this form. */
  labels: Readonly<Record<string, string>>;
  ids: Readonly<Record<string, string>>;
  summaryRef: Ref<HTMLDivElement>;
}) {
  if (failure === null) return null;
  const listed = failure.fieldErrors.filter((error) => labels[error.path] !== undefined);
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      className={`rounded-md outline-offset-2 focus:outline-2 focus:outline-ring`}
    >
      <Alert variant="danger" title={t("account.form.errorTitle")}>
        {listed.length === 0 ? (
          <p>{failureText(t, failure)}</p>
        ) : (
          <ul className="mt-1 list-disc ps-5">
            {listed.map((error) => (
              <li key={`${error.path}-${error.code}`}>
                <a
                  href={`#${ids[error.path]}`}
                  className={`underline underline-offset-4 ${focusRing}`}
                >
                  {t("account.form.errorItem", {
                    field: labels[error.path] as string,
                    message: t(error.messageKey),
                  })}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Alert>
    </div>
  );
}

/** The message of one field's error, or `undefined`. */
export function fieldMessage(
  failure: Failure | null,
  path: string,
  t: Translator,
): string | undefined {
  const error = failure?.fieldErrors.find((candidate) => candidate.path === path);
  return error === undefined ? undefined : t(error.messageKey);
}

/** A labelled text input with its error and hint wired for assistive technology (`Field`), one place for all the forms. */
export function TextField({
  id,
  name,
  label,
  hint,
  failure,
  t,
  value,
  onValueChange,
  required = true,
  ...input
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  failure: Failure | null;
  t: Translator;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "name" | "value" | "onChange" | "required"
>) {
  const error = fieldMessage(failure, name, t);
  return (
    <Field
      id={id}
      label={label}
      required={required}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          {...input}
        />
      )}
    </Field>
  );
}
