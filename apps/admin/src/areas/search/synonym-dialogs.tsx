import type { AdminSynonymGroup } from "@fluxkit/api-client";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Select,
  Textarea,
  type Translator,
} from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { DescriptorText, DialogError, localeLabel } from "./search-frame";
import type { SynonymFieldErrors } from "./search-outcome";
import { TERM_LIMITS, termsIssueMessages, type ParsedTerms } from "./synonym-terms";

/**
 * The dialogs of the synonym groups: props in, markup out. The form dialog creates a group (language and terms) or
 * replaces the terms of one (the language is fixed); nothing is sent by the form itself, the page sends. Every button is
 * off while the write runs and Escape does nothing then.
 */

export type SynonymFormMode = "create" | "edit";

export interface SynonymFormDialogProps {
  t: Translator;
  open: boolean;
  mode: SynonymFormMode;
  /** The languages of the shop (the status lists them); only used by the create form. */
  locales: readonly string[];
  locale: string;
  onLocaleChange: (locale: string) => void;
  text: string;
  onTextChange: (text: string) => void;
  /** The terms as they would be sent. */
  parsed: ParsedTerms;
  /** Show what is wrong with the terms (after the first send attempt). */
  showIssues: boolean;
  /** A `400` of the API on the fields. */
  fieldErrors: SynonymFieldErrors | null;
  /** A refusal that is not a field error. */
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  termsRef?: Ref<HTMLTextAreaElement>;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export function SynonymFormDialog({
  t,
  open,
  mode,
  locales,
  locale,
  onLocaleChange,
  text,
  onTextChange,
  parsed,
  showIssues,
  fieldErrors,
  error,
  errorRef,
  termsRef,
  busy,
  onSubmit,
  onClose,
}: SynonymFormDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  const issues = showIssues ? termsIssueMessages(parsed) : [];
  const termsError =
    issues.length > 0 || fieldErrors?.terms !== undefined ? (
      <>
        {issues.map((issue) => (
          <span key={issue.key} className="block">
            {t(issue.key, issue.values)}
          </span>
        ))}
        {fieldErrors?.terms === undefined ? null : (
          <span className="block">
            <DescriptorText t={t} descriptor={fieldErrors.terms} />
          </span>
        )}
      </>
    ) : undefined;
  const localeError =
    fieldErrors?.locale === undefined ? undefined : (
      <DescriptorText t={t} descriptor={fieldErrors.locale} />
    );
  const otherErrors = fieldErrors?.other ?? [];
  const formId = "search-synonym-form";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      aria-busy={busy || undefined}
      title={t(mode === "create" ? "search.synonyms.createTitle" : "search.synonyms.editTitle")}
      description={t("search.synonyms.formDescription")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("search.synonyms.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy || undefined}>
            {busy
              ? t("search.synonyms.saving")
              : t(mode === "create" ? "search.synonyms.create" : "search.synonyms.save")}
          </Button>
        </>
      }
    >
      <form id={formId} method="post" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {mode === "create" ? (
          <Field id="search-synonym-locale" label={t("search.synonyms.locale")} error={localeError}>
            {(control) => (
              <Select
                {...control}
                name="locale"
                value={locale}
                disabled={busy}
                onChange={(event) => onLocaleChange(event.target.value)}
              >
                {locales.map((entry) => (
                  <option key={entry} value={entry}>
                    {localeLabel(t, entry)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <p>
            <span className="font-medium text-muted-foreground">
              {t("search.synonyms.locale")}:{" "}
            </span>
            {localeLabel(t, locale)}
          </p>
        )}
        <Field
          id="search-synonym-terms"
          label={t("search.synonyms.terms")}
          hint={t("search.synonyms.termsHint", {
            min: TERM_LIMITS.minTerms,
            max: TERM_LIMITS.maxTerms,
            maxWords: TERM_LIMITS.maxWords,
            maxLength: TERM_LIMITS.maxLength,
          })}
          error={termsError}
          required
          requiredIndicator="*"
        >
          {(control) => (
            <Textarea
              {...control}
              ref={termsRef}
              name="terms"
              rows={4}
              value={text}
              disabled={busy}
              onChange={(event) => onTextChange(event.target.value)}
            />
          )}
        </Field>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {parsed.terms.length === 0
            ? t("search.synonyms.previewEmpty")
            : t("search.synonyms.preview", { terms: parsed.terms.join(", ") })}
        </p>
        {otherErrors.map((descriptor) => (
          <DialogError key={descriptor.key} t={t} descriptor={descriptor} />
        ))}
        <DialogError t={t} descriptor={error} innerRef={errorRef} />
      </form>
    </Dialog>
  );
}

export interface DeleteSynonymDialogProps {
  t: Translator;
  /** The group to delete, or `null` while the dialog is closed. */
  group: AdminSynonymGroup | null;
  busy: boolean;
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  onConfirm: () => void;
  onClose: () => void;
}

/** Delete confirmation: the safe choice (Cancel) is focused, and nothing is sent before the confirmation. */
export function DeleteSynonymDialog({
  t,
  group,
  busy,
  error,
  errorRef,
  onConfirm,
  onClose,
}: DeleteSynonymDialogProps) {
  return (
    <ConfirmDialog
      open={group !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      busy={busy}
      tone="danger"
      title={t("search.synonyms.deleteTitle")}
      description={
        group === null
          ? undefined
          : t("search.synonyms.deleteBody", {
              terms: group.terms.join(", "),
              locale: localeLabel(t, group.locale),
            })
      }
      confirmLabel={t("search.synonyms.deleteConfirm")}
      cancelLabel={t("search.synonyms.cancel")}
    >
      <DialogError t={t} descriptor={error} innerRef={errorRef} />
    </ConfirmDialog>
  );
}
