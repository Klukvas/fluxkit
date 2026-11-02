import { describe, expect, it } from "vitest";
import { HELP_LIBRARY } from "./content";
import type { HelpArticle, HelpLibrary } from "./help-model";
import {
  MAX_QUERY_WORDS,
  buildSearchIndex,
  normalizeForSearch,
  queryWords,
  searchArticles,
} from "./help-search";

function article(id: string, title: string, body: string, keywords: string[] = []): HelpArticle {
  return {
    id,
    topic: "t",
    title: { uk: title, en: title },
    summary: { uk: "-", en: "-" },
    keywords: { uk: keywords, en: [] },
    blocks: [{ kind: "paragraph", text: { uk: body, en: body } }],
  };
}

const sample: HelpLibrary = {
  topics: [{ id: "t", title: { uk: "Т", en: "T" } }],
  articles: [
    article("body-only", "Alpha", "the refund button"),
    article("title", "Refund", "nothing else"),
    article("keyword", "Gamma", "other text", ["refund"]),
    article("apostrophe", "Мʼясо", "товари"),
  ],
};
const sampleIndex = buildSearchIndex(sample);
const ids = (query: string) => searchArticles(sampleIndex, query).map((entry) => entry.id);

describe("normalizeForSearch", () => {
  it("ignores case, marks and apostrophe forms, and turns punctuation into spaces", () => {
    expect(normalizeForSearch("ЇЖАК Ґанок")).toBe("іжак ґанок");
    expect(normalizeForSearch("Café, crème!")).toBe("cafe creme");
    expect(normalizeForSearch("м'ясо м’ясо мʼясо")).toBe("мясо мясо мясо");
    expect(normalizeForSearch("  t-shirt\n(tee)  ")).toBe("t shirt tee");
  });
});

describe("queryWords", () => {
  it("splits, deduplicates and caps the words", () => {
    expect(queryWords("Price  price, Ціна")).toEqual(["price", "ціна"]);
    expect(queryWords("   ")).toEqual([]);
    expect(
      queryWords(Array.from({ length: 20 }, (_, i) => `w${String(i)}`).join(" ")),
    ).toHaveLength(MAX_QUERY_WORDS);
  });
});

describe("searchArticles", () => {
  it("finds nothing for an empty query", () => {
    expect(ids("")).toEqual([]);
  });

  it("ranks a title match above a keyword match above a body match", () => {
    expect(ids("refund")).toEqual(["title", "keyword", "body-only"]);
  });

  it("needs every word to match somewhere", () => {
    expect(ids("refund button")).toEqual(["body-only"]);
    expect(ids("refund unicorn")).toEqual([]);
  });

  it("matches inside words and without apostrophes or case", () => {
    expect(ids("REFUN")).toEqual(["title", "keyword", "body-only"]);
    expect(ids("мясо")).toEqual(["apostrophe"]);
    expect(ids("м'ясо")).toEqual(["apostrophe"]);
  });
});

describe("the real library", () => {
  const index = buildSearchIndex(HELP_LIBRARY);
  const first = (query: string) => searchArticles(index, query)[0]?.id;

  it("finds the articles a shop manager looks for, in Ukrainian and in English", () => {
    expect(first("повернення коштів")).toBe("payments");
    expect(first("refund")).toBe("payments");
    expect(first("стара ціна")).toBe("prices");
    expect(first("compare-at")).toBe("prices");
    expect(first("синоніми")).toBe("search");
    expect(first("synonyms")).toBe("search");
    expect(first("нова пошта")).toBe("shipping");
    expect(first("Nova Post")).toBe("shipping");
    expect(first("резерв")).toBeDefined();
  });

  it("finds an English word typed in the Ukrainian UI (both languages are searched)", () => {
    const results = searchArticles(index, "audit").map((entry) => entry.id);
    expect(results[0]).toBe("audit-log");
  });
});
