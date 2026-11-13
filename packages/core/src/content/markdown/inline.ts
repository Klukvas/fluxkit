import { MarkdownFailure, type ParseBudget } from "./budget.js";
import { BacktickRuns } from "./backtick-runs.js";
import { EmphasisStack, type Delimiter } from "./emphasis.js";
import { inlinePlainText } from "./inline-text.js";
import { SlotList, type Slot } from "./inline-list.js";
import { MARKDOWN_LIMITS } from "./limits.js";
import { checkMarkdownLink } from "./link.js";
import type { MarkdownInline } from "./types.js";

interface InlineState {
  readonly budget: ParseBudget;
  readonly locales: readonly string[];
}

/** An open `[` waiting for its `]`. */
interface Bracket {
  readonly slot: Slot;
  /** The delimiter on top of the stack when the bracket opened: emphasis inside the link text stays above it. */
  readonly delimiterBottom: Delimiter | null;
  readonly previous: Bracket | null;
  /** False once a link closed after it: links never nest. */
  active: boolean;
  readonly line: number;
}

const ASCII_PUNCTUATION = new Set([..."!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"]);
const WHITESPACE = /^\s$/u;
const PUNCTUATION = /^[\p{P}\p{S}]$/u;

function isWhitespace(char: string): boolean {
  return char === "" || WHITESPACE.test(char);
}

function isPunctuation(char: string): boolean {
  return PUNCTUATION.test(char);
}

function countInline(nodes: readonly MarkdownInline[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if ("children" in node) count += countInline(node.children);
  }
  return count;
}

/** A link target without its backslash escapes (`\\)` is `)`); other backslashes stay. */
function unescapeTarget(raw: string): string {
  let href = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && ASCII_PUNCTUATION.has(raw.charAt(index + 1))) {
      href += raw.charAt(index + 1);
      index += 1;
    } else {
      href += char;
    }
  }
  return href;
}

/** One code point ending just before `index` ("" at the start). */
function charBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const code = text.charCodeAt(index - 1);
  const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
  return isLowSurrogate && index >= 2 ? text.slice(index - 2, index) : text.charAt(index - 1);
}

/** One code point starting at `index` ("" at the end). */
function charFrom(text: string, index: number): string {
  const code = text.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

/**
 * The inline parser of one paragraph or heading (ADR 0050): a single left-to-right scan with the CommonMark delimiter and
 * bracket algorithms, limited to code spans, emphasis, strong, links and hard breaks. Everything else is text.
 */
class InlineParser {
  private readonly slots: SlotList;
  private readonly emphasis: EmphasisStack;
  private readonly backticks: BacktickRuns;
  private brackets: Bracket | null = null;
  private position = 0;
  private line: number;
  private pending = "";
  private pendingLine: number;
  /** The last `)` found by `closeParenthesisFrom`, and whether the rest of the text has none. */
  private nextClose = -1;
  private noCloseLeft = false;

  constructor(
    private readonly text: string,
    startLine: number,
    private readonly state: InlineState,
  ) {
    this.line = startLine;
    this.pendingLine = startLine;
    this.slots = new SlotList(state.budget);
    this.emphasis = new EmphasisStack(this.slots, state.budget);
    this.backticks = new BacktickRuns(text, state.budget);
  }

  parse(): MarkdownInline[] {
    while (this.position < this.text.length) {
      this.state.budget.count(1);
      this.step(this.text.charAt(this.position));
    }
    this.flush();
    this.emphasis.process(null);
    return this.slots.take(this.slots.head, null).nodes;
  }

  private step(char: string): void {
    switch (char) {
      case "\n":
        this.addText("\n");
        this.line += 1;
        this.position += 1;
        return;
      case "\\":
        this.backslash();
        return;
      case "`":
        this.codeSpan();
        return;
      case "*":
      case "_":
        this.delimiterRun(char);
        return;
      case "[":
        this.openBracket();
        return;
      case "]":
        this.closeBracket();
        return;
      case "!":
        // `![...](...)` is image syntax: not supported, so the whole thing stays text (no link is made from it).
        this.addText(this.text.charAt(this.position + 1) === "[" ? "![" : "!");
        this.position += this.text.charAt(this.position + 1) === "[" ? 2 : 1;
        return;
      default:
        this.addText(char);
        this.position += 1;
    }
  }

  private addText(value: string): void {
    if (this.pending === "") this.pendingLine = this.line;
    this.pending += value;
  }

  private flush(): void {
    if (this.pending !== "") {
      this.slots.append({ kind: "text", value: this.pending }, this.pendingLine);
      this.pending = "";
    }
  }

  private addNode(node: MarkdownInline): void {
    this.flush();
    this.slots.append({ kind: "node", node, depth: 0 }, this.line);
  }

  private backslash(): void {
    const next = this.text.charAt(this.position + 1);
    if (next === "\n") {
      this.addNode({ type: "break" });
      this.line += 1;
      this.position += 2;
    } else if (ASCII_PUNCTUATION.has(next)) {
      this.addText(next);
      this.position += 2;
    } else {
      this.addText("\\");
      this.position += 1;
    }
  }

  private codeSpan(): void {
    const start = this.position;
    let length = 0;
    while (this.text.charAt(start + length) === "`") length += 1;
    this.state.budget.count(length);
    const closer = this.backticks.closerOf(length, start + length);
    if (closer === -1) {
      this.addText("`".repeat(length));
      this.position = start + length;
      return;
    }
    const raw = this.text.slice(start + length, closer);
    const value = raw.replaceAll("\n", " ");
    const strip =
      value.length >= 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "";
    this.addNode({ type: "inlineCode", value: strip ? value.slice(1, -1) : value });
    this.line += raw.length - raw.replaceAll("\n", "").length;
    this.position = closer + length;
  }

  private delimiterRun(char: "*" | "_"): void {
    const start = this.position;
    let length = 0;
    while (this.text.charAt(start + length) === char) length += 1;
    this.state.budget.count(length);
    const before = charBefore(this.text, start);
    const after = charFrom(this.text, start + length);
    const leftFlanking =
      !isWhitespace(after) &&
      (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
    const rightFlanking =
      !isWhitespace(before) &&
      (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
    const canOpen =
      char === "*" ? leftFlanking : leftFlanking && (!rightFlanking || isPunctuation(before));
    const canClose =
      char === "*" ? rightFlanking : rightFlanking && (!leftFlanking || isPunctuation(after));
    this.flush();
    const slot = this.slots.append({ kind: "text", value: char.repeat(length) }, this.line);
    this.emphasis.push({ slot, char, length, canOpen, canClose });
    this.position = start + length;
  }

  private openBracket(): void {
    this.flush();
    const slot = this.slots.append({ kind: "text", value: "[" }, this.line);
    this.brackets = {
      slot,
      delimiterBottom: this.emphasis.top,
      previous: this.brackets,
      active: true,
      line: this.line,
    };
    this.position += 1;
  }

  private closeBracket(): void {
    this.position += 1;
    const opener = this.brackets;
    const target = opener?.active === true ? this.linkTarget(this.position) : null;
    if (opener === null || target === null) {
      if (opener !== null) this.brackets = opener.previous;
      this.addText("]");
      return;
    }
    this.flush();
    this.emphasis.process(opener.delimiterBottom);
    const { nodes, depth } = this.slots.take(opener.slot.next, null);
    const linkText = inlinePlainText(nodes);
    this.state.budget.count(linkText.length);
    if (linkText.trim() === "") {
      throw new MarkdownFailure("empty_link_text", opener.line);
    }
    const checked = checkMarkdownLink(target.href, this.state.locales);
    if (!checked.ok) {
      throw new MarkdownFailure("link_refused", opener.line, checked.reason);
    }
    this.state.budget.link(opener.line);
    if (depth + 1 > MARKDOWN_LIMITS.maxInlineDepth) {
      throw new MarkdownFailure("too_deep", opener.line);
    }
    const link: MarkdownInline = {
      type: "link",
      kind: checked.kind,
      href: target.href,
      children: nodes,
    };
    this.slots.insertAfter(
      opener.slot,
      { kind: "node", node: link, depth: depth + 1 },
      opener.line,
    );
    this.slots.remove(opener.slot);
    this.brackets = opener.previous;
    // Every `[` before this one can no longer open a link. Once one is inactive, all below it already are.
    for (
      let earlier = this.brackets;
      earlier !== null && earlier.active;
      earlier = earlier.previous
    ) {
      this.state.budget.count(1);
      earlier.active = false;
    }
    this.position = target.end;
  }

  /**
   * `(target)` right after `]`: optional spaces, a target without whitespace (balanced parentheses, backslash escapes),
   * optional spaces, `)`. Titles and `<...>` targets are not supported (the brackets stay text). The scan stops after
   * `maxLinkTargetLength` characters, which keeps a body full of unclosed `](` linear.
   */
  private linkTarget(start: number): { href: string; end: number } | null {
    const text = this.text;
    if (text.charAt(start) !== "(") return null;
    // Cheap refusal first: no `)` within reach means no target, without scanning (a body full of `[](` stays fast).
    const close = this.closeParenthesisFrom(start + 1);
    if (close === -1 || close - start > MARKDOWN_LIMITS.maxLinkTargetLength) return null;
    let index = start + 1;
    while (text.charAt(index) === " " || text.charAt(index) === "\t") index += 1;
    const targetStart = index;
    let depth = 0;
    while (index < text.length) {
      this.state.budget.count(1);
      const char = text.charAt(index);
      if (char === " " || char === "\t" || char === "\n") break;
      if (char === ")" && depth === 0) break;
      if (char === "\\" && ASCII_PUNCTUATION.has(text.charAt(index + 1))) {
        index += 2;
      } else {
        if (char === "(") depth += 1;
        if (char === ")") depth -= 1;
        index += 1;
      }
      // Like CommonMark's reference parsers: deeper nesting is no target. It also bounds how far the scans that start inside
      // one another (`[a](x[a](x...`) can overlap, since every `](` opens one more level.
      if (depth > MARKDOWN_LIMITS.maxLinkTargetParentheses) return null;
      if (index - start > MARKDOWN_LIMITS.maxLinkTargetLength) return null;
    }
    const targetEnd = index;
    while (text.charAt(index) === " " || text.charAt(index) === "\t") index += 1;
    if (text.charAt(index) !== ")" || depth !== 0) return null;
    this.state.budget.count(targetEnd - targetStart);
    return { href: unescapeTarget(text.slice(targetStart, targetEnd)), end: index + 1 };
  }

  /**
   * The first `)` at or after `from`. Link targets are tried left to right, so the last answer is reused while it still lies
   * ahead: one pass over the text in all.
   */
  private closeParenthesisFrom(from: number): number {
    if (this.nextClose !== -1 && this.nextClose >= from) return this.nextClose;
    if (this.noCloseLeft) return -1;
    this.nextClose = this.text.indexOf(")", from);
    this.noCloseLeft = this.nextClose === -1;
    this.state.budget.count((this.noCloseLeft ? this.text.length : this.nextClose) - from);
    return this.nextClose;
  }
}

/** The inline nodes of one paragraph or heading; `startLine` is the source line of its first character. */
export function parseInline(text: string, startLine: number, state: InlineState): MarkdownInline[] {
  const nodes = new InlineParser(text, startLine, state).parse();
  const count = countInline(nodes);
  state.budget.count(count);
  state.budget.addNodes(count, startLine);
  return nodes;
}
