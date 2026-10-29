import { SEARCH_LIMITS } from "../limits.js";
import { stemEnglish } from "./snowball/english.generated.js";
import { stemUkrainian } from "./snowball/ukrainian.generated.js";

/** Languages with a Snowball stemmer in this package. Other locales are searched on the original words only. */
export type StemLanguage = "uk" | "en";

/** `uk` and `uk-UA` use the Ukrainian stemmer, `en` the English one; every other locale has none. */
export function stemLanguageOf(locale: string): StemLanguage | null {
  const base = locale.toLowerCase().split("-")[0];
  return base === "uk" || base === "en" ? base : null;
}

// Tokens come from `normalizeSearchWords`: lower case, apostrophes already one form. A stemmer only sees the script it was
// written for; Latin words in a Ukrainian title, digits and codes stay as they are.
const CYRILLIC_TOKEN = /^[Ѐ-ӿ']+$/;
const LATIN_TOKEN = /^[a-z']+$/;

/** The Snowball stem of one token, or the token itself when its script does not fit the language. */
export function stemToken(token: string, language: StemLanguage): string {
  if (language === "uk") {
    return CYRILLIC_TOKEN.test(token) ? stemUkrainian(token) : token;
  }
  return LATIN_TOKEN.test(token) ? stemEnglish(token) : token;
}

export function stemTokens(tokens: readonly string[], language: StemLanguage): string[] {
  return tokens.map((token) => stemToken(token, language));
}

/**
 * The first five letters of a Cyrillic token (shorter tokens stay whole). Together with the Snowball stem it covers
 * forms the stemmer treats differently, such as `сорочка` and `сорочці` (spike S1, ADR 0033 decision 6).
 */
export function prefixToken(token: string): string {
  return CYRILLIC_TOKEN.test(token) ? token.slice(0, SEARCH_LIMITS.prefixStemLength) : token;
}
