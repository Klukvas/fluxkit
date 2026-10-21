import { Button, locales, type Locale, type Translator } from "@fluxkit/ui";
import { useState } from "react";
import { useI18n } from "../i18n/i18n-context";

/**
 * uk/en switch: two toggle buttons; each language name is written in that language (`lang` on the button). When the other
 * language's texts of the open screen cannot be loaded, the language stays and a short message says so.
 */
export function LanguageSwitchView({
  t,
  locale,
  onChange,
  busy = false,
  loadFailed = false,
}: {
  t: Translator;
  locale: Locale;
  onChange: (locale: Locale) => void;
  busy?: boolean;
  loadFailed?: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div role="group" aria-label={t("language.label")} className="flex gap-1">
        {locales.map((option) => (
          <Button
            key={option}
            variant={option === locale ? "primary" : "secondary"}
            lang={option}
            aria-pressed={option === locale}
            // Not `disabled`: a disabled button drops the keyboard focus to the page (step 13 review, L3). While a
            // switch runs, the buttons say so and ignore activation.
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onChange(option);
            }}
            className="min-h-11 px-3 py-1 text-sm aria-disabled:opacity-50"
          >
            {t(`language.${option}`)}
          </Button>
        ))}
      </div>
      {loadFailed ? (
        <p role="alert" className="text-sm text-danger">
          {t("language.loadFailed")}
        </p>
      ) : null}
    </div>
  );
}

export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const change = (next: Locale) => {
    if (next === locale) return;
    setBusy(true);
    setLoadFailed(false);
    setLocale(next).then(
      () => setBusy(false),
      (error: unknown) => {
        // The language stays; the full error goes to the console for support.
        console.error(error);
        setBusy(false);
        setLoadFailed(true);
      },
    );
  };
  return (
    <LanguageSwitchView
      t={t}
      locale={locale}
      onChange={change}
      busy={busy}
      loadFailed={loadFailed}
    />
  );
}
