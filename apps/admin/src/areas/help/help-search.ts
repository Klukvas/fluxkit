import { locales } from "@fluxkit/ui";
import { blockTexts, type HelpArticle, type HelpLibrary, type HelpText } from "./help-model";

/**
 * Client-side search over the knowledge base (plan decision 3): every word of the query must occur in the article's title,
 * keywords, summary or body, in ANY UI language (an admin may type an English word in the Ukrainian UI), case- and
 * diacritic-insensitive. The articles are a few dozen short texts, so a scan per keystroke is cheap; no index library.
 */

/** Longer queries are cut (a pasted paragraph is no search); more words than this are ignored. */
export const MAX_QUERY_LENGTH = 200;
export const MAX_QUERY_WORDS = 10;

/** Weight of a match by field: a title match ranks above a keyword, a keyword above the summary, the summary above the body. */
const WEIGHT = { title: 8, keywords: 4, summary: 2, body: 1 } as const;
type Field = keyof typeof WEIGHT;

/**
 * Lower case, marks removed after canonical decomposition (`ї` -> `і`, `é` -> `e`; `й` becomes `и`, which only widens a
 * match), apostrophe forms dropped (`м'ясо`, `м’ясо`, `мʼясо` and `мясо` are the same word), runs of other punctuation
 * and spaces turned into one space.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The words of a query, normalized, without repeats, at most `MAX_QUERY_WORDS`. */
export function queryWords(query: string): string[] {
  const words = normalizeForSearch(query.slice(0, MAX_QUERY_LENGTH))
    .split(" ")
    .filter((word) => word !== "");
  return [...new Set(words)].slice(0, MAX_QUERY_WORDS);
}

interface IndexedArticle {
  article: HelpArticle;
  order: number;
  fields: Record<Field, string>;
}

function allLanguages(texts: readonly HelpText[]): string {
  return normalizeForSearch(
    texts.flatMap((text) => locales.map((locale) => text[locale])).join(" "),
  );
}

/** Normalized text of every article, built once per library. */
export function buildSearchIndex(library: HelpLibrary): readonly IndexedArticle[] {
  return library.articles.map((article, order) => ({
    article,
    order,
    fields: {
      title: allLanguages([article.title]),
      keywords: normalizeForSearch(locales.flatMap((locale) => article.keywords[locale]).join(" ")),
      summary: allLanguages([article.summary]),
      body: allLanguages(article.blocks.flatMap(blockTexts)),
    },
  }));
}

/**
 * The articles that contain every word of the query (as the start of a word or anywhere inside one), best first: the sum
 * over the words of the best field weight each word matched in; ties keep the reading order. An empty query finds nothing.
 */
export function searchArticles(index: readonly IndexedArticle[], query: string): HelpArticle[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const scored: { article: HelpArticle; order: number; score: number }[] = [];
  for (const entry of index) {
    let score = 0;
    let all = true;
    for (const word of words) {
      let best = 0;
      for (const field of Object.keys(WEIGHT) as Field[]) {
        if (entry.fields[field].includes(word)) best = Math.max(best, WEIGHT[field]);
      }
      if (best === 0) {
        all = false;
        break;
      }
      score += best;
    }
    if (all) scored.push({ article: entry.article, order: entry.order, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.article);
}
