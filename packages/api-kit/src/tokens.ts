/*
 * Injection tokens the API provides globally to every module, feature modules included (ADR 0049). A feature injects
 * them with `@Inject(TOKEN)`; the API module that provides each is named below.
 */

/**
 * The API's own Drizzle database (`drizzle-orm/node-postgres`, one connection pool). Typed loosely on purpose: a feature
 * declares it as `NodePgDatabase` and queries its own table objects; `db.transaction(...)` gives an ordinary Drizzle
 * transaction. Provided by `DatabaseModule`.
 */
export const FEATURE_DATABASE = Symbol("FEATURE_DATABASE");

/** The media port (`MediaPort` of `@fluxkit/core`): attach uploads by id and describe them. Provided by `MediaModule`. */
export const MEDIA_PORT = Symbol("MEDIA_PORT");

/** The locales of translated texts (`LocaleConfig`). Provided by `CommonModule`. */
export const LOCALE_CONFIG = Symbol("LOCALE_CONFIG");

/** Locales of translated texts (`DEFAULT_LOCALE`, `LOCALES`); services pass it to the core i18n functions. */
export interface LocaleConfig {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}
