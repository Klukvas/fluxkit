import { Alert, Button, Disclosure, Field, Input, Textarea, type Translator } from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import { firstInvalidControl } from "../../lib/first-invalid";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { safeHttpUrl } from "../../lib/safe-http-url";
import {
  FormActions,
  FormErrorSummary,
  TextField,
  describe,
  type ContentLocales,
} from "../../areas/catalog-dictionaries/form-parts";
import type { FormIssues } from "../../areas/catalog-dictionaries/form-rules";
import { languageName } from "../../areas/catalog-dictionaries/locale-text";
import { UploadPanel } from "../../areas/catalog-dictionaries/upload-panel";
import { limitValues } from "../../areas/catalog-dictionaries/upload-queue";
import type { BlogCoverUpload } from "./blog-cover-upload";
import type { BlogFormValues } from "./blog-form";
import {
  BLOG_BODY_MAX_LENGTH,
  BLOG_SLUG_MAX_LENGTH,
  BLOG_SLUG_PATTERN_SOURCE,
  BLOG_TEXT_LIMITS,
  codePoints,
  type BlogTextField,
} from "./blog-rules";

/** The id of the post form: a refused save focuses its first invalid field (`firstInvalidBlogField`). */
export const BLOG_FORM_ID = "blog-post-form";

/** The first field of the post form marked invalid, looked up in the commit that marks it. */
export function firstInvalidBlogField(): HTMLElement | null {
  const form = document.getElementById(BLOG_FORM_ID);
  const found = form === null ? null : firstInvalidControl(form);
  return found instanceof HTMLElement ? found : null;
}

/** The id of one locale's field (`blog-body-uk`). */
export function blogFieldId(field: string, locale: string): string {
  return `blog-${field}-${locale}`;
}

/** One text of one locale with its live length ("12 of 120 characters"). */
function CountedText({
  t,
  id,
  label,
  value,
  limit,
  units,
  rows,
  required,
  readOnly,
  error,
  locale,
  hint,
  onChange,
}: {
  t: Translator;
  id: string;
  label: string;
  value: string;
  limit: number;
  /** `characters` counts code points of the trimmed text (titles); `units` counts the Markdown source as the API does. */
  units: "characters" | "units";
  /** A text area with that many rows; a one-line input without. */
  rows?: number;
  required: boolean;
  readOnly: boolean;
  error: MessageDescriptor | undefined;
  locale: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const length = units === "characters" ? codePoints(value.trim()) : value.length;
  const count = t("features.blog.form.count", { length, limit });
  return (
    <Field
      id={id}
      label={label}
      hint={[hint, count].filter((part) => part !== undefined).join(" ")}
      error={error === undefined ? undefined : describe(t, error)}
      required={required}
      requiredIndicator={t("dict.form.requiredMark")}
    >
      {(control) =>
        rows === undefined ? (
          <Input
            {...control}
            lang={locale}
            readOnly={readOnly}
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Textarea
            {...control}
            lang={locale}
            rows={rows}
            readOnly={readOnly}
            spellCheck={units === "characters"}
            className={units === "units" ? "font-mono text-sm" : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </Field>
  );
}

/** The short syntax help of "Fluxkit Markdown" (ADR 0050): what the body accepts. */
function SyntaxHelp({ t }: { t: Translator }) {
  const lines = ["headings", "emphasis", "lists", "links", "quotes", "code", "notAllowed"] as const;
  return (
    <Disclosure
      title={t("features.blog.syntax.title")}
      headingId="blog-syntax-heading"
      headingAs="h2"
      defaultOpen={false}
    >
      <ul className="flex list-disc flex-col gap-1 ps-5 pb-3 text-sm text-foreground">
        {lines.map((line) => (
          <li key={line}>{t(`features.blog.syntax.${line}`)}</li>
        ))}
      </ul>
    </Disclosure>
  );
}

function CoverSection({
  t,
  values,
  error,
  canWrite,
  upload,
  onRemove,
}: {
  t: Translator;
  values: BlogFormValues;
  error: MessageDescriptor | undefined;
  canWrite: boolean;
  upload: BlogCoverUpload;
  onRemove: () => void;
}) {
  const cover = values.cover;
  const source = cover === null ? null : safeHttpUrl(cover.url);
  const errorId = "blog-cover-error";
  return (
    <section aria-labelledby="blog-cover-heading" className="flex flex-col gap-3">
      <h2 id="blog-cover-heading" className="text-lg font-semibold text-foreground">
        {t("features.blog.cover.heading")}
      </h2>
      {cover === null ? (
        <p className="text-sm text-muted-foreground">{t("features.blog.cover.none")}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {source === null ? null : (
            <img
              src={source}
              alt=""
              width={cover.width}
              height={cover.height}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-40 rounded-media border border-border bg-muted object-cover"
            />
          )}
          <p className="text-sm text-foreground">
            {t("features.blog.cover.size", { width: cover.width, height: cover.height })}
          </p>
        </div>
      )}
      {canWrite && upload.uploadsEnabled ? (
        <p className="text-sm text-muted-foreground">
          {t("features.blog.cover.limits", limitValues(upload.controls.limits, 1))}
        </p>
      ) : canWrite ? (
        <Alert variant="warning" title={t("features.blog.cover.uploadsOffTitle")}>
          <p>{t("features.blog.cover.uploadsOffBody")}</p>
        </Alert>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap items-start gap-3">
          {upload.uploadsEnabled ? (
            <UploadPanel
              t={t}
              id="blog-cover-upload"
              label={t(
                cover === null ? "features.blog.cover.upload" : "features.blog.cover.replace",
              )}
              multiple={false}
              controls={upload.controls}
              errorId={error === undefined ? undefined : errorId}
            />
          ) : null}
          {cover === null ? null : (
            <Button variant="secondary" onClick={onRemove} disabled={upload.running}>
              {t("features.blog.cover.remove")}
            </Button>
          )}
        </div>
      ) : null}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          {describe(t, error)}
        </p>
      )}
    </section>
  );
}

export interface BlogFormViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  mode: "create" | "edit";
  values: BlogFormValues;
  onChange: (values: BlogFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canWrite: boolean;
  /** The post has a publish date: the slug can no longer change (`slugLocked`). */
  slugLocked: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelTo: string;
  upload: BlogCoverUpload;
}

/**
 * The post form, create and edit (plan section 10): the slug, one fieldset per content locale (title, excerpt, Markdown
 * body, SEO title and description, cover description), the cover. Read-only without `catalog.write`. A Markdown refusal is
 * shown under its locale's body with the line the API names (no live preview in v1). Save waits for a running upload.
 */
export function BlogFormView({
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
  slugLocked,
  onSubmit,
  cancelTo,
  upload,
}: BlogFormViewProps) {
  const readOnly = !canWrite;
  const setText = (field: BlogTextField | "body", locale: string, text: string) =>
    onChange({ ...values, [field]: { ...values[field], [locale]: text } });
  return (
    <form
      id={BLOG_FORM_ID}
      method="post"
      onSubmit={onSubmit}
      className="flex min-w-0 max-w-4xl flex-col gap-8"
      noValidate
    >
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      <Alert variant="info">
        <p>{t("features.blog.form.publicNote")}</p>
      </Alert>
      <TextField
        t={t}
        id="blog-slug"
        name="slug"
        label={t("features.blog.form.slug")}
        hint={t(
          slugLocked
            ? "features.blog.form.slugLocked"
            : mode === "create"
              ? "features.blog.form.slugHintCreate"
              : "features.blog.form.slugHint",
        )}
        error={issues["slug"]}
        value={values.slug}
        readOnly={readOnly || slugLocked}
        maxLength={BLOG_SLUG_MAX_LENGTH}
        pattern={BLOG_SLUG_PATTERN_SOURCE}
        patternHint={t("features.blog.reason.invalid_slug")}
        onChange={(slug) => onChange({ ...values, slug })}
      />
      <SyntaxHelp t={t} />
      {content.locales.map((locale) => {
        const language = languageName(locale, uiLocale);
        const isDefault = locale === content.defaultLocale;
        const text = (field: BlogTextField, rows?: number, hint?: string) => (
          <CountedText
            t={t}
            id={blogFieldId(field, locale)}
            label={t(`features.blog.form.${field}`, { language })}
            value={values[field][locale] ?? ""}
            limit={BLOG_TEXT_LIMITS[field]}
            units="characters"
            rows={rows}
            required={field === "title" && isDefault}
            readOnly={readOnly}
            error={issues[`${field}.${locale}`]}
            locale={locale}
            hint={hint}
            onChange={(next) => setText(field, locale, next)}
          />
        );
        return (
          <fieldset key={locale} className="flex flex-col gap-4">
            <legend className="mb-1 text-lg font-semibold text-foreground">
              {t(isDefault ? "features.blog.form.languageDefault" : "features.blog.form.language", {
                language,
              })}
            </legend>
            {text("title", undefined, t("features.blog.form.titleHint"))}
            {text("excerpt", 3, t("features.blog.form.excerptHint"))}
            <CountedText
              t={t}
              id={blogFieldId("body", locale)}
              label={t("features.blog.form.body", { language })}
              value={values.body[locale] ?? ""}
              limit={BLOG_BODY_MAX_LENGTH}
              units="units"
              rows={16}
              required={false}
              readOnly={readOnly}
              error={issues[`body.${locale}`]}
              locale={locale}
              hint={t("features.blog.form.bodyHint")}
              onChange={(next) => setText("body", locale, next)}
            />
            {text("seoTitle", undefined, t("features.blog.form.seoTitleHint"))}
            {text("seoDescription", 2, t("features.blog.form.seoDescriptionHint"))}
            {text("coverAlt", undefined, t("features.blog.form.coverAltHint"))}
          </fieldset>
        );
      })}
      <CoverSection
        t={t}
        values={values}
        error={issues["coverUploadId"]}
        canWrite={canWrite}
        upload={upload}
        onRemove={() => onChange({ ...values, cover: null })}
      />
      {canWrite ? (
        <FormActions
          t={t}
          busy={busy}
          locked={upload.running}
          submitLabel={t(mode === "create" ? "features.blog.form.create" : "dict.form.save")}
          busyLabel={t("dict.form.saving")}
          cancelTo={cancelTo}
          cancelLabel={t("features.blog.backToList")}
        />
      ) : null}
    </form>
  );
}
