import type { LocalizedText } from "@fluxkit/api-client";

/**
 * Helpers for locale maps (`name`, `label`, `description`; plan, "Forms and validation"). The content locales come from
 * `GET /admin/config`, not from the UI language. A form holds one string per configured locale; the request body holds
 * only the locales that have text (an empty optional locale is omitted, the default locale is required).
 */
export type LocaleValues = Record<string, string>;

/** One string per configured locale; a stored locale that is no longer configured is left out. */
export function localeValuesFrom(
  map: LocalizedText | null | undefined,
  locales: readonly string[],
): LocaleValues {
  const values: LocaleValues = {};
  for (const locale of locales) values[locale] = map?.[locale] ?? "";
  return values;
}

/** The request map: trimmed, blank locales omitted, only configured locales, in the configured order. */
export function localeMapFromValues(
  values: Readonly<Record<string, string | undefined>>,
  locales: readonly string[],
): LocalizedText {
  const map: LocalizedText = {};
  for (const locale of locales) {
    const text = (values[locale] ?? "").trim();
    if (text !== "") map[locale] = text;
  }
  return map;
}

/** The map of an optional text, or `undefined` when no locale has text. */
export function optionalLocaleMap(
  values: Readonly<Record<string, string | undefined>>,
  locales: readonly string[],
): LocalizedText | undefined {
  const map = localeMapFromValues(values, locales);
  return Object.keys(map).length === 0 ? undefined : map;
}

export function hasDefaultLocale(
  values: Readonly<Record<string, string | undefined>>,
  defaultLocale: string,
): boolean {
  return (values[defaultLocale] ?? "").trim() !== "";
}

/** The field names of one locale map, equal to the `errors[].path` the API answers (`name.uk`). */
export function localeFieldNames(field: string, locales: readonly string[]): string[] {
  return locales.map((locale) => `${field}.${locale}`);
}

/**
 * The text of a locale map for display (lists, pickers): the preferred locale, else the default locale, else the first
 * non-empty one by locale code (the store's per-field fallback, ADR 0025). `""` when there is none.
 */
export function resolveLocalized(
  map: LocalizedText | null | undefined,
  preferred: string,
  defaultLocale: string,
): string {
  if (map === null || map === undefined) return "";
  const first = (locale: string) =>
    map[locale] !== undefined && map[locale] !== "" ? map[locale] : undefined;
  const found =
    first(preferred) ??
    first(defaultLocale) ??
    Object.keys(map)
      .sort()
      .map(first)
      .find((text) => text !== undefined);
  return found ?? "";
}

/**
 * The name of a content locale in the UI language ("Ukrainian"), for field labels. Falls back to the code itself when the
 * browser does not know it (a malformed or unknown code makes `Intl.DisplayNames` throw a `RangeError`).
 */
export function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ?? code;
  } catch (error) {
    if (error instanceof RangeError) return code;
    throw error;
  }
}
