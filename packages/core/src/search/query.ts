import { SEARCH_FIELDS, SUGGEST_FIELDS } from "./fields.js";
import { SEARCH_LIMITS } from "./limits.js";
import { hasControlCharacter } from "./patterns.js";
import { prefixToken, stemLanguageOf, stemTokens } from "./stemmers/index.js";

export interface NormalizedSearchQuery {
  /** The words joined by one space; empty for a browse request. */
  readonly text: string;
  readonly words: readonly string[];
}

export type SearchQueryError = "not_a_string" | "too_long" | "control_characters";

export type ParsedSearchQuery =
  | { readonly ok: true; readonly query: NormalizedSearchQuery }
  | { readonly ok: false; readonly reason: SearchQueryError };

// Apostrophe look-alikes: grave accent, acute accent, modifier letter apostrophe and prime, right and left single
// quotation mark, prime. All become the ASCII apostrophe, the one the Ukrainian stemmer expects.
const APOSTROPHE_VARIANTS = /[`´ʹʼ‘’′]/g;
const WORD = /[\p{L}\p{N}\p{M}]+(?:'[\p{L}\p{N}\p{M}]+)*/gu;

/**
 * The words of a text as the index sees them: Unicode NFC, lower case, one apostrophe form, split on everything that is
 * not a letter, digit or mark (an apostrophe stays inside a word). Used for queries, stems and synonym terms alike.
 */
export function normalizeSearchWords(text: string): string[] {
  return text.normalize("NFC").toLowerCase().replace(APOSTROPHE_VARIANTS, "'").match(WORD) ?? [];
}

/**
 * Validates and normalizes the text a shopper typed (ADR 0034 decision 3). Refuses what does not belong in a search box
 * (not text, control characters, more than 200 characters); keeps at most the first ten words, because the engine ignores
 * later ones.
 */
export function parseSearchQuery(raw: unknown): ParsedSearchQuery {
  if (typeof raw !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  if (hasControlCharacter(raw, true)) {
    return { ok: false, reason: "control_characters" };
  }
  if ([...raw.normalize("NFC")].length > SEARCH_LIMITS.maxQueryLength) {
    return { ok: false, reason: "too_long" };
  }
  const words = normalizeSearchWords(raw).slice(0, SEARCH_LIMITS.maxQueryWords);
  return { ok: true, query: { text: words.join(" "), words } };
}

export type TextQueryRole = "original" | "stems" | "prefixes";

export interface TextQuery {
  readonly role: TextQueryRole;
  readonly q: string;
  readonly attributesToSearchOn?: readonly string[];
}

/**
 * The text queries of one search (ADR 0034 decision 3); several are merged by a federation (ADR 0036).
 *
 * Results page: the original words, the Snowball stems on `stems` and, for Ukrainian, the five-letter prefixes on
 * `stems5`. Every query ends with a space, so the last word is not prefix-matched (spike S1, E8). A stem query that would
 * read exactly like the original words is left out.
 * Suggest: the words as typed on the text fields only; a half-typed word must not be stemmed.
 */
export function planTextQueries(
  query: NormalizedSearchQuery,
  locale: string,
  mode: "results" | "suggest",
): TextQuery[] {
  if (query.words.length === 0) {
    return [];
  }
  if (mode === "suggest") {
    return [{ role: "original", q: query.text, attributesToSearchOn: SUGGEST_FIELDS }];
  }
  const original = `${query.text} `;
  const queries: TextQuery[] = [{ role: "original", q: original }];
  const language = stemLanguageOf(locale);
  if (language === null) {
    return queries;
  }
  const stems = `${stemTokens(query.words, language).join(" ")} `;
  if (stems !== original) {
    queries.push({ role: "stems", q: stems, attributesToSearchOn: [SEARCH_FIELDS.stems] });
  }
  if (language === "uk") {
    const prefixes = `${query.words.map(prefixToken).join(" ")} `;
    if (prefixes !== original) {
      queries.push({
        role: "prefixes",
        q: prefixes,
        attributesToSearchOn: [SEARCH_FIELDS.stems5],
      });
    }
  }
  return queries;
}
