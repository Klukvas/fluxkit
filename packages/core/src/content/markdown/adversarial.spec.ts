import { describe, expect, it } from "vitest";
import { MARKDOWN_LIMITS } from "./limits.js";
import { parseMarkdown } from "./parse.js";
import type {
  MarkdownBlock,
  MarkdownDocument,
  MarkdownInline,
  MarkdownParseResult,
} from "./types.js";

const OPTIONS = { locales: ["uk", "en"] } as const;
const MAX = MARKDOWN_LIMITS.maxLength;

function parse(source: string): MarkdownParseResult {
  return parseMarkdown(source, OPTIONS);
}

function countInline(node: MarkdownInline): number {
  return "children" in node
    ? 1 + node.children.reduce((sum, child) => sum + countInline(child), 0)
    : 1;
}

function countBlock(node: MarkdownBlock): number {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return 1 + node.children.reduce((sum, child) => sum + countInline(child), 0);
    case "blockquote":
      return 1 + node.children.reduce((sum, child) => sum + countBlock(child), 0);
    case "list":
      return (
        1 +
        node.items.reduce(
          (sum, item) =>
            sum + 1 + item.children.reduce((inner, child) => inner + countBlock(child), 0),
          0,
        )
      );
    case "codeBlock":
    case "thematicBreak":
      return 1;
  }
}

function nodeCount(document: MarkdownDocument): number {
  return document.children.reduce((sum, child) => sum + countBlock(child), 0);
}

/** UTF-8 length counted another way than the parser does (core has no `TextEncoder` type): each `%XX` is one byte. */
function utf8Bytes(text: string): number {
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;
}

/** Every document that parses stays under the output caps; every refusal names a line. */
function expectBounded(result: MarkdownParseResult): void {
  if (result.ok) {
    expect(nodeCount(result.document)).toBeLessThanOrEqual(MARKDOWN_LIMITS.maxNodes);
    expect(utf8Bytes(JSON.stringify(result.document))).toBeLessThanOrEqual(
      MARKDOWN_LIMITS.maxSerializedBytes,
    );
  } else {
    expect(result.error.line).toBeGreaterThanOrEqual(1);
  }
}

/** Builds an input of about `length` characters by repeating `unit`. */
function repeatTo(unit: string, length: number): string {
  return unit.repeat(Math.floor(length / unit.length));
}

/** The fastest of three runs, in milliseconds (`Date.now`: core has no `performance` type; the floor below covers it). */
function timeOf(source: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run += 1) {
    const start = Date.now();
    parse(source);
    best = Math.min(best, Date.now() - start);
  }
  return best;
}

/** Adversarial inputs (blog plan section 8 and 12), each a unit repeated up to the length limit. */
const ADVERSARIAL: readonly [string, string][] = [
  ["stars", "*"],
  ["underscores", "_"],
  ["opening brackets", "["],
  ["closing brackets", "]"],
  ["backticks", "`"],
  ["backtick runs of growing length", "` `` ``` "],
  ["backslashes", "\\"],
  ["one-character emphasis runs", "*a* "],
  ["unclosed emphasis openers", "*a "],
  ["unmatched closers", "a* "],
  ["mixed delimiters", "*_*_"],
  ["strong and emphasis runs", "***a** "],
  ["unclosed link targets", "[a](/"],
  ["nested unclosed link targets", "[a](/("],
  ["bracket pairs without targets", "[a]"],
  ["image openers", "!["],
  ["block quote markers", ">"],
  ["block quote lines", "> a\n"],
  ["deep block quotes", "> > > > > > > > a\n"],
  ["list markers", "- "],
  ["deep lists", "- - - - a\n"],
  ["list lines", "- a\n"],
  ["ordered list lines", "1. a\n"],
  ["fences", "```\n"],
  ["heading markers", "## a\n"],
  ["thematic breaks", "---\n"],
  ["blank lines", "\n"],
  ["CR line ends", "a\r"],
  ["trailing hashes and spaces", "## a #  # \n"],
  ["spaces then a word", "                                        b\n"],
  ["valid links", "[a](/x) "],
];

describe("parseMarkdown, adversarial input", () => {
  it.each(ADVERSARIAL)("%s: bounded output at the length limit", (_name, unit) => {
    expectBounded(parse(repeatTo(unit, MAX)));
  });

  it.each(ADVERSARIAL)(
    "%s: linear time (8x the input costs far less than 64x the time)",
    (_name, unit) => {
      const small = repeatTo(unit, MAX / 8);
      const large = repeatTo(unit, MAX);
      parse(large); // warm up the JIT before measuring
      const smallTime = timeOf(small);
      const largeTime = timeOf(large);
      // Linear is about 8x; quadratic would be about 64x. The floor absorbs timer noise on sub-millisecond runs.
      expect(largeTime).toBeLessThan(Math.max(smallTime * 24, 25));
      expect(largeTime).toBeLessThan(1_000);
    },
  );

  it("refuses one character over the length limit, on line 1", () => {
    expect(parse("a".repeat(MAX)).ok).toBe(true);
    expect(parse("a".repeat(MAX + 1))).toEqual({ ok: false, error: { code: "too_long", line: 1 } });
  });

  it("refuses more than the maximum number of links, on the line of the first one too many", () => {
    const lines = Array.from({ length: MARKDOWN_LIMITS.maxLinks + 1 }, () => "[a](/x)");
    expect(parse(lines.slice(0, -1).join("\n")).ok).toBe(true);
    expect(parse(lines.join("\n"))).toEqual({
      ok: false,
      error: { code: "too_many_links", line: MARKDOWN_LIMITS.maxLinks + 1 },
    });
  });

  it("refuses more than the maximum number of blocks, on the line of the first one too many", () => {
    const blocks = Array.from({ length: MARKDOWN_LIMITS.maxBlocks + 1 }, () => "---");
    expect(parse(blocks.slice(0, -1).join("\n")).ok).toBe(true);
    expect(parse(blocks.join("\n"))).toEqual({
      ok: false,
      error: { code: "too_many_blocks", line: MARKDOWN_LIMITS.maxBlocks + 1 },
    });
  });

  it("counts list items as blocks", () => {
    const items = Array.from({ length: MARKDOWN_LIMITS.maxBlocks }, () => "-");
    // One list plus 2 000 items is 2 001 blocks.
    expect(parse(items.join("\n"))).toEqual({
      ok: false,
      error: { code: "too_many_blocks", line: MARKDOWN_LIMITS.maxBlocks },
    });
  });

  it("refuses more than the maximum number of nodes, on the line where the count is crossed", () => {
    // Each `*a* ` is three nodes (emphasis, its text, the space after it): 7 000 of them are about 21 000 nodes.
    expect(parse("x\n\n" + "*a* ".repeat(7_000))).toEqual({
      ok: false,
      error: { code: "too_many_nodes", line: 3 },
    });
  });

  it("refuses a document whose serialized form is over the size cap, on line 1", () => {
    // 9 000 inline code spans: 36 000 characters and about 18 000 nodes (under both limits), but over 500 KB of JSON.
    const result = parse("`x` ".repeat(9_000));
    expect(result).toEqual({ ok: false, error: { code: "too_large", line: 1 } });
  });

  it("refuses inline nesting deeper than the limit, and accepts it at the limit", () => {
    // link > strong > emphasis > strong = 4 levels; emphasis > strong > link > emphasis > strong = 5.
    expect(parse("[**_**a**_**](/x)").ok).toBe(true);
    expect(parse("[**_**a**_**](/x)\n\n***[***a***](/x)***")).toEqual({
      ok: false,
      error: { code: "too_deep", line: 3 },
    });
  });

  it("refuses deep block quotes on their line and keeps the depth limit exact", () => {
    expect(parse("a\n\n" + "> ".repeat(MARKDOWN_LIMITS.maxDepth) + "x").ok).toBe(true);
    expect(parse("a\n\n" + "> ".repeat(MARKDOWN_LIMITS.maxDepth + 1) + "x")).toEqual({
      ok: false,
      error: { code: "too_deep", line: 3 },
    });
  });
});
