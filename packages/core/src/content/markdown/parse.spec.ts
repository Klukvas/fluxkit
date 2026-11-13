import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse.js";
import type {
  MarkdownBlock,
  MarkdownDocument,
  MarkdownError,
  MarkdownInline,
  MarkdownListItem,
} from "./types.js";

const OPTIONS = { locales: ["uk", "en"] } as const;

const text = (value: string): MarkdownInline => ({ type: "text", value });
const code = (value: string): MarkdownInline => ({ type: "inlineCode", value });
const br: MarkdownInline = { type: "break" };
const em = (...children: MarkdownInline[]): MarkdownInline => ({ type: "emphasis", children });
const strong = (...children: MarkdownInline[]): MarkdownInline => ({ type: "strong", children });
const link = (href: string, ...children: MarkdownInline[]): MarkdownInline => ({
  type: "link",
  kind: href.startsWith("/") ? "path" : "https",
  href,
  children,
});
const p = (...children: MarkdownInline[]): MarkdownBlock => ({ type: "paragraph", children });
const h = (level: 2 | 3 | 4, ...children: MarkdownInline[]): MarkdownBlock => ({
  type: "heading",
  level,
  children,
});
const pre = (value: string): MarkdownBlock => ({ type: "codeBlock", value });
const quote = (...children: MarkdownBlock[]): MarkdownBlock => ({ type: "blockquote", children });
const li = (...children: MarkdownBlock[]): MarkdownListItem => ({ type: "listItem", children });
const ul = (...items: MarkdownListItem[]): MarkdownBlock => ({
  type: "list",
  ordered: false,
  start: 1,
  items,
});
const ol = (start: number, ...items: MarkdownListItem[]): MarkdownBlock => ({
  type: "list",
  ordered: true,
  start,
  items,
});
const hr: MarkdownBlock = { type: "thematicBreak" };
const doc = (...children: MarkdownBlock[]): MarkdownDocument => ({ type: "document", children });

function parsed(source: string): MarkdownDocument {
  const result = parseMarkdown(source, OPTIONS);
  if (!result.ok) {
    throw new Error(
      `Expected ${JSON.stringify(source)} to parse, got ${JSON.stringify(result.error)}`,
    );
  }
  return result.document;
}

function refused(source: string): MarkdownError {
  const result = parseMarkdown(source, OPTIONS);
  if (result.ok) {
    throw new Error(
      `Expected ${JSON.stringify(source)} to be refused, got ${JSON.stringify(result.document)}`,
    );
  }
  return result.error;
}

/** The case table per node (blog plan section 12): source -> the whole document. */
const CASES: readonly [string, string, MarkdownDocument][] = [
  ["empty source", "", doc()],
  ["blank lines only", "\n  \n\t\n", doc()],
  ["one paragraph", "Hello", doc(p(text("Hello")))],
  ["soft line break kept as a newline", "a\nb", doc(p(text("a\nb")))],
  ["paragraphs split by a blank line", "a\n\nb", doc(p(text("a")), p(text("b")))],
  ["leading and trailing spaces of a line dropped", "   a  \n    b ", doc(p(text("a\nb")))],
  ["hard break: a trailing backslash", "a\\\nb", doc(p(text("a"), br, text("b")))],
  ["a backslash at the very end stays", "a\\", doc(p(text("a\\")))],
  ["two trailing spaces are no break", "a  \nb", doc(p(text("a\nb")))],
  ["heading 2", "## Title", doc(h(2, text("Title")))],
  ["heading 3 with closing hashes", "### Title ###", doc(h(3, text("Title")))],
  ["heading 4", "#### Title", doc(h(4, text("Title")))],
  ["hash without a space is text", "##Title", doc(p(text("##Title")))],
  ["heading keeps a trailing hash glued to a word", "## C#", doc(h(2, text("C#")))],
  ["heading interrupts a paragraph", "a\n## b", doc(p(text("a")), h(2, text("b")))],
  ["emphasis with *", "*a*", doc(p(em(text("a"))))],
  ["emphasis with _", "_a_", doc(p(em(text("a"))))],
  ["strong with **", "**a**", doc(p(strong(text("a"))))],
  ["strong with __", "__a__", doc(p(strong(text("a"))))],
  ["strong around emphasis", "***a***", doc(p(em(strong(text("a")))))],
  ["emphasis inside a word with *", "a*b*c", doc(p(text("a"), em(text("b")), text("c")))],
  ["no emphasis inside a word with _", "snake_case_name", doc(p(text("snake_case_name")))],
  ["a lone star stays", "2 * 3 = 6", doc(p(text("2 * 3 = 6")))],
  ["unclosed emphasis stays text", "*a", doc(p(text("*a")))],
  [
    "strong inside emphasis",
    "*foo**bar**baz*",
    doc(p(em(text("foo"), strong(text("bar")), text("baz")))),
  ],
  ["a spare opener stays text", "**a*", doc(p(text("*"), em(text("a"))))],
  ["emphasis around strong", "*a **b** c*", doc(p(em(text("a "), strong(text("b")), text(" c"))))],
  [
    "emphasis cannot cross a link edge",
    "[a *b](/x) c*",
    doc(p(link("/x", text("a *b")), text(" c*"))),
  ],
  ["a bracket inside code opens nothing", "`a [b`](/x)", doc(p(code("a [b"), text("](/x)")))],
  ["inline code", "`x`", doc(p(code("x")))],
  ["inline code with a longer fence", "``a ` b``", doc(p(code("a ` b")))],
  ["inline code strips one space each side", "` a `", doc(p(code("a")))],
  ["inline code takes no emphasis or escapes", "`*a* \\_`", doc(p(code("*a* \\_")))],
  ["inline code turns a line end into a space", "`a\nb`", doc(p(code("a b")))],
  ["unclosed backticks stay text", "``a`", doc(p(text("``a`")))],
  ["backslash escapes punctuation", "\\*a\\* \\[b\\]", doc(p(text("*a* [b]")))],
  ["backslash before a letter stays", "\\a", doc(p(text("\\a")))],
  ["path link", "[Shop](/catalog)", doc(p(link("/catalog", text("Shop"))))],
  [
    "https link",
    "[Docs](https://example.com/x)",
    doc(p(link("https://example.com/x", text("Docs")))),
  ],
  [
    "link with balanced parentheses",
    "[W](https://example.com/Foo_(bar))",
    doc(p(link("https://example.com/Foo_(bar)", text("W")))),
  ],
  ["link text with emphasis", "[*a* b](/x)", doc(p(link("/x", em(text("a")), text(" b"))))],
  ["link with spaces around the target", "[a]( /x )", doc(p(link("/x", text("a"))))],
  [
    "escaped parenthesis in a target",
    "[a](https://example.com/\\(x)",
    doc(p(link("https://example.com/(x", text("a")))),
  ],
  [
    "no link inside a link",
    "[a [b](/x) c](/y)",
    doc(p(text("[a "), link("/x", text("b")), text(" c](/y)"))),
  ],
  ["link with a title is text", '[a](/x "t")', doc(p(text('[a](/x "t")')))],
  ["brackets without a target are text", "[a] (b)", doc(p(text("[a] (b)")))],
  ["image syntax is text", "![alt](/x.png)", doc(p(text("![alt](/x.png)")))],
  [
    "raw HTML is text",
    "<b>x</b> <script>alert(1)</script>",
    doc(p(text("<b>x</b> <script>alert(1)</script>"))),
  ],
  ["autolink is text", "<https://example.com>", doc(p(text("<https://example.com>")))],
  ["table is text", "| a | b |\n|---|---|", doc(p(text("| a | b |\n|---|---|")))],
  ["footnote is text", "a[^1]\n\n[^1]: b", doc(p(text("a[^1]")), p(text("[^1]: b")))],
  ["entity is text", "&amp; &#x3C;", doc(p(text("&amp; &#x3C;")))],
  ["fenced code", "```\nlet a = 1;\n  b\n```", doc(pre("let a = 1;\n  b"))],
  ["fenced code drops the info string", "```ts\nx\n```", doc(pre("x"))],
  ["fenced code with tildes and a longer close", "~~~\n```\n~~~~", doc(pre("```"))],
  ["empty fenced code", "```\n```", doc(pre(""))],
  [
    "fence keeps inner indentation relative to the fence",
    "  ```\n    a\n b\n  ```",
    doc(pre("  a\nb")),
  ],
  ["fenced code keeps markup literal", "```\n<b>*a*</b>\n```", doc(pre("<b>*a*</b>"))],
  ["thematic break ---", "---", doc(hr)],
  ["thematic break * * *", "* * *", doc(hr)],
  ["thematic break ___", "___", doc(hr)],
  ["--- after a paragraph is a break, not a heading", "a\n---", doc(p(text("a")), hr)],
  ["block quote", "> a\n> b", doc(quote(p(text("a\nb"))))],
  ["block quote lazy line", "> a\nb", doc(quote(p(text("a\nb"))))],
  [
    "block quote with blocks",
    "> ## T\n>\n> - x",
    doc(quote(h(2, text("T")), ul(li(p(text("x")))))),
  ],
  ["nested block quote", "> > a", doc(quote(quote(p(text("a")))))],
  ["bullet list", "- a\n- b", doc(ul(li(p(text("a"))), li(p(text("b")))))],
  ["bullet list with * and +", "* a\n+ b", doc(ul(li(p(text("a"))), li(p(text("b")))))],
  ["ordered list", "1. a\n2. b", doc(ol(1, li(p(text("a"))), li(p(text("b")))))],
  ["ordered list with a start", "3) a\n4) b", doc(ol(3, li(p(text("a"))), li(p(text("b")))))],
  ["list item continuation", "- a\n  b", doc(ul(li(p(text("a\nb")))))],
  ["list item lazy line", "- a\nb", doc(ul(li(p(text("a\nb")))))],
  ["loose list items", "- a\n\n- b", doc(ul(li(p(text("a"))), li(p(text("b")))))],
  ["list item with two paragraphs", "- a\n\n  b", doc(ul(li(p(text("a")), p(text("b")))))],
  [
    "nested list",
    "- a\n  - b\n- c",
    doc(ul(li(p(text("a")), ul(li(p(text("b"))))), li(p(text("c"))))),
  ],
  ["ordered inside bullet", "- a\n  1. b", doc(ul(li(p(text("a")), ol(1, li(p(text("b")))))))],
  [
    "a bullet list ends at an ordered item",
    "- a\n1. b",
    doc(ul(li(p(text("a")))), ol(1, li(p(text("b"))))),
  ],
  ["empty list item", "-\n- a", doc(ul(li(), li(p(text("a")))))],
  ["list after a paragraph", "a\n- b", doc(p(text("a")), ul(li(p(text("b")))))],
  ["only 1. interrupts a paragraph", "In\n2024. it rained", doc(p(text("In\n2024. it rained")))],
  ["a paragraph after a list", "- a\n\nb", doc(ul(li(p(text("a")))), p(text("b")))],
  ["code fence in a list item", "- ```\n  x\n  ```", doc(ul(li(pre("x"))))],
  ["four spaces of indentation are no code block", "    a", doc(p(text("a")))],
  ["CRLF line ends", "a\r\nb\r\n\r\nc", doc(p(text("a\nb")), p(text("c")))],
  ["lone CR line ends", "## a\rb", doc(h(2, text("a")), p(text("b")))],
  ["bidi controls in text are kept", "a‮b⁦c", doc(p(text("a‮b⁦c")))],
  ["tab indentation counts to the next stop of four", "-\ta\n\tb", doc(ul(li(p(text("a\nb")))))],
];

describe("parseMarkdown, supported subset", () => {
  it.each(CASES)("%s", (_name, source, expected) => {
    expect(parsed(source)).toEqual(expected);
  });
});

/** Refusals with the line of the offending text (blog plan section 8). */
const REFUSALS: readonly [string, string, MarkdownError][] = [
  ["# is the page title", "a\n\n# Title", { code: "heading_level", line: 3 }],
  ["##### is too deep a heading", "##### x", { code: "heading_level", line: 1 }],
  ["###### is too deep a heading", "######", { code: "heading_level", line: 1 }],
  ["empty heading", "x\n##", { code: "empty_heading", line: 2 }],
  ["heading of closing hashes only", "## ##", { code: "empty_heading", line: 1 }],
  ["unclosed fence", "a\n\n```\ncode", { code: "unclosed_code_fence", line: 3 }],
  ["fence closed by a shorter fence", "````\nx\n```", { code: "unclosed_code_fence", line: 1 }],
  [
    "fence unclosed inside its quote",
    "> ```\n> x\n\n```",
    { code: "unclosed_code_fence", line: 1 },
  ],
  ["NUL in text", "a\nb\u0000c", { code: "control_character", line: 2 }],
  ["NUL in code", "```\n\u0000\n```", { code: "control_character", line: 2 }],
  [
    "javascript link",
    "x\n[a](javascript:alert(1))",
    { code: "link_refused", line: 2, reason: "not_path_or_https" },
  ],
  [
    "http link",
    "[a](http://example.com)",
    { code: "link_refused", line: 1, reason: "not_path_or_https" },
  ],
  [
    "data link",
    "[a](data:text/html,x)",
    { code: "link_refused", line: 1, reason: "not_path_or_https" },
  ],
  [
    "mailto link",
    "[a](mailto:a@example.com)",
    { code: "link_refused", line: 1, reason: "not_path_or_https" },
  ],
  ["relative link", "[a](catalog)", { code: "link_refused", line: 1, reason: "not_path_or_https" }],
  [
    "upper-case scheme",
    "[a](HTTPS://example.com)",
    { code: "link_refused", line: 1, reason: "not_path_or_https" },
  ],
  ["empty target", "[a]()", { code: "link_refused", line: 1, reason: "empty" }],
  [
    "protocol-relative link",
    "[a](//evil.test)",
    { code: "link_refused", line: 1, reason: "protocol_relative" },
  ],
  [
    "dot segments, encoded",
    "[a](/%2e%2e/admin)",
    { code: "link_refused", line: 1, reason: "dot_segment" },
  ],
  ["locale prefix", "[a](/uk/x)", { code: "link_refused", line: 1, reason: "locale_prefix" }],
  [
    "credentials",
    "[a](https://u:p@example.com)",
    { code: "link_refused", line: 1, reason: "credentials" },
  ],
  ["encoded CR", "[a](/x%0d)", { code: "link_refused", line: 1, reason: "control_character" }],
  ["encoded LF", "[a](/x%0A)", { code: "link_refused", line: 1, reason: "control_character" }],
  ["encoded NUL", "[a](/x%00)", { code: "link_refused", line: 1, reason: "control_character" }],
  [
    "raw control in a target",
    "[a](/x\u0001)",
    { code: "link_refused", line: 1, reason: "control_character" },
  ],
  ["raw U+202E in a target", "[a](/x‮)", { code: "link_refused", line: 1, reason: "bidi_control" }],
  [
    "encoded U+202E in a target",
    "[a](/x%E2%80%AE)",
    { code: "link_refused", line: 1, reason: "bidi_control" },
  ],
  ["raw U+2066 in a target", "[a](/x⁦)", { code: "link_refused", line: 1, reason: "bidi_control" }],
  [
    "encoded U+2066 in a target",
    "[a](/x%e2%81%a6)",
    { code: "link_refused", line: 1, reason: "bidi_control" },
  ],
  [
    "refused link in a list item",
    "- a\n- b [c](http://x.test)",
    { code: "link_refused", line: 2, reason: "not_path_or_https" },
  ],
  [
    "refused link on a later paragraph line",
    "a\nb\nc [d](ftp://x)",
    { code: "link_refused", line: 3, reason: "not_path_or_https" },
  ],
  [
    "refused link after CRLF lines",
    "a\r\nb\r\n[c](javascript:x)",
    { code: "link_refused", line: 3, reason: "not_path_or_https" },
  ],
  [
    "refused link in a heading",
    "\n## [a](http://x.test)",
    { code: "link_refused", line: 2, reason: "not_path_or_https" },
  ],
  ["empty link text", "[](/x)", { code: "empty_link_text", line: 1 }],
  ["a third list level", "- a\n  - b\n    - c", { code: "too_deep", line: 3 }],
  ["five block quotes", "> > > > > a", { code: "too_deep", line: 1 }],
];

describe("parseMarkdown, refusals", () => {
  it.each(REFUSALS)("%s", (_name, source, expected) => {
    expect(refused(source)).toEqual(expected);
  });

  it("accepts four block quotes and two list levels", () => {
    expect(parsed("> > > > a")).toEqual(doc(quote(quote(quote(quote(p(text("a"))))))));
    expect(parsed("> - a\n>   - b").children).toHaveLength(1);
  });

  it("counts list items and block quotes together for the depth of four", () => {
    // quote > list item > quote > list item = 4: accepted; one more quote inside = 5: refused.
    expect(parseMarkdown("> - > - a", OPTIONS).ok).toBe(true);
    expect(refused("> - > - > a")).toEqual({ code: "too_deep", line: 1 });
  });

  it("a raw line break, tab or space in a target makes no link (the text stays literal)", () => {
    for (const source of ["[a](/x\ny)", "[a](/x\ty)", "[a](/x y)", "[a](/x\r\ny)"]) {
      const document = parsed(source);
      expect(JSON.stringify(document), source).not.toContain('"link"');
    }
  });
});
