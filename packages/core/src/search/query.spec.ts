import { describe, expect, it } from "vitest";
import { SEARCH_LIMITS, parseSearchQuery, planTextQueries } from "./index.js";
import type { NormalizedSearchQuery } from "./index.js";

function parsed(raw: string): NormalizedSearchQuery {
  const result = parseSearchQuery(raw);
  if (!result.ok) {
    throw new Error(`expected a valid query, got ${result.reason}`);
  }
  return result.query;
}

describe("parseSearchQuery", () => {
  it("normalizes case, unicode form and whitespace", () => {
    expect(parsed("  СОРОЧКА\t  Чоловіча \n")).toEqual({
      text: "сорочка чоловіча",
      words: ["сорочка", "чоловіча"],
    });
    // "и" + combining breve is composed to "й" (NFC), so both spellings find the same words
    expect(parsed("й").words).toEqual(["й"]);
  });

  it("maps every apostrophe variant to one form", () => {
    for (const apostrophe of ["'", "ʼ", "’", "`", "′", "`"]) {
      expect(parsed(`м${apostrophe}ясо`).words).toEqual(["м'ясо"]);
    }
  });

  it("splits on hyphens and punctuation, keeps inner apostrophes and digits, drops outer apostrophes", () => {
    expect(parsed("T-shirt (XL), 500г!").words).toEqual(["t", "shirt", "xl", "500г"]);
    expect(parsed("'hello' it's").words).toEqual(["hello", "it's"]);
  });

  it("treats an empty query as a browse request", () => {
    expect(parsed("   ")).toEqual({ text: "", words: [] });
  });

  it("keeps at most the first ten words (the engine ignores later ones)", () => {
    const query = parsed("a b c d e f g h i j k l");
    expect(query.words).toHaveLength(SEARCH_LIMITS.maxQueryWords);
    expect(query.words.at(-1)).toBe("j");
  });

  it("refuses more than 200 characters, counted in code points", () => {
    expect(parseSearchQuery("я".repeat(200)).ok).toBe(true);
    expect(parseSearchQuery("😀".repeat(200)).ok).toBe(true);
    expect(parseSearchQuery("я".repeat(201))).toEqual({ ok: false, reason: "too_long" });
    expect(parseSearchQuery("😀".repeat(201))).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses control characters but accepts tab and newline as whitespace", () => {
    for (const bad of ["a\u0000b", "a\u0007b", "a\u007fb", "a\u0085b", "a\u009fb"]) {
      expect(parseSearchQuery(bad)).toEqual({ ok: false, reason: "control_characters" });
    }
    expect(parseSearchQuery("a\tb\nc\rd").ok).toBe(true);
  });

  it("refuses anything that is not a string", () => {
    expect(parseSearchQuery(42)).toEqual({ ok: false, reason: "not_a_string" });
    expect(parseSearchQuery(undefined)).toEqual({ ok: false, reason: "not_a_string" });
    expect(parseSearchQuery(["a"])).toEqual({ ok: false, reason: "not_a_string" });
  });
});

describe("planTextQueries", () => {
  it("results page, Ukrainian: original words, Snowball stems and 5-letter prefixes, each with a trailing space", () => {
    expect(planTextQueries(parsed("Сорочці чоловічі"), "uk", "results")).toEqual([
      { role: "original", q: "сорочці чоловічі " },
      { role: "stems", q: "сорочц чоловіч ", attributesToSearchOn: ["stems"] },
      { role: "prefixes", q: "сороч чолов ", attributesToSearchOn: ["stems5"] },
    ]);
  });

  it("keeps Latin words as they are in the Ukrainian stems and prefixes", () => {
    expect(planTextQueries(parsed("футболка Basic"), "uk", "results")).toEqual([
      { role: "original", q: "футболка basic " },
      { role: "stems", q: "футболк basic ", attributesToSearchOn: ["stems"] },
      { role: "prefixes", q: "футбо basic ", attributesToSearchOn: ["stems5"] },
    ]);
  });

  it("results page, English: original and English stems, no prefixes", () => {
    expect(planTextQueries(parsed("Jackets"), "en", "results")).toEqual([
      { role: "original", q: "jackets " },
      { role: "stems", q: "jacket ", attributesToSearchOn: ["stems"] },
    ]);
  });

  it("a locale without a stemmer searches the original words only", () => {
    expect(planTextQueries(parsed("Jacken"), "de", "results")).toEqual([
      { role: "original", q: "jacken " },
    ]);
  });

  it("skips the stem queries when no word can be stemmed (codes, numbers)", () => {
    expect(planTextQueries(parsed("X200 PH2"), "uk", "results")).toEqual([
      { role: "original", q: "x200 ph2 " },
    ]);
  });

  it("suggest: the words as typed on the text fields only, without a trailing space and without stems", () => {
    expect(planTextQueries(parsed("Сорочк"), "uk", "suggest")).toEqual([
      { role: "original", q: "сорочк", attributesToSearchOn: ["title", "brandName", "sku"] },
    ]);
  });

  it("relaxed pass (ADR 0037): the original words end without the space, so the last word is prefix-matched; stems and prefixes keep it", () => {
    expect(planTextQueries(parsed("Сорочці чоловічі"), "uk", "relaxed")).toEqual([
      { role: "original", q: "сорочці чоловічі" },
      { role: "stems", q: "сорочц чоловіч ", attributesToSearchOn: ["stems"] },
      { role: "prefixes", q: "сороч чолов ", attributesToSearchOn: ["stems5"] },
    ]);
    expect(planTextQueries(parsed("футб"), "uk", "relaxed")).toEqual([
      { role: "original", q: "футб" },
    ]);
  });

  it("relaxed pass: as many text queries as the strict pass, so the engine request count of a pass stays (ADR 0036)", () => {
    // "screw" stems to itself: one text query in both passes, never a stems query that only differs by the space.
    expect(planTextQueries(parsed("Screw"), "en", "relaxed")).toEqual([
      { role: "original", q: "screw" },
    ]);
    for (const [text, locale] of [
      ["screw", "en"],
      ["linen shirts", "en"],
      ["X200 PH2", "uk"],
      ["Сорочці чоловічі", "uk"],
      ["футб", "uk"],
      ["Jacken", "de"],
    ] as const) {
      expect(planTextQueries(parsed(text), locale, "relaxed").length, text).toBe(
        planTextQueries(parsed(text), locale, "results").length,
      );
    }
  });

  it("a browse request has no text queries", () => {
    expect(planTextQueries(parsed(""), "uk", "results")).toEqual([]);
    expect(planTextQueries(parsed(""), "uk", "relaxed")).toEqual([]);
    expect(planTextQueries(parsed(""), "uk", "suggest")).toEqual([]);
  });
});
