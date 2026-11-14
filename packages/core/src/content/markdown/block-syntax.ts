import { indentOf, isBlank, trimSpaces } from "./source.js";

/**
 * Recognizers of the block starts of one line (ADR 0050). Each is a hand-written scan with no regular expression that could
 * backtrack. A block start may be indented by at most three spaces.
 */

const MAX_BLOCK_INDENT = 3;
const MAX_ORDERED_DIGITS = 9;
const MIN_FENCE_LENGTH = 3;
const MIN_BREAK_MARKS = 3;
/** Five or more spaces after a list marker: the content starts one space after it (the rest is indentation of the content). */
const MAX_MARKER_GAP = 4;

function runLength(text: string, start: number, char: string): number {
  let end = start;
  while (text.charAt(end) === char) end += 1;
  return end - start;
}

function isSpaceOrEnd(char: string): boolean {
  return char === "" || char === " " || char === "\t";
}

export interface FenceOpen {
  readonly char: "`" | "~";
  readonly length: number;
  readonly indent: number;
}

/** ```` ``` ```` or `~~~` (three or more), optional info string; a backtick fence's info string has no backtick. */
export function fenceOpen(text: string): FenceOpen | null {
  const indent = indentOf(text);
  if (indent > MAX_BLOCK_INDENT) return null;
  const char = text.charAt(indent);
  if (char !== "`" && char !== "~") return null;
  const length = runLength(text, indent, char);
  if (length < MIN_FENCE_LENGTH) return null;
  if (char === "`" && text.includes("`", indent + length)) return null;
  return { char, length, indent };
}

/** A closing fence: the opening character, at least as many, then only spaces. */
export function isFenceClose(text: string, open: FenceOpen): boolean {
  const indent = indentOf(text);
  if (indent > MAX_BLOCK_INDENT) return false;
  const length = runLength(text, indent, open.char);
  return length >= open.length && isBlank(text.slice(indent + length));
}

export interface AtxHeading {
  /** 1 to 6; the parser refuses all but 2 to 4. */
  readonly level: number;
  /** The text without the opening and closing sequences. */
  readonly content: string;
}

/** Removes a closing `#` sequence that follows a space (`## Title ##`), and keeps `## C#`. */
function withoutClosingSequence(content: string): string {
  let start = content.length;
  while (start > 0 && content.charAt(start - 1) === "#") start -= 1;
  if (start === content.length) return content;
  if (start === 0) return "";
  const before = content.charAt(start - 1);
  return before === " " || before === "\t" ? trimSpaces(content.slice(0, start)) : content;
}

export function atxHeading(text: string): AtxHeading | null {
  const indent = indentOf(text);
  if (indent > MAX_BLOCK_INDENT || text.charAt(indent) !== "#") return null;
  const level = runLength(text, indent, "#");
  if (level > 6 || !isSpaceOrEnd(text.charAt(indent + level))) return null;
  return { level, content: withoutClosingSequence(trimSpaces(text.slice(indent + level))) };
}

/** `---`, `***` or `___`, three or more, spaces between allowed. */
export function isThematicBreak(text: string): boolean {
  const indent = indentOf(text);
  if (indent > MAX_BLOCK_INDENT) return false;
  const mark = text.charAt(indent);
  if (mark !== "-" && mark !== "*" && mark !== "_") return false;
  let marks = 0;
  for (let index = indent; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === mark) marks += 1;
    else if (char !== " " && char !== "\t") return false;
  }
  return marks >= MIN_BREAK_MARKS;
}

/** The text after `>` and one optional space, or null when the line is no quote line. */
export function quoteContent(text: string): string | null {
  const indent = indentOf(text);
  if (indent > MAX_BLOCK_INDENT || text.charAt(indent) !== ">") return null;
  const after = indent + 1;
  return text.slice(text.charAt(after) === " " ? after + 1 : after);
}

export interface ListMarker {
  readonly ordered: boolean;
  /** The number of an ordered item, 1 for a bullet. */
  readonly start: number;
  /** Lines of the item are indented at least this far. */
  readonly contentColumn: number;
  /** The item's text on the marker line. */
  readonly firstContent: string;
  /** Nothing after the marker. */
  readonly isEmpty: boolean;
}

function markerEnd(
  text: string,
  indent: number,
): { end: number; ordered: boolean; start: number } | null {
  const char = text.charAt(indent);
  if (char === "-" || char === "*" || char === "+") {
    return { end: indent + 1, ordered: false, start: 1 };
  }
  let digits = 0;
  while (digits <= MAX_ORDERED_DIGITS && /^[0-9]$/u.test(text.charAt(indent + digits))) digits += 1;
  if (digits === 0 || digits > MAX_ORDERED_DIGITS) return null;
  const delimiter = text.charAt(indent + digits);
  if (delimiter !== "." && delimiter !== ")") return null;
  return {
    end: indent + digits + 1,
    ordered: true,
    start: Number(text.slice(indent, indent + digits)),
  };
}

/** `-`, `*`, `+`, or one to nine digits and `.` or `)`, followed by a space or the line end. */
export function listMarker(text: string): ListMarker | null {
  const indent = indentOf(text);
  if (indent > MAX_BLOCK_INDENT) return null;
  const marker = markerEnd(text, indent);
  if (marker === null || !isSpaceOrEnd(text.charAt(marker.end))) return null;
  const gap = runLength(text, marker.end, " ");
  const rest = text.slice(marker.end + gap);
  if (isBlank(rest)) {
    return { ...marker, contentColumn: marker.end + 1, firstContent: "", isEmpty: true };
  }
  const contentColumn = gap > MAX_MARKER_GAP ? marker.end + 1 : marker.end + gap;
  return {
    ordered: marker.ordered,
    start: marker.start,
    contentColumn,
    firstContent: text.slice(contentColumn),
    isEmpty: false,
  };
}

/**
 * Whether the line starts a block that ends a paragraph: a blank line, a fence, a heading, a break, a quote, or a list item
 * that is not empty (an ordered one only when it starts at 1, so `2024. it rained` continues the sentence).
 */
export function interruptsParagraph(text: string): boolean {
  if (isBlank(text) || fenceOpen(text) !== null || atxHeading(text) !== null) return true;
  if (isThematicBreak(text) || quoteContent(text) !== null) return true;
  const marker = listMarker(text);
  return marker !== null && !marker.isEmpty && (!marker.ordered || marker.start === 1);
}

/** Whether the line starts any block: a lazy continuation line never does. */
export function startsBlock(text: string): boolean {
  return interruptsParagraph(text) || listMarker(text) !== null;
}
