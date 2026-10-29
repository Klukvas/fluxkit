import { SYNONYM_LIMITS, SYNONYM_MAX_TERM_WORDS, parseSynonymTerms } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  TERM_LIMITS,
  canSubmitTerms,
  parseTermsInput,
  sameTerms,
  termsIssueMessages,
  termsToText,
} from "./synonym-terms";

describe("limits copied from core", () => {
  it("are the API's limits (core is a dev dependency of the admin, not in the bundle)", () => {
    expect(TERM_LIMITS).toEqual({
      minTerms: SYNONYM_LIMITS.minTerms,
      maxTerms: SYNONYM_LIMITS.maxTerms,
      maxLength: SYNONYM_LIMITS.maxTermLength,
      maxWords: SYNONYM_MAX_TERM_WORDS,
    });
  });
});

describe("parseTermsInput", () => {
  it("splits on commas and line breaks, trims and drops empty pieces", () => {
    expect(parseTermsInput("викрутка, відвертка\n  screwdriver ,, \n").terms).toEqual([
      "викрутка",
      "відвертка",
      "screwdriver",
    ]);
    expect(parseTermsInput("a\r\nb,c").terms).toEqual(["a", "b", "c"]);
  });

  it("normalizes like a search query: lower case, one apostrophe form, words joined by one space", () => {
    expect(parseTermsInput("Викрутка,  Hand   DRILL, п’ять, ПʼЯТЬ").terms).toEqual([
      "викрутка",
      "hand drill",
      "п'ять",
    ]);
  });

  it("reports a term of more than three words, with the term as typed (the engine ignores such synonyms)", () => {
    const parsed = parseTermsInput("shirt, long sleeve cotton top");
    expect(parsed.invalid).toEqual([{ term: "long sleeve cotton top", reason: "too_many_words" }]);
    expect(canSubmitTerms(parsed)).toBe(false);
    // exactly three words is fine
    expect(parseTermsInput("shirt, long sleeve top").invalid).toEqual([]);
  });

  it("reports a term longer than 50 characters and a term with nothing left after normalization", () => {
    const long = "x".repeat(51);
    expect(parseTermsInput(`ok, ${long}`).invalid).toEqual([{ term: long, reason: "too_long" }]);
    expect(parseTermsInput(`${"x".repeat(50)}, y`).invalid).toEqual([]);
    expect(parseTermsInput("a, !!!").invalid).toEqual([{ term: "!!!", reason: "unusable" }]);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(parseTermsInput(`${"я".repeat(50)}, b`).invalid).toEqual([]);
    expect(parseTermsInput(`${"\u{1d4d0}".repeat(50)}, b`).invalid).toEqual([]);
  });

  it("reports control characters as unusable", () => {
    expect(parseTermsInput("a, b\u0007c").invalid).toEqual([
      { term: "b\u0007c", reason: "unusable" },
    ]);
  });

  it("finds duplicates after normalization and lists each once", () => {
    const parsed = parseTermsInput("Викрутка, викрутка ,  ВИКРУТКА, other");
    expect(parsed.duplicates).toEqual(["викрутка"]);
    expect(parsed.terms).toEqual(["викрутка", "other"]);
    expect(canSubmitTerms(parsed)).toBe(false);
  });

  it("needs 2 to 20 distinct terms", () => {
    expect(parseTermsInput("").count).toBe("too_few");
    expect(parseTermsInput("one").count).toBe("too_few");
    expect(parseTermsInput("one, two").count).toBeNull();
    const twenty = Array.from({ length: 20 }, (_, index) => `t${String(index)}`).join(",");
    expect(parseTermsInput(twenty).count).toBeNull();
    expect(parseTermsInput(`${twenty},t20`).count).toBe("too_many");
  });

  it("can be submitted only without any issue", () => {
    expect(canSubmitTerms(parseTermsInput("a, b"))).toBe(true);
    expect(canSubmitTerms(parseTermsInput("a"))).toBe(false);
    expect(canSubmitTerms(parseTermsInput("a, a"))).toBe(false);
  });

  it("agrees with core's parseSynonymTerms on what is accepted and what the terms become", () => {
    const samples = [
      "викрутка, відвертка",
      "Hand Drill, drill",
      "a, b, c",
      "one",
      "a, a",
      "shirt, long sleeve cotton top",
      `ok, ${"x".repeat(51)}`,
      "п’ять, пʼять",
      "a, !!!",
      "  ,  ",
      Array.from({ length: 21 }, (_, index) => `t${String(index)}`).join(", "),
      "Тест, тест2",
    ];
    for (const sample of samples) {
      const mine = parseTermsInput(sample);
      const core = parseSynonymTerms(
        sample
          .split(/[,\n]/)
          .map((piece) => piece.trim())
          .filter((piece) => piece !== ""),
      );
      expect(canSubmitTerms(mine), sample).toBe(core.ok);
      if (core.ok) expect(mine.terms, sample).toEqual(core.terms);
    }
  });
});

describe("termsIssueMessages", () => {
  it("is empty when the request may be sent", () => {
    expect(termsIssueMessages(parseTermsInput("a, b"))).toEqual([]);
  });

  it("names each kind of problem once, with the terms concerned", () => {
    const messages = termsIssueMessages(
      parseTermsInput("a, a, long sleeve cotton top, another long text here, !!!"),
    );
    expect(messages.map((message) => message.key)).toEqual([
      "search.synonyms.issue.too_many_words",
      "search.synonyms.issue.unusable",
      "search.synonyms.issue.duplicates",
    ]);
    expect(messages[0]?.values["terms"]).toBe('"long sleeve cotton top", "another long text here"');
    expect(messages[0]?.values["maxWords"]).toBe(3);
  });

  it("says too few and too many with the limits, and cuts a long list of terms", () => {
    expect(termsIssueMessages(parseTermsInput("one"))).toEqual([
      { key: "search.synonyms.issue.too_few", values: { min: 2 } },
    ]);
    const many = Array.from({ length: 22 }, (_, index) => `t${String(index)}`).join(",");
    expect(termsIssueMessages(parseTermsInput(many))).toEqual([
      { key: "search.synonyms.issue.too_many", values: { max: 20 } },
    ]);
    const words = Array.from({ length: 7 }, () => "a b c d").join(", ");
    expect(termsIssueMessages(parseTermsInput(`ok, ${words}`))[0]?.values["terms"]).toBe(
      '"a b c d", "a b c d", "a b c d", "a b c d", "a b c d", ...',
    );
  });
});

describe("termsToText and sameTerms", () => {
  it("shows the stored terms for editing and compares what the admin typed with them", () => {
    expect(termsToText(["викрутка", "відвертка"])).toBe("викрутка, відвертка");
    expect(sameTerms(["a", "b"], parseTermsInput("A,  b").terms)).toBe(true);
    expect(sameTerms(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameTerms(["a", "b"], ["a", "b", "c"])).toBe(false);
  });
});
