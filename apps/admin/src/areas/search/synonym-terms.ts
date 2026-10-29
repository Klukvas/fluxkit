/**
 * The terms input of a synonym group: one text box, terms separated by commas or line breaks. The rules are the API's
 * (`docs/api/search.md`, "Synonym terms"; core `parseSynonymTerms`, ADR 0036 decision 7), copied because core is not part
 * of the bundle; `synonym-terms.spec.ts` compares the limits and the results with core's. The API still decides: it
 * normalizes again and a `400` is shown on the field. Checking here saves a round trip and names the offending term.
 */

export const TERM_LIMITS = Object.freeze({ minTerms: 2, maxTerms: 20, maxLength: 50, maxWords: 3 });

export type InvalidTermReason = "too_many_words" | "too_long" | "unusable";

export interface InvalidTerm {
  /** As the admin typed it (trimmed). */
  term: string;
  reason: InvalidTermReason;
}

export interface ParsedTerms {
  /** Normalized, distinct, in the order typed: what would be sent. */
  terms: string[];
  invalid: InvalidTerm[];
  /** Normalized terms typed more than once, each listed once. */
  duplicates: string[];
  count: "too_few" | "too_many" | null;
}

// Same as core `normalizeSearchWords`: a word is letters, digits and marks, an apostrophe stays inside a word.
const APOSTROPHE_VARIANTS = /[`´ʹʼ‘’′]/g;
const WORD = /[\p{L}\p{N}\p{M}]+(?:'[\p{L}\p{N}\p{M}]+)*/gu;

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function normalizedWords(text: string): string[] {
  return text.normalize("NFC").toLowerCase().replace(APOSTROPHE_VARIANTS, "'").match(WORD) ?? [];
}

export function parseTermsInput(text: string): ParsedTerms {
  const terms: string[] = [];
  const invalid: InvalidTerm[] = [];
  const duplicates: string[] = [];
  let pieces = 0;
  for (const piece of text.split(/[,\r\n]/)) {
    const typed = piece.trim();
    if (typed === "") continue;
    pieces += 1;
    const words = hasControlCharacter(typed) ? [] : normalizedWords(typed);
    const term = words.join(" ");
    if (term === "") {
      invalid.push({ term: typed, reason: "unusable" });
    } else if ([...term].length > TERM_LIMITS.maxLength) {
      invalid.push({ term: typed, reason: "too_long" });
    } else if (words.length > TERM_LIMITS.maxWords) {
      invalid.push({ term: typed, reason: "too_many_words" });
    } else if (terms.includes(term)) {
      if (!duplicates.includes(term)) duplicates.push(term);
    } else {
      terms.push(term);
    }
  }
  // The API counts what was sent, before it looks at the terms: more than 20 pieces is too many whatever they are.
  const count =
    pieces > TERM_LIMITS.maxTerms
      ? "too_many"
      : terms.length < TERM_LIMITS.minTerms
        ? "too_few"
        : null;
  return { terms, invalid, duplicates, count };
}

/** Whether the request may be sent: nothing the API would refuse is left. */
export function canSubmitTerms(parsed: ParsedTerms): boolean {
  return parsed.invalid.length === 0 && parsed.duplicates.length === 0 && parsed.count === null;
}

/** A message of the `search` file with its values. */
export interface TermsMessage {
  key: string;
  values: Record<string, string | number>;
}

const SHOWN_TERMS = 5;

function listed(terms: readonly string[]): string {
  const shown = terms.slice(0, SHOWN_TERMS).map((term) => `"${term}"`);
  return terms.length > SHOWN_TERMS ? `${shown.join(", ")}, ...` : shown.join(", ");
}

/**
 * What is wrong with the typed terms, in words, one message per kind of problem and each naming the terms concerned
 * (at most five, so one long paste does not fill the field's error). Empty when the request may be sent.
 */
export function termsIssueMessages(parsed: ParsedTerms): TermsMessage[] {
  const messages: TermsMessage[] = [];
  for (const reason of ["too_many_words", "too_long", "unusable"] as const) {
    const terms = parsed.invalid
      .filter((entry) => entry.reason === reason)
      .map((entry) => entry.term);
    if (terms.length === 0) continue;
    messages.push({
      key: `search.synonyms.issue.${reason}`,
      values: {
        terms: listed(terms),
        maxWords: TERM_LIMITS.maxWords,
        maxLength: TERM_LIMITS.maxLength,
      },
    });
  }
  if (parsed.duplicates.length > 0) {
    messages.push({
      key: "search.synonyms.issue.duplicates",
      values: { terms: listed(parsed.duplicates) },
    });
  }
  // "Too few" would only repeat what the messages above already explain (a refused term is not counted).
  if (parsed.count === "too_few" && messages.length === 0) {
    messages.push({ key: "search.synonyms.issue.too_few", values: { min: TERM_LIMITS.minTerms } });
  } else if (parsed.count === "too_many") {
    messages.push({ key: "search.synonyms.issue.too_many", values: { max: TERM_LIMITS.maxTerms } });
  }
  return messages;
}

/** The stored terms as the text box shows them. */
export function termsToText(terms: readonly string[]): string {
  return terms.join(", ");
}

export function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((term, index) => term === b[index]);
}
