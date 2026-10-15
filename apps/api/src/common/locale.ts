export const LOCALE_CONFIG = Symbol("LOCALE_CONFIG");

/** Locales of translated texts (`DEFAULT_LOCALE`, `LOCALES`); services pass it to the core i18n functions. */
export interface LocaleConfig {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}
