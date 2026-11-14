import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKDOWN_LIMITS, SLUG_PATTERN } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
// The API's own rules, read from the feature package's source in this spec only (the bundle never carries them).
import { BLOG_LIMITS } from "../../../../../packages/features/blog/src/rules";
import { BLOG_POST_STATES as API_STATES } from "../../../../../packages/features/blog/src/rules";
import { BLOG_POST_STATES } from "./blog-api";
import { MARKDOWN_CODES, MARKDOWN_LINK_REASONS } from "./blog-form";
import {
  BLOG_BODY_MAX_LENGTH,
  BLOG_LIST_LIMIT,
  BLOG_SLUG_MAX_LENGTH,
  BLOG_SLUG_PATTERN,
  BLOG_SLUG_PATTERN_SOURCE,
  BLOG_TEXT_LIMITS,
} from "./blog-rules";

/** The copies the form uses for early feedback are the API's values (plan section 10, the banners' parity pattern). */
describe("the blog rules the form repeats", () => {
  it("has the API's text limits, body limit and page size", () => {
    expect(BLOG_TEXT_LIMITS).toEqual({
      title: BLOG_LIMITS.titleMaxLength,
      excerpt: BLOG_LIMITS.excerptMaxLength,
      seoTitle: BLOG_LIMITS.seoTitleMaxLength,
      seoDescription: BLOG_LIMITS.seoDescriptionMaxLength,
      coverAlt: BLOG_LIMITS.coverAltMaxLength,
    });
    expect(BLOG_BODY_MAX_LENGTH).toBe(BLOG_LIMITS.bodyMaxLength);
    expect(BLOG_BODY_MAX_LENGTH).toBe(MARKDOWN_LIMITS.maxLength);
    expect(BLOG_LIST_LIMIT).toBe(BLOG_LIMITS.adminDefaultPageSize);
  });

  it("has core's slug pattern, as a regular expression and as the native pattern attribute", () => {
    expect(BLOG_SLUG_PATTERN.source).toBe(SLUG_PATTERN.source);
    expect(BLOG_SLUG_PATTERN_SOURCE).toBe(SLUG_PATTERN.source.replace(/^\^|\$$/g, ""));
    expect(BLOG_SLUG_MAX_LENGTH).toBe(160);
  });

  it("filters by the API's states", () => {
    expect([...BLOG_POST_STATES]).toEqual([...API_STATES]);
  });

  it("knows every Markdown error code and link reason of core (the unions in core's source)", () => {
    const core = join(import.meta.dirname, "../../../../../packages/core/src/content");
    const union = (file: string, name: string): string[] => {
      const text = readFileSync(join(core, file), "utf8");
      const start = text.indexOf(`export type ${name} =`);
      const body = text.slice(start, text.indexOf(";\n", start));
      return [...body.matchAll(/\|\s*"([a-z_]+)"/g)].map((match) => match[1] as string);
    };
    expect([...MARKDOWN_CODES].sort()).toEqual(
      union("markdown/types.ts", "MarkdownErrorCode").sort(),
    );
    expect([...MARKDOWN_LINK_REASONS].sort()).toEqual(
      [
        ...union("banner-link.ts", "BannerLinkRefusal"),
        ...union("markdown/types.ts", "MarkdownLinkRefusal"),
      ].sort(),
    );
  });

  it("names the codes the parser really answers", async () => {
    const { parseMarkdown } = await import("@fluxkit/core");
    const heading = parseMarkdown("# Title", { locales: ["uk", "en"] });
    expect(heading.ok ? null : heading.error.code).toBe("heading_level");
    expect(MARKDOWN_CODES).toContain("heading_level");
    const link = parseMarkdown("[x](/uk/catalog)", { locales: ["uk", "en"] });
    expect(link.ok ? null : [link.error.code, link.error.reason]).toEqual([
      "link_refused",
      "locale_prefix",
    ]);
    expect(MARKDOWN_LINK_REASONS).toContain("locale_prefix");
  });
});
