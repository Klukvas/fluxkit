import { Alert, Button, Checkbox, Field, Input, Textarea, type Translator } from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import { dateHint } from "../../lib/date-input-echo";
import { firstInvalidControl } from "../../lib/first-invalid";
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
  activationRequires,
  hasBannerRatio,
  localesUsingDefault,
  pictureField,
  type BannerFormValues,
  type BannerPicture,
  type BannerWarning,
} from "./banner-form";
import type { PictureSlot } from "./banner-picture-upload";
import { BANNER_LIMITS, codePointLength } from "./banner-rules";
import type { BannerPlacement } from "./banner-visibility";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** What the form needs of the picture uploads (`useBannerPictureUpload`). */
export interface BannerUploadView {
  uploadsEnabled: boolean;
  running: boolean;
  controlsFor: (slot: PictureSlot) => UploadControls;
}

/** The id of the banner form: a refused save focuses its first invalid field (`firstInvalidBannerField`). */
export const BANNER_FORM_ID = "banner-form";

/** The first field of the banner form marked invalid, looked up in the commit that marks it. */
export function firstInvalidBannerField(): HTMLElement | null {
  const form = document.getElementById(BANNER_FORM_ID);
  const found = form === null ? null : firstInvalidControl(form);
  return found instanceof HTMLElement ? found : null;
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
  /** The stored values of an edit: the activation rule asks what this save changes. */
  initial?: BannerFormValues;
  /**
   * Where the banner stands in the list (`banner-visibility.ts`): `liveNotShown` and `behindShown` of a stored banner,
   * `newBehindShown` for a new banner that will be appended after 3 live ones; `null` or absent: nothing to say.
   */
  placement?: BannerPlacement | null;
}

function RadioGroup<Value extends string>({
  id,
  legend,
  error,
  options,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  legend: string;
  /** A refusal of the server at the whole field (`layout`, `tone`). */
  error?: string;
  options: readonly { value: Value; label: string; description?: string }[];
  value: Value;
  readOnly: boolean;
  onChange: (value: Value) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error === undefined ? undefined : errorId}
    >
      <legend className="mb-1 font-semibold text-foreground">{legend}</legend>
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
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
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
      // No native field to carry `aria-invalid`: the mark lets a refused save focus this slot's control (`first-invalid.ts`).
      data-invalid={error === undefined ? undefined : "true"}
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
      {canWrite ? (
        <div className="flex flex-wrap items-start gap-3">
          {upload.uploadsEnabled ? (
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
          ) : null}
          {/* Going back to the main picture needs no upload, so it is offered with uploads switched off too. */}
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
  warning,
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
  /** Pointed out, not refused (a language missing on a banner that was already switched on). */
  warning?: string;
  onChange: (value: string) => void;
}) {
  const count = t("banners.form.count", { length: codePointLength(value.trim()), limit });
  const hint = [extraHint, count, warning].filter((part) => part !== undefined).join(" ");
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
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
  initial,
  placement,
}: BannerFormViewProps) {
  const readOnly = !canWrite;
  const card = values.layout === "card";
  const usingDefault = localesUsingDefault(values, content.locales);
  const set = (patch: Partial<BannerFormValues>) => onChange({ ...values, ...patch });
  const setText = (field: "title" | "text" | "imageAlt", locale: string, text: string) =>
    onChange({ ...values, [field]: { ...values[field], [locale]: text } });
  const ended = warnings.some((warning) => warning.kind === "ended");
  /**
   * A locale's error, and for the default locale also a refusal of the whole field (`title`, `text`, `imageAlt`), so
   * "check the marked fields" always has a marked field.
   */
  const textError = (field: "title" | "text" | "imageAlt", locale: string) =>
    issues[`${field}.${locale}`] ?? (locale === content.defaultLocale ? issues[field] : undefined);
  const missingLanguage = (path: string) =>
    warnings.some((warning) => warning.kind === "missingLanguage" && warning.path === path)
      ? t("banners.form.missingLanguage")
      : undefined;
  const whole = (field: "layout" | "tone") =>
    issues[field] === undefined ? undefined : describe(t, issues[field]);
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      {/* The form checks itself (the picture slots are no native fields): one translated summary, no browser bubble. */}
      <form
        id={BANNER_FORM_ID}
        method="post"
        onSubmit={onSubmit}
        className="flex min-w-0 flex-col gap-8"
        noValidate
      >
        <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
        <RadioGroup
          id="banner-layout"
          legend={t("banners.form.layout")}
          value={values.layout}
          error={whole("layout")}
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
          // Required by the rule that blocks the save (`activationRequires`); a mere warning never shows the mark.
          const requiredHere = isDefault || activationRequires(values, locale, initial);
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
                    error={textError("title", locale)}
                    warning={missingLanguage(`title.${locale}`)}
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
                    error={textError("text", locale)}
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
                extraHint={
                  card
                    ? t("banners.form.altCardHint")
                    : // The API needs it in the main language only; the others only to switch the banner on (plan section 7).
                      t(isDefault ? "banners.form.altImageHint" : "banners.form.altImageHintOther")
                }
                value={values.imageAlt[locale] ?? ""}
                limit={BANNER_LIMITS.imageAltMaxLength}
                required={!card && requiredHere}
                multiline={!card}
                readOnly={readOnly}
                error={textError("imageAlt", locale)}
                warning={missingLanguage(`imageAlt.${locale}`)}
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
            error={whole("tone")}
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
            {(["startsAt", "endsAt"] as const).map((field) => {
              const note = warnings.find(
                (warning) => warning.kind === "time" && warning.field === field,
              );
              const chosen = dateHint(t, values[field], uiLocale, "datetime");
              const base = [
                t(field === "startsAt" ? "banners.form.startsAtHint" : "banners.form.endsAtHint"),
                chosen,
              ]
                .filter((part) => part !== undefined)
                .join(" ");
              return (
                <Field
                  key={field}
                  id={`banner-${field}`}
                  label={t(field === "startsAt" ? "banners.form.startsAt" : "banners.form.endsAt")}
                  hint={
                    note?.kind === "time"
                      ? `${base} ${t(
                          note.note === "gap"
                            ? "banners.form.timeGap"
                            : "banners.form.timeAmbiguous",
                          { time: note.shown },
                        )}`
                      : base
                  }
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
              );
            })}
          </div>
          {ended ? (
            <p className="text-sm font-medium text-warning">{t("banners.form.endedWarning")}</p>
          ) : null}
          {placement === undefined || placement === null ? null : (
            <p className="text-sm font-medium text-warning">
              {t(`banners.form.placement.${placement}`, { shown: BANNER_LIMITS.maxShown })}
            </p>
          )}
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
