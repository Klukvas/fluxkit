import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { BLOG_POST_STATES } from "./blog-api";
import { BLOG_REASONS, MARKDOWN_CODES, MARKDOWN_LINK_REASONS, TEXT_FIELDS } from "./blog-form";
import { MESSAGE_FILES } from "./pages";
import en from "./messages/en.json";
import uk from "./messages/uk.json";

const files = { uk: uk as Record<string, string>, en: en as Record<string, string> };
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the blog's messages", () => {
  it("have the same keys and placeholders in uk and en, all under features.blog.", () => {
    expect(Object.keys(files.uk).sort()).toEqual(Object.keys(files.en).sort());
    for (const [key, text] of Object.entries(files.en)) {
      expect(key.startsWith("features.blog."), key).toBe(true);
      expect(placeholders(files.uk[key] ?? ""), key).toEqual(placeholders(text));
    }
  });

  it("cover every key the slice's source uses, with the files its screens load", async () => {
    const visible = {
      uk: await messagesForArea("uk", MESSAGE_FILES),
      en: await messagesForArea("en", MESSAGE_FILES),
    };
    const sources = readdirSync(import.meta.dirname).filter(
      (name) => /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) && name !== "test-fixtures.ts",
    );
    const literal =
      /["'`]((?:features|dict|errors|status|action|page|nav)\.[A-Za-z0-9_.]*[A-Za-z0-9_])["'`]/g;
    let used = 0;
    for (const name of sources) {
      const text = readFileSync(join(import.meta.dirname, name), "utf8");
      for (const match of text.matchAll(literal)) {
        const key = match[1] as string;
        used += 1;
        for (const locale of ["uk", "en"] as const) {
          expect(key in visible[locale], `${name} uses "${key}" (${locale})`).toBe(true);
        }
      }
    }
    expect(used).toBeGreaterThan(50);
  });

  it("have the keys the source builds from a value", () => {
    const built = [
      ...BLOG_POST_STATES.map((state) => `features.blog.state.${state}`),
      ...TEXT_FIELDS.map((field) => `features.blog.form.${field}`),
      "features.blog.form.body",
      ...BLOG_REASONS.map((reason) => `features.blog.reason.${reason}`),
      "features.blog.reason.slug_taken",
      "features.blog.reason.translation_missing_title",
      "features.blog.reason.translation_missing_body",
      ...MARKDOWN_CODES.map((code) => `features.blog.markdown.${code}`),
      ...MARKDOWN_LINK_REASONS.map((reason) => `features.blog.markdown.link.${reason}`),
      ...["headings", "emphasis", "lists", "links", "quotes", "code", "notAllowed"].map(
        (line) => `features.blog.syntax.${line}`,
      ),
      ...["published", "scheduled", "unpublished"].map(
        (kind) => `features.blog.publish.done.${kind}`,
      ),
      ...["required", "invalid", "outOfRange"].map(
        (reason) => `features.blog.publish.when.${reason}`,
      ),
    ];
    for (const key of built) {
      expect(key in files.en, key).toBe(true);
      expect(key in files.uk, key).toBe(true);
    }
  });

  it("name the line of every Markdown error", () => {
    for (const [key, text] of Object.entries(files.en)) {
      if (key.startsWith("features.blog.markdown.")) expect(text, key).toContain("{line}");
    }
  });
});
