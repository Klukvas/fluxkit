import { describe, expect, it } from "vitest";
import { markdownViewHref } from "./markdown-view-href";

/** The render-time link check on hand-built links (a document that did not come from core's parser). */
const ACCEPTED: readonly [string, "path" | "https", string, string][] = [
  ["a path", "path", "/catalog", "/uk/catalog"],
  ["the root", "path", "/", "/uk"],
  ["a query and a fragment", "path", "/search?q=a.b#top", "/uk/search?q=a.b#top"],
  ["a segment that only starts like a locale", "path", "/ukraine/x", "/uk/ukraine/x"],
  ["two dots inside a segment", "path", "/products/a..b", "/uk/products/a..b"],
  ["an encoded space", "path", "/a%20b", "/uk/a%20b"],
  ["an https address", "https", "https://example.com/a?b=1", "https://example.com/a?b=1"],
];

const REFUSED: readonly [string, "path" | "https", string][] = [
  ["protocol-relative", "path", "//evil.test/x"],
  ["a dot-dot segment", "path", "/a/../b"],
  ["a dot segment", "path", "/./b"],
  ["a trailing dot-dot", "path", "/a/.."],
  ["a dot-dot before a query", "path", "/a/..?x"],
  ["an encoded dot-dot", "path", "/%2e%2e/x"],
  ["a mixed encoded dot-dot", "path", "/.%2E/x"],
  ["the shopper's locale again", "path", "/uk/x"],
  ["another shop locale", "path", "/en/x"],
  ["a locale in upper case", "path", "/EN"],
  ["a soft hyphen in a host", "https", "https://exa­mple.com"],
  ["a zero-width space", "path", "/a​"],
  ["a zero-width joiner", "path", "/a‍"],
  ["a word joiner", "path", "/a⁠"],
  ["a BOM", "https", "https://example.com/﻿"],
  ["a Mongolian vowel separator", "path", "/a᠎"],
  ["an encoded soft hyphen", "https", "https://exa%C2%ADmple.com"],
  ["an encoded zero-width space", "path", "/a%E2%80%8B"],
  ["an encoded word joiner", "path", "/a%e2%81%a0"],
  ["an encoded BOM", "path", "/a%EF%BB%BF"],
  ["an encoded Mongolian vowel separator", "path", "/a%E1%A0%8E"],
];

describe("markdownViewHref", () => {
  it.each(ACCEPTED)("links %s", (_name, kind, href, expected) => {
    expect(markdownViewHref(kind, href, "/uk")).toBe(expected);
  });

  it.each(REFUSED)("refuses %s", (_name, kind, href) => {
    expect(markdownViewHref(kind, href, "/uk")).toBeNull();
  });

  it("refuses the prefix's own locale even when the library does not list it", () => {
    expect(markdownViewHref("path", "/de/x", "/de")).toBeNull();
    expect(markdownViewHref("path", "/de/x", "/uk")).toBe("/uk/de/x");
  });
});
