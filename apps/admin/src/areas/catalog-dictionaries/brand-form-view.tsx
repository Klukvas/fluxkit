import type { Translator } from "@fluxkit/ui";
import { useState, type FormEvent, type Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { safeHttpUrl } from "../../lib/safe-http-url";
import type { BrandFormValues } from "./dictionary-forms";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  TextField,
  type ContentLocales,
} from "./form-parts";
import {
  SLUG_MAX_LENGTH,
  SLUG_PATTERN_SOURCE,
  URL_MAX_LENGTH,
  type FormIssues,
} from "./form-rules";

/**
 * The logo of a brand from its URL. Only an http(s) URL is ever put into `src` (`safeHttpUrl`); the image loads lazily,
 * sends no referrer, and `alt` comes from the caller. A logo that cannot be loaded (the page's CSP allows only the
 * configured image hosts) is said so in text.
 */
export function BrandLogoPreview({
  url,
  alt,
  failedText,
}: {
  url: string;
  alt: string;
  failedText: string;
}) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const safe = safeHttpUrl(url.trim());
  if (safe === null) return null;
  if (failedFor === safe) return <p className="text-sm text-muted-foreground">{failedText}</p>;
  return (
    <img
      src={safe}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      width={96}
      height={96}
      className="size-24 rounded-md border border-border object-contain"
      onError={() => setFailedFor(safe)}
    />
  );
}

export interface BrandFormViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  mode: "create" | "edit";
  idPrefix: string;
  values: BrandFormValues;
  onChange: (next: BrandFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canWrite: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelTo: string;
  /** The brand's name for the logo's alt text (the default locale's, or the first available). */
  logoAlt: string;
}

/** The brand form, create and edit. The logo is a URL (no upload in this version). Read-only without write permission. */
export function BrandFormView({
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
  logoAlt,
}: BrandFormViewProps) {
  const create = mode === "create";
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      <LocaleFields
        t={t}
        id={`${idPrefix}-name`}
        legend={t("dict.brand.name")}
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
        legend={t("dict.brand.description")}
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
        label={t("dict.brand.slug")}
        hint={t(create ? "dict.brand.slugHintCreate" : "dict.brand.slugHintEdit")}
        value={values.slug}
        readOnly={!canWrite}
        required={!create}
        maxLength={SLUG_MAX_LENGTH}
        pattern={SLUG_PATTERN_SOURCE}
        patternHint={t("dict.brand.slugHintEdit")}
        error={issues["slug"]}
        onChange={(slug) => onChange({ ...values, slug })}
      />
      <div className="flex flex-col gap-3">
        <TextField
          t={t}
          id={`${idPrefix}-logoUrl`}
          name="logoUrl"
          type="url"
          label={t("dict.brand.logoUrl")}
          hint={t("dict.brand.logoUrlHint")}
          value={values.logoUrl}
          readOnly={!canWrite}
          maxLength={URL_MAX_LENGTH}
          autoComplete="off"
          error={issues["logoUrl"]}
          onChange={(logoUrl) => onChange({ ...values, logoUrl })}
        />
        <BrandLogoPreview
          url={values.logoUrl}
          alt={logoAlt}
          failedText={t("dict.brand.logoFailed")}
        />
      </div>
      {canWrite ? (
        <FormActions
          t={t}
          busy={busy}
          submitLabel={t(create ? "dict.brand.create" : "dict.form.save")}
          busyLabel={t("dict.form.saving")}
          cancelTo={cancelTo}
          cancelLabel={t("dict.form.backToList")}
        />
      ) : null}
    </form>
  );
}
