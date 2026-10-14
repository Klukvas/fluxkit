export const locales = ["uk", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "uk";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export type Messages = Record<string, string>;

/**
 * Returns a translator for one locale. A missing key is a bug: it throws instead of rendering a blank or the key,
 * so untranslated text cannot reach production silently.
 */
export function createTranslator(messages: Messages): (key: string) => string {
  return (key) => {
    const value = messages[key];
    if (value === undefined) {
      throw new Error(`Missing translation key "${key}"`);
    }
    return value;
  };
}
