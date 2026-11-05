import { Alert, Button, Checkbox, Field, Input, Textarea, type Translator } from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { safeHttpUrl } from "../../lib/safe-http-url";
import {
  FormActions,
  FormErrorSummary,
  TextField,
  describe,
  type ContentLocales,
} from "../catalog-dictionaries/form-parts";
import type { FormIssues } from "../catalog-dictionaries/form-rules";
import { languageName } from "../catalog-dictionaries/locale-text";
import { UploadPanel, type UploadControls } from "../catalog-dictionaries/upload-panel";
import { limitValues } from "../catalog-dictionaries/upload-queue";
import {
  hasBannerRatio,
  localesUsingDefault,
  pictureField,
  type BannerFormValues,
  type BannerPicture,
  type BannerWarning,
} from "./banner-form";
import type { PictureSlot } from "./banner-picture-upload";
import { BANNER_LIMITS, codePointLength } from "./banner-rules";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** What the form needs of the picture uploads (`useBannerPictureUpload`). */
export interface BannerUploadView {
  uploadsEnabled: boolean;
  running: boolean;
  controlsFor: (slot: PictureSlot) => UploadControls;
}

export interface BannerFormViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  mode: "create" | "edit";
  values: BannerFormValues;
  onChange: (next: BannerFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canWrite: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelTo: string;
  upload: BannerUploadView;
  /** The zone the dates are typed in, with its offset (`Europe/Kyiv, UTC+02:00`). */
  zone: string;
  warnings: readonly BannerWarning[];
  /** The live preview, placed next to the form on wide screens. */
  preview: ReactNode;
}

function RadioGroup<Value extends string>({
  id,
  legend,
  hint,
  options,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  legend: string;
  hint?: string;
  options: readonly { value: Value; label: string; description?: string }[];
  value: Value;
  readOnly: boolean;
  onChange: (value: Value) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={hint === undefined ? undefined : hintId}
    >
      <legend className="mb-1 font-semibold text-foreground">{legend}</legend>
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {options.map((option) => {
        const optionId = `${id}-${option.value}`;
        return (
          <div key={option.value} className="flex flex-col">
            <label
              htmlFor={optionId}
              className="inline-flex min-h-11 items-center gap-2 text-foreground"
            >
              <input
                id={optionId}
                type="radio"
                name={id}
                value={option.value}
                checked={value === option.value}
                disabled={readOnly}
                onChange={() => onChange(option.value)}
                className={`size-5 accent-primary ${focusClass}`}
              />
              <span className="font-medium">{option.label}</span>
            </label>
            {option.description === undefined ? null : (
              <p className="ms-7 text-sm text-muted-foreground">{option.description}</p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

function sizeText(t: Translator, picture: Pick<BannerPicture, "width" | "height">): string {
  return t("banners.picture.size", { width: picture.width, height: picture.height });
}

/** A small picture with its real size and, when it is not 2:1, the crop warning (text, never colour alone). */
function PictureFacts({ t, picture }: { t: Translator; picture: BannerPicture }) {
  const source = safeHttpUrl(picture.url);
  const ratioOk = hasBannerRatio(picture);
  return (
    <div className="flex flex-wrap items-start gap-4">
      {source === null ? null : (
        <img
          src={source}
          alt=""
          width={picture.width}
          height={picture.height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="aspect-2/1 w-40 rounded-md border border-border bg-muted object-cover"
        />
      )}
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-foreground">{sizeText(t, picture)}</p>
        {ratioOk ? (
          <p className="text-muted-foreground">{t("banners.picture.ratioOk")}</p>
        ) : (
          <p className="font-medium text-warning">{t("banners.picture.ratioOff")}</p>
        )}
      </div>
    </div>
  );
}

/** One picture slot: the default picture (required) or a locale's own picture (optional, removable). */
function PictureSlotView({
  t,
  uiLocale,
  slot,
  picture,
  error,
  canWrite,
  upload,
  onRemove,
}: {
  t: Translator;
  uiLocale: string;
  slot: PictureSlot;
  picture: BannerPicture | null;
  error: MessageDescriptor | undefined;
  canWrite: boolean;
  upload: BannerUploadView;
  onRemove: () => void;
}) {
  const field = pictureField(slot);
  const id = `banner-${field.replace(".", "-")}`;
  const language = slot === null ? "" : languageName(slot, uiLocale);
  const heading =
    slot === null
      ? t("banners.picture.defaultHeading")
      : t("banners.picture.localeHeading", { language });
  const controls = upload.controlsFor(slot);
  const errorId = `${id}-error`;
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border p-4"
      role="group"
      aria-labelledby={`${id}-heading`}
      aria-describedby={error === undefined ? undefined : errorId}
    >
      <h3 id={`${id}-heading`} className="font-semibold text-foreground">
        {heading}
      </h3>
      {picture === null ? (
        <p className="text-sm text-muted-foreground">
          {slot === null ? t("banners.picture.none") : t("banners.picture.usesDefault")}
        </p>
      ) : (
        <PictureFacts t={t} picture={picture} />
      )}
      {canWrite && upload.uploadsEnabled ? (
        <div className="flex flex-wrap items-start gap-3">
          <UploadPanel
            t={t}
            id={`${id}-upload`}
            label={
              picture === null
                ? slot === null
                  ? t("banners.picture.upload")
                  : t("banners.picture.uploadLocale", { language })
                : slot === null
                  ? t("banners.picture.replace")
                  : t("banners.picture.replaceLocale", { language })
            }
            multiple={false}
            controls={controls}
          />
          {slot !== null && picture !== null ? (
            <Button variant="secondary" onClick={onRemove} disabled={upload.running}>
              {t("banners.picture.removeLocale", { language })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          {describe(t, error)}
        </p>
      )}
    </div>
  );
}

/** A text of one locale with its live length ("12 of 80 characters"). */
function LocaleText({
  t,
  id,
  label,
  value,
  limit,
  required,
  multiline,
  readOnly,
  error,
  locale,
  extraHint,
  onChange,
}: {
  t: Translator;
  id: string;
  label: string;
  value: string;
  limit: number;
  required: boolean;
  multiline: boolean;
  readOnly: boolean;
  error: MessageDescriptor | undefined;
  locale: string;
  extraHint?: string;
  onChange: (value: string) => void;
}) {
  const count = t("banners.form.count", { length: codePointLength(value.trim()), limit });
  return (
    <Field
      id={id}
      label={label}
      hint={extraHint === undefined ? count : `${extraHint} ${count}`}
      error={error === undefined ? undefined : describe(t, error)}
      required={required}
      requiredIndicator={t("dict.form.requiredMark")}
    >
      {(control) =>
        multiline ? (
          <Textarea
            {...control}
            lang={locale}
            rows={3}
            readOnly={readOnly}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            {...control}
            lang={locale}
            readOnly={readOnly}
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </Field>
  );
}

/**
 * The banner form, create and edit (plan D5 and section 7): layout, pictures (a default and one per content locale), one
 * fieldset of texts per content locale, link, tone, the active switch and the window, with the live preview beside it.
 * Read-only without write permission. While a picture uploads, Save is disabled.
 */
export function BannerFormView({
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
  cancelTo,
  upload,
  zone,
  warnings,
  preview,
}: BannerFormViewProps) {
  const readOnly = !canWrite;
  const card = values.layout === "card";
  const usingDefault = localesUsingDefault(values, content.locales);
  const set = (patch: Partial<BannerFormValues>) => onChange({ ...values, ...patch });
  const setText = (field: "title" | "text" | "imageAlt", locale: string, text: string) =>
    onChange({ ...values, [field]: { ...values[field], [locale]: text } });
  const ended = warnings.some((warning) => warning.kind === "ended");
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      {/* The form checks itself (the picture slots are no native fields): one translated summary, no browser bubble. */}
      <form method="post" onSubmit={onSubmit} className="flex min-w-0 flex-col gap-8" noValidate>
        <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
        <RadioGroup
          id="banner-layout"
          legend={t("banners.form.layout")}
          value={values.layout}
          readOnly={readOnly}
          onChange={(layout) => set({ layout })}
          options={[
            {
              value: "card",
              label: t("banners.layout.card"),
              description: t("banners.form.layoutCardHint"),
            },
            {
              value: "image",
              label: t("banners.layout.image"),
              description: t("banners.form.layoutImageHint"),
            },
          ]}
        />
        {card ? null : (
          <Alert variant="warning" title={t("banners.form.imageTextTitle")}>
            <p>{t("banners.form.imageTextBody")}</p>
          </Alert>
        )}

        <section aria-labelledby="banner-pictures-heading" className="flex flex-col gap-4">
          <h2 id="banner-pictures-heading" className="text-lg font-semibold text-foreground">
            {t("banners.picture.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("banners.picture.hint")}</p>
          {canWrite && upload.uploadsEnabled ? (
            <p className="text-sm text-muted-foreground">
              {t("banners.picture.limits", limitValues(upload.controlsFor(null).limits, 1))}
            </p>
          ) : canWrite ? (
            <Alert variant="warning" title={t("banners.picture.uploadsOffTitle")}>
              <p>
                {t(
                  mode === "create"
                    ? "banners.picture.uploadsOffCreate"
                    : "banners.picture.uploadsOffEdit",
                )}
              </p>
            </Alert>
          ) : null}
          <PictureSlotView
            t={t}
            uiLocale={uiLocale}
            slot={null}
            picture={values.picture}
            error={issues[pictureField(null)]}
            canWrite={canWrite}
            upload={upload}
            onRemove={() => undefined}
          />
          {content.locales.map((locale) => (
            <PictureSlotView
              key={locale}
              t={t}
              uiLocale={uiLocale}
              slot={locale}
              picture={values.localePictures[locale] ?? null}
              error={issues[pictureField(locale)]}
              canWrite={canWrite}
              upload={upload}
              onRemove={() =>
                set({
                  localePictures: Object.fromEntries(
                    Object.entries(values.localePictures).filter(([code]) => code !== locale),
                  ),
                })
              }
            />
          ))}
          <p className="text-sm text-muted-foreground">
            {usingDefault.length === 0
              ? t("banners.picture.noLocaleUsesDefault")
              : t("banners.picture.localesUsingDefault", {
                  languages: usingDefault.map((code) => languageName(code, uiLocale)).join(", "),
                })}
          </p>
        </section>

        {content.locales.map((locale) => {
          const language = languageName(locale, uiLocale);
          const isDefault = locale === content.defaultLocale;
          const requiredHere = isDefault || values.isActive;
          return (
            <fieldset key={locale} className="flex flex-col gap-4">
              <legend className="mb-1 text-lg font-semibold text-foreground">
                {isDefault
                  ? t("banners.form.languageDefault", { language })
                  : t("banners.form.language", { language })}
              </legend>
              {card ? (
                <>
                  <LocaleText
                    t={t}
                    id={`banner-title-${locale}`}
                    label={t("banners.form.title", { language })}
                    value={values.title[locale] ?? ""}
                    limit={BANNER_LIMITS.titleMaxLength}
                    required={requiredHere}
                    multiline={false}
                    readOnly={readOnly}
                    error={issues[`title.${locale}`]}
                    locale={locale}
                    onChange={(text) => setText("title", locale, text)}
                  />
                  <LocaleText
                    t={t}
                    id={`banner-text-${locale}`}
                    label={t("banners.form.text", { language })}
                    value={values.text[locale] ?? ""}
                    limit={BANNER_LIMITS.textMaxLength}
                    required={false}
                    multiline
                    readOnly={readOnly}
                    error={issues[`text.${locale}`]}
                    locale={locale}
                    onChange={(text) => setText("text", locale, text)}
                  />
                </>
              ) : null}
              <LocaleText
                t={t}
                id={`banner-imageAlt-${locale}`}
                label={
                  card
                    ? t("banners.form.altCard", { language })
                    : t("banners.form.altImage", { language })
                }
                extraHint={card ? t("banners.form.altCardHint") : t("banners.form.altImageHint")}
                value={values.imageAlt[locale] ?? ""}
                limit={BANNER_LIMITS.imageAltMaxLength}
                required={!card && requiredHere}
                multiline={!card}
                readOnly={readOnly}
                error={issues[`imageAlt.${locale}`]}
                locale={locale}
                onChange={(text) => setText("imageAlt", locale, text)}
              />
            </fieldset>
          );
        })}

        <div className="flex flex-col gap-2">
          <TextField
            t={t}
            id="banner-link"
            name="link"
            label={t("banners.form.link")}
            hint={t("banners.form.linkHint")}
            value={values.link}
            readOnly={readOnly}
            required
            maxLength={BANNER_LIMITS.linkMaxLength}
            autoComplete="off"
            error={issues["link"]}
            onChange={(link) => set({ link })}
          />
          {/^https:/i.test(values.link.trim()) ? (
            <p className="text-sm text-muted-foreground">{t("banners.form.linkExternal")}</p>
          ) : null}
        </div>

        {card ? (
          <RadioGroup
            id="banner-tone"
            legend={t("banners.form.tone")}
            value={values.tone}
            readOnly={readOnly}
            onChange={(tone) => set({ tone })}
            options={[
              { value: "surface", label: t("banners.tone.surface") },
              { value: "accent", label: t("banners.tone.accent") },
            ]}
          />
        ) : null}

        <section aria-labelledby="banner-schedule-heading" className="flex flex-col gap-4">
          <h2 id="banner-schedule-heading" className="text-lg font-semibold text-foreground">
            {t("banners.form.scheduleHeading")}
          </h2>
          <div className="flex flex-col gap-1">
            <Checkbox
              id="banner-isActive"
              name="isActive"
              label={t("banners.form.active")}
              checked={values.isActive}
              disabled={readOnly}
              aria-describedby="banner-isActive-hint"
              onChange={(event) => set({ isActive: event.target.checked })}
            />
            <p id="banner-isActive-hint" className="text-sm text-muted-foreground">
              {t(card ? "banners.form.activeHintCard" : "banners.form.activeHintImage")}
            </p>
            {issues["isActive"] === undefined ? null : (
              <p className="text-sm text-danger">{describe(t, issues["isActive"])}</p>
            )}
          </div>
          <p id="banner-zone" className="text-sm text-muted-foreground">
            {t("banners.form.zone", { zone })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["startsAt", "endsAt"] as const).map((field) => (
              <Field
                key={field}
                id={`banner-${field}`}
                label={t(field === "startsAt" ? "banners.form.startsAt" : "banners.form.endsAt")}
                hint={t(
                  field === "startsAt" ? "banners.form.startsAtHint" : "banners.form.endsAtHint",
                )}
                error={issues[field] === undefined ? undefined : describe(t, issues[field])}
              >
                {(control) => (
                  <Input
                    {...control}
                    aria-describedby={`${control["aria-describedby"] ?? ""} banner-zone`.trim()}
                    type="datetime-local"
                    name={field}
                    value={values[field]}
                    readOnly={readOnly}
                    onChange={(event) => set({ [field]: event.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
          {ended ? (
            <p className="text-sm font-medium text-warning">{t("banners.form.endedWarning")}</p>
          ) : null}
        </section>

        {canWrite ? (
          <FormActions
            t={t}
            busy={busy}
            locked={upload.running}
            submitLabel={t(mode === "create" ? "banners.form.create" : "dict.form.save")}
            busyLabel={t("dict.form.saving")}
            cancelTo={cancelTo}
            cancelLabel={t("banners.backToList")}
          />
        ) : null}
      </form>
      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">{preview}</div>
    </div>
  );
}
