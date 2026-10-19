import { defaultLocale, isLocale, type Locale } from "@fluxkit/ui";

/**
 * The UI language (owner answer 10): the browser language by default, a uk/en switch in the header remembered per
 * browser. The ONLY thing the SPA keeps in `localStorage` is this language code (no credential, nothing personal). Storage
 * can be missing or throw (private mode, blocked site data); the UI then works without remembering.
 */
export const LOCALE_STORAGE_KEY = "fluxkit.admin.uiLocale";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The first supported language of the browser's list (`navigator.languages`), else the default locale. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const short = language.slice(0, 2).toLowerCase();
    if (isLocale(short)) return short;
  }
  return defaultLocale;
}

export function readStoredLocale(getStorage: () => StorageLike): Locale | null {
  try {
    const value = getStorage().getItem(LOCALE_STORAGE_KEY);
    return value !== null && isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the choice; `false` when the browser does not allow it (the switch still works for this tab). */
export function storeLocale(getStorage: () => StorageLike, locale: Locale): boolean {
  try {
    getStorage().setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

export function initialLocale(getStorage: () => StorageLike, languages: readonly string[]): Locale {
  return readStoredLocale(getStorage) ?? detectLocale(languages);
}
