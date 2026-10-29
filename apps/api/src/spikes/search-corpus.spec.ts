import { describe, expect, it } from "vitest";
import { buildCorpus, nouns } from "./search-corpus.js";

/** The corpus of spike S1 must meet the size bar of the plan (section 5): at least 300 titles in five niches and 100 queries. */
describe("spike S1 corpus", () => {
  const corpus = buildCorpus();

  it("has at least 300 distinct product titles in five niches and 100 queries", () => {
    expect(corpus.products.length).toBeGreaterThanOrEqual(300);
    expect(new Set(corpus.products.map((product) => product.title)).size).toBe(
      corpus.products.length,
    );
    const niches = new Set(
      corpus.products.map(
        (product) => nouns.find((entry) => entry.lemma === product.nounLemma)?.niche,
      ),
    );
    expect(niches.size).toBe(5);
    expect(corpus.queries.length).toBeGreaterThanOrEqual(100);
  });

  it("is deterministic", () => {
    expect(buildCorpus()).toEqual(corpus);
  });

  it("gives every query at least one relevant product", () => {
    for (const query of corpus.queries) {
      expect(query.relevant.length, `query "${query.text}" (${query.kind})`).toBeGreaterThan(0);
    }
  });

  it("covers inflected, adjective, nominative, typo, prefix, brand and partial queries", () => {
    const kinds = new Set(corpus.queries.map((query) => query.kind));
    expect([...kinds].sort()).toEqual(
      [
        "brand",
        "inflected-noun",
        "inflected-noun-adjective",
        "nominative",
        "partial",
        "prefix",
        "typo",
      ].sort(),
    );
  });

  it("keeps client data out: only invented generic words and brands", () => {
    const text = JSON.stringify(corpus.products);
    expect(text).not.toMatch(/@|https?:/);
  });
});
