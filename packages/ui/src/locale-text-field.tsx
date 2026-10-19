import type { ReactNode } from "react";
import { Field } from "./field";
import { Input } from "./input";
import { Textarea } from "./textarea";

export interface LocaleTextFieldLocale {
  /** Content locale code, for example "uk"; also the `lang` of the control. */
  locale: string;
  /** Label of this locale's field, for example "Title (Ukrainian)". */
  label: string;
  /** The default locale is required: pass `true` for it only. */
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
}

export interface LocaleTextFieldProps {
  /** Base id; each control gets `<id>-<locale>`. */
  id: string;
  /** Names the group, for example "Title". */
  legend: ReactNode;
  locales: LocaleTextFieldLocale[];
  values: Readonly<Record<string, string | undefined>>;
  onChange: (locale: string, value: string) => void;
  multiline?: boolean;
  rows?: number;
  readOnly?: boolean;
  /** Visual marker next to required labels (for example "*"). */
  requiredIndicator?: string;
}

/** One text field per content locale (a locale map such as `title`), grouped under one legend. */
export function LocaleTextField({
  id,
  legend,
  locales,
  values,
  onChange,
  multiline = false,
  rows = 4,
  readOnly,
  requiredIndicator,
}: LocaleTextFieldProps) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-semibold text-foreground">{legend}</legend>
      {locales.map((entry) => (
        <Field
          key={entry.locale}
          id={`${id}-${entry.locale}`}
          label={entry.label}
          hint={entry.hint}
          error={entry.error}
          required={entry.required === true}
          requiredIndicator={requiredIndicator}
        >
          {(control) =>
            multiline ? (
              <Textarea
                {...control}
                lang={entry.locale}
                rows={rows}
                readOnly={readOnly}
                value={values[entry.locale] ?? ""}
                onChange={(event) => onChange(entry.locale, event.target.value)}
              />
            ) : (
              <Input
                {...control}
                lang={entry.locale}
                readOnly={readOnly}
                value={values[entry.locale] ?? ""}
                onChange={(event) => onChange(entry.locale, event.target.value)}
              />
            )
          }
        </Field>
      ))}
    </fieldset>
  );
}
