export const locales = ["uk", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "uk";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export type Messages = Record<string, string>;

export type TranslationValues = Record<string, string | number>;

export interface Translator {
  (key: string, values?: TranslationValues): string;
  /**
   * Picks the plural form `<key>.<category>` for `count` (Intl.PluralRules of the translator's locale: Ukrainian
   * one/few/many/other, English one/other) and fills `{count}` with the count formatted for the locale.
   */
  plural: (key: string, count: number, values?: TranslationValues) => string;
}

const placeholderPattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Sorted, unique `{name}` placeholders of a message (used by message-file parity tests). */
export function messagePlaceholders(message: string): string[] {
  return [
    ...new Set([...message.matchAll(placeholderPattern)].map((match) => match[1] as string)),
  ].sort();
}

function interpolate(key: string, message: string, values: TranslationValues): string {
  // One pass over the message, so a value that looks like "{name}" is never expanded a second time.
  return message.replace(placeholderPattern, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing value "${name}" for translation key "${key}"`);
    }
    return String(value);
  });
}

/**
 * Returns a translator for one locale. A missing key or placeholder value is a bug: it throws instead of rendering
 * a blank or the key, so untranslated text cannot reach production silently. Messages are flat strings; plural forms
 * are separate keys (`cart.items.one`, `cart.items.few`, ...). Literal braces are not supported in messages.
 */
export function createTranslator(messages: Messages, locale?: Locale): Translator {
  const translate = (key: string, values: TranslationValues = {}): string => {
    const value = messages[key];
    if (value === undefined) {
      throw new Error(`Missing translation key "${key}"`);
    }
    return interpolate(key, value, values);
  };
  translate.plural = (key: string, count: number, values: TranslationValues = {}): string => {
    if (locale === undefined) {
      throw new Error(`Translator for "${key}" has no locale: pass a locale to createTranslator`);
    }
    if (!Number.isFinite(count)) {
      throw new Error(`Plural count for "${key}" must be a finite number, got ${count}`);
    }
    const category = new Intl.PluralRules(locale).select(count);
    return translate(`${key}.${category}`, {
      ...values,
      count: new Intl.NumberFormat(locale).format(count),
    });
  };
  return translate;
}
