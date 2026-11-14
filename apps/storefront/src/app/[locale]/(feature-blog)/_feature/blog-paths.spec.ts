import { describe, expect, it } from "vitest";
import {
  BLOG_MAX_PAGE,
  blogListPath,
  blogPostPath,
  isPostSlug,
  normalizeBlogPage,
} from "./blog-paths";
import { documentText, wordCount } from "./blog-text";
import { post } from "./blog-fixtures";

describe("blog paths", () => {
  it("writes the list without ?page=1 and with ?page=N after it", () => {
    expect(blogListPath(1)).toBe("/blog");
    expect(blogListPath(3)).toBe("/blog?page=3");
    expect(() => blogListPath(0)).toThrow(RangeError);
    expect(() => blogListPath(1.5)).toThrow(RangeError);
    expect(blogPostPath("spring-care")).toBe("/blog/spring-care");
  });

  it("knows a slug by the API's rule and nothing else", () => {
    expect(isPostSlug("spring-care-2")).toBe(true);
    for (const value of ["", "Spring", "a--b", "-a", "a-", "a_b", "../x", "%2e", "a".repeat(161)]) {
      expect(isPostSlug(value), value).toBe(false);
    }
    expect(isPostSlug("a".repeat(160))).toBe(true);
  });

  it("repairs a bad page to the address it redirects to, and keeps a good one", () => {
    expect(BLOG_MAX_PAGE).toBe(834);
    expect(normalizeBlogPage({})).toEqual({ page: 1, canonical: true });
    expect(normalizeBlogPage({ page: "2" })).toEqual({ page: 2, canonical: true });
    expect(normalizeBlogPage({ utm_source: "x" })).toEqual({ page: 1, canonical: true });
    for (const [raw, page] of [
      ["1", 1],
      ["0", 1],
      ["02", 2],
      ["-3", 1],
      ["two", 1],
      ["", 1],
      ["99999", BLOG_MAX_PAGE],
    ] as const) {
      expect(normalizeBlogPage({ page: raw }), raw).toEqual({ page, canonical: false });
    }
    expect(normalizeBlogPage({ page: ["2", "3"] })).toEqual({ page: 2, canonical: false });
  });
});

describe("the words of a post", () => {
  it("joins the blocks with a blank line, without markup, and counts the words", () => {
    const text = documentText(post.content);
    expect(text).toBe("Washing\n\nWash it cold. See the catalog.\n\nDry flat\n\n30 °C");
    expect(wordCount(text)).toBe(11);
    expect(wordCount("")).toBe(0);
    expect(wordCount("Привіт, світе — 2026!")).toBe(3);
  });
});
