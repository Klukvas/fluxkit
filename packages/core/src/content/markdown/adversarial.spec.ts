import { describe, expect, it } from "vitest";
import { MARKDOWN_LIMITS } from "./limits.js";
import { parseMarkdown } from "./parse.js";
import { runMarkdownParse } from "./run-parse.js";
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

/** Each timing test parses its input four times at the length limit; a slow runner must not hit vitest's 5 s default. */
const TIMING_TEST_TIMEOUT_MS = 30_000;
/** Work of an 8x larger input: linear is 8x; n log n would be about 10x here, quadratic 64x. */
const MAX_WORK_RATIO = 9;

/** An adversarial input: a unit repeated up to the length, or a builder for inputs with more than one part. */
type AdversarialInput = string | ((length: number) => string);

/** Builds an input of about `length` characters by repeating `unit`. */
function repeatTo(unit: string, length: number): string {
  return unit.repeat(Math.floor(length / unit.length));
}

function sourceOf(input: AdversarialInput, length: number): string {
  return typeof input === "string" ? repeatTo(input, length) : input(length);
}

/** The parser's own work count (characters visited and loop steps): deterministic, unlike wall-clock time. */
function stepsOf(source: string): number {
  return runMarkdownParse(source, OPTIONS).steps;
}

/**
 * The high-resolution clock of Node and browsers. Core compiles without DOM or Node types (it is runtime-neutral), so the
 * spec declares the one member it uses.
 */
declare const performance: { now(): number };

/** The fastest of three runs, in milliseconds. */
function timeOf(source: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    parse(source);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/** Adversarial inputs (blog plan section 8 and 12), each a unit repeated up to the length limit or built for it. */
const ADVERSARIAL: readonly [string, AdversarialInput][] = [
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
  ["empty brackets before unclosed targets", "[]("],
  ["link targets that start inside one another", "[a](x"],
  [
    "link targets inside one another, closed far away",
    (length) => repeatTo("[a](x", length - 1) + ")",
  ],
  // Openers that stay on the stack, then closers of the other character that can never match them: without CommonMark's
  // `openers_bottom` table every closer would walk back over all the openers.
  [
    "openers then closers of another character",
    (length) => repeatTo("*a ", length / 2) + repeatTo("b_ ", length / 2),
  ],
  [
    "strong openers then emphasis closers",
    (length) => repeatTo("**a ", length / 2) + repeatTo("b* ", length / 2),
  ],
];

/** A small deterministic generator (mulberry32), so a failing case is the same on every run. */
function randomSource(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const FUZZ_PIECES = [
  ..."*_`[]()!\\#>-+.1 \t\n\r~|<a/:%",
  "https://",
  "/uk/",
  "%0d",
  "%E2%80%AE",
  "\u202e",
  "é",
  "😀",
];

describe("parseMarkdown, adversarial input", () => {
  it.each(ADVERSARIAL)("%s: bounded output at the length limit", (_name, input) => {
    expectBounded(parse(sourceOf(input, MAX)));
  });

  it.each(ADVERSARIAL)(
    "%s: linear work (8x the input, at most 9x the parser's steps)",
    (_name, input) => {
      const small = stepsOf(sourceOf(input, MAX / 8));
      const large = stepsOf(sourceOf(input, MAX));
      expect(large).toBeLessThanOrEqual(small * MAX_WORK_RATIO);
    },
  );

  it.each(ADVERSARIAL)(
    "%s: under a second at the length limit (a coarse wall-clock backstop)",
    (_name, input) => {
      const source = sourceOf(input, MAX);
      parse(source); // warm up the JIT before measuring
      expect(timeOf(source)).toBeLessThan(1_000);
    },
    TIMING_TEST_TIMEOUT_MS,
  );

  it("never throws and stays bounded on 2 000 random sources made of syntax characters", () => {
    const random = randomSource(50);
    for (let run = 0; run < 2_000; run += 1) {
      const length = Math.floor(random() * 200);
      let source = "";
      for (let index = 0; index < length; index += 1) {
        source += FUZZ_PIECES[Math.floor(random() * FUZZ_PIECES.length)] ?? "";
      }
      expectBounded(parse(source));
    }
  });

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
