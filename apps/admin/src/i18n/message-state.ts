import type { Locale, Messages } from "@fluxkit/ui";
import type { LazyFile } from "../messages";

/**
 * Which lazy message files are loaded, per UI language. Pure helpers for `i18n-context.tsx`, tested without React: an area
 * renders when its files are loaded for the shown language, and a language switch first loads, for the new language, every
 * file the current one has (so a visible area keeps its state and never shows a missing key).
 */
export type LoadedFiles = Readonly<Record<Locale, Readonly<Partial<Record<LazyFile, Messages>>>>>;

export const NO_FILES: LoadedFiles = { uk: {}, en: {} };

/** The files of `wanted` that are not loaded for `locale`, in the given order. */
export function missingFiles(
  loaded: LoadedFiles,
  locale: Locale,
  wanted: readonly LazyFile[],
): LazyFile[] {
  return wanted.filter((file) => loaded[locale][file] === undefined);
}

/** The files loaded for `locale`. */
export function filesOf(loaded: LoadedFiles, locale: Locale): LazyFile[] {
  return Object.keys(loaded[locale]) as LazyFile[];
}

/** A copy of `loaded` with the given files of one locale added (nothing is mutated). */
export function withFiles(
  loaded: LoadedFiles,
  locale: Locale,
  files: Readonly<Partial<Record<LazyFile, Messages>>>,
): LoadedFiles {
  return { ...loaded, [locale]: { ...loaded[locale], ...files } };
}

/** What a switch from `from` to `to` must load first: the files `from` shows that `to` does not have yet. */
export function filesForSwitch(loaded: LoadedFiles, from: Locale, to: Locale): LazyFile[] {
  return missingFiles(loaded, to, filesOf(loaded, from));
}
