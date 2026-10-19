import { Button, locales, type Locale, type Translator } from "@fluxkit/ui";
import { useI18n } from "../i18n/i18n-context";

/** uk/en switch: two toggle buttons; each language name is written in that language (`lang` on the button). */
export function LanguageSwitchView({
  t,
  locale,
  onChange,
}: {
  t: Translator;
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <div role="group" aria-label={t("language.label")} className="flex gap-1">
      {locales.map((option) => (
        <Button
          key={option}
          variant={option === locale ? "primary" : "secondary"}
          lang={option}
          aria-pressed={option === locale}
          onClick={() => onChange(option)}
          className="min-h-11 px-3 py-1 text-sm"
        >
          {t(`language.${option}`)}
        </Button>
      ))}
    </div>
  );
}

export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n();
  return <LanguageSwitchView t={t} locale={locale} onChange={setLocale} />;
}
