import { BannerCard, type Translator } from "@fluxkit/ui";
import { useState } from "react";
import { safeHttpUrl } from "../../lib/safe-http-url";
import type { ContentLocales } from "../catalog-dictionaries/form-parts";
import { languageName } from "../catalog-dictionaries/locale-text";
import { pictureFor, type BannerFormValues } from "./banner-form";

export type PreviewTheme = "light" | "dark";
export type PreviewDevice = "phone" | "desktop";

export interface PreviewOptions {
  locale: string;
  theme: PreviewTheme;
  device: PreviewDevice;
}

/** A text of the preview's locale, else the default locale's (the store's per-field fallback). */
function textFor(values: Readonly<Record<string, string>>, locale: string, defaultLocale: string) {
  const own = (values[locale] ?? "").trim();
  return own !== "" ? own : (values[defaultLocale] ?? "").trim();
}

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Choice<Value extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-x-4">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className="inline-flex min-h-11 items-center gap-2 text-foreground"
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className={`size-5 accent-primary ${focusClass}`}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The live preview of the form (plan section 7, "variant 2"): the storefront's own banner card (`BannerCard` of
 * `@fluxkit/ui`), per content locale, light or dark, phone or desktop width. Approximate on purpose (no storefront fonts,
 * header or neighbours; the desktop shows the card at one third of the row, as with three banners). The dark theme is
 * scoped to the preview box (`data-theme`); the admin itself stays light. The card is not a link here: a click in a
 * preview must not leave the admin.
 */
export function BannerPreviewView({
  t,
  uiLocale,
  content,
  values,
  options,
  onOptionsChange,
}: {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  values: BannerFormValues;
  options: PreviewOptions;
  onOptionsChange: (next: PreviewOptions) => void;
}) {
  const { locale, theme, device } = options;
  const picture = pictureFor(values, locale);
  const source = picture === null ? null : safeHttpUrl(picture.url);
  const alt = textFor(values.imageAlt, locale, content.defaultLocale);
  const ownPicture = values.localePictures[locale] !== undefined;
  const card = (
    <BannerCard
      id="banner-preview"
      layout={values.layout}
      tone={values.tone}
      title={textFor(values.title, locale, content.defaultLocale)}
      text={textFor(values.text, locale, content.defaultLocale)}
      headingLevel="h3"
      picture={
        source === null || picture === null ? (
          <span className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {t("banners.preview.noPicture")}
          </span>
        ) : (
          <img
            src={source}
            alt={values.layout === "image" ? alt : ""}
            width={picture.width}
            height={picture.height}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )
      }
      renderLink={({ className, children }) => <div className={className}>{children}</div>}
    />
  );
  return (
    <section aria-labelledby="banner-preview-heading" className="flex flex-col gap-4">
      <h2 id="banner-preview-heading" className="text-lg font-semibold text-foreground">
        {t("banners.preview.heading")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("banners.preview.approximate")}</p>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Choice
          name="banner-preview-locale"
          legend={t("banners.preview.language")}
          options={content.locales.map((code) => ({
            value: code,
            label: languageName(code, uiLocale),
          }))}
          value={locale}
          onChange={(next) => onOptionsChange({ ...options, locale: next })}
        />
        <Choice
          name="banner-preview-theme"
          legend={t("banners.preview.theme")}
          options={[
            { value: "light", label: t("banners.preview.light") },
            { value: "dark", label: t("banners.preview.dark") },
          ]}
          value={theme}
          onChange={(next) => onOptionsChange({ ...options, theme: next })}
        />
        <Choice
          name="banner-preview-device"
          legend={t("banners.preview.device")}
          options={[
            { value: "phone", label: t("banners.preview.phone") },
            { value: "desktop", label: t("banners.preview.desktop") },
          ]}
          value={device}
          onChange={(next) => onOptionsChange({ ...options, device: next })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t(ownPicture ? "banners.preview.ownPicture" : "banners.preview.defaultPicture", {
          language: languageName(locale, uiLocale),
        })}
      </p>
      {/* Scrolls sideways when the admin's column is narrower than a desktop row; focusable so a keyboard can scroll it. */}
      <div
        role="region"
        aria-label={t("banners.preview.frame")}
        tabIndex={0}
        data-theme={theme}
        data-preview-device={device}
        lang={locale}
        className={`overflow-x-auto rounded-lg border border-border bg-background p-4 text-foreground ${focusClass}`}
      >
        {device === "phone" ? (
          <div className="mx-auto max-w-xs">{card}</div>
        ) : (
          <div className="grid min-w-3xl grid-cols-3 gap-4">
            {card}
            <div aria-hidden="true" className="rounded-lg bg-muted" />
            <div aria-hidden="true" className="rounded-lg bg-muted" />
          </div>
        )}
      </div>
    </section>
  );
}

/** The preview with its own switches (they are not part of the banner and never make the form "unsaved"). */
export function BannerPreview({
  t,
  uiLocale,
  content,
  values,
}: {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  values: BannerFormValues;
}) {
  const [options, setOptions] = useState<PreviewOptions>(() => ({
    locale: content.locales.includes(uiLocale) ? uiLocale : content.defaultLocale,
    theme: "light",
    device: "desktop",
  }));
  return (
    <BannerPreviewView
      t={t}
      uiLocale={uiLocale}
      content={content}
      values={values}
      options={options}
      onOptionsChange={setOptions}
    />
  );
}
