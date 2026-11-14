import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse.js";
import { markdownPlainText } from "./plain-text.js";
import type { MarkdownDocument } from "./types.js";

function parsed(source: string): MarkdownDocument {
  const result = parseMarkdown(source, { locales: ["uk", "en"] });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.document;
}

describe("markdownPlainText", () => {
  it("is empty for an empty document", () => {
    expect(markdownPlainText(parsed(""))).toBe("");
  });

  it("joins blocks with a blank line and keeps the words of every node, links and code included", () => {
    const source = [
      "## Brewing *guide*",
      "",
      "Use [fresh **beans**](/catalog) and `93 °C`.\\",
      "Then wait.",
      "",
      "> A quote",
      "",
      "- one",
      "- two",
      "",
      "```",
      "grind(18)",
      "```",
      "",
      "---",
    ].join("\n");
    expect(markdownPlainText(parsed(source))).toBe(
      "Brewing guide\n\nUse fresh beans and 93 °C.\nThen wait.\n\nA quote\n\none\n\ntwo\n\ngrind(18)",
    );
  });

  it("returns the literal text of everything outside the subset (never markup)", () => {
    expect(markdownPlainText(parsed("<b>x</b> ![a](/p.png)"))).toBe("<b>x</b> ![a](/p.png)");
  });
});
