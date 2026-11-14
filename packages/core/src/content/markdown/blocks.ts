import {
  atxHeading,
  fenceOpen,
  interruptsParagraph,
  isFenceClose,
  isThematicBreak,
  listMarker,
  quoteContent,
  startsBlock,
  type ListMarker,
} from "./block-syntax.js";
import { MarkdownFailure, type ParseBudget, type WorkCounter } from "./budget.js";
import { parseInline } from "./inline.js";
import { MARKDOWN_LIMITS } from "./limits.js";
import { indentOf, isBlank, trimSpaces, type SourceLine } from "./source.js";
import type {
  MarkdownBlock,
  MarkdownCodeBlock,
  MarkdownHeading,
  MarkdownList,
  MarkdownListItem,
  MarkdownParagraph,
} from "./types.js";

export interface BlockState {
  readonly budget: ParseBudget;
  readonly locales: readonly string[];
}

/** How deep the lines being parsed sit: block containers (quotes and list items) and lists. */
interface Nesting {
  readonly depth: number;
  readonly listDepth: number;
}

/** A block and the index of the first line after it. */
interface Parsed<T> {
  readonly block: T;
  readonly next: number;
}

const ROOT: Nesting = { depth: 0, listDepth: 0 };

/** Work of looking at one line: its recognizers read it a bounded number of times. */
function visit(work: WorkCounter, line: SourceLine): SourceLine {
  work.count(line.text.length + 1);
  return line;
}

function lineAt(lines: readonly SourceLine[], index: number): SourceLine {
  const line = lines[index];
  if (line === undefined) {
    throw new RangeError(`No source line at index ${index}`);
  }
  return line;
}

function parseFence(
  lines: readonly SourceLine[],
  index: number,
  state: BlockState,
): Parsed<MarkdownCodeBlock> {
  const opening = lineAt(lines, index);
  const open = fenceOpen(opening.text);
  if (open === null) throw new RangeError("parseFence needs a fence line");
  state.budget.block(opening.number);
  const content: string[] = [];
  for (let next = index + 1; next < lines.length; next += 1) {
    const text = visit(state.budget, lineAt(lines, next)).text;
    if (isFenceClose(text, open)) {
      return { block: { type: "codeBlock", value: content.join("\n") }, next: next + 1 };
    }
    content.push(text.slice(Math.min(open.indent, indentOf(text))));
  }
  throw new MarkdownFailure("unclosed_code_fence", opening.number);
}

function parseHeading(line: SourceLine, state: BlockState): MarkdownHeading {
  const heading = atxHeading(line.text);
  if (heading === null) throw new RangeError("parseHeading needs a heading line");
  if (heading.level !== 2 && heading.level !== 3 && heading.level !== 4) {
    throw new MarkdownFailure("heading_level", line.number);
  }
  if (heading.content === "") {
    throw new MarkdownFailure("empty_heading", line.number);
  }
  state.budget.block(line.number);
  const children = parseInline(heading.content, line.number, state);
  return { type: "heading", level: heading.level, children };
}

function parseParagraph(
  lines: readonly SourceLine[],
  index: number,
  state: BlockState,
): Parsed<MarkdownParagraph> {
  const first = lineAt(lines, index);
  const texts = [trimSpaces(first.text)];
  let next = index + 1;
  while (
    next < lines.length &&
    !interruptsParagraph(visit(state.budget, lineAt(lines, next)).text)
  ) {
    texts.push(trimSpaces(lineAt(lines, next).text));
    next += 1;
  }
  state.budget.block(first.number);
  return {
    block: { type: "paragraph", children: parseInline(texts.join("\n"), first.number, state) },
    next,
  };
}

function enter(nesting: Nesting, line: number, isList: boolean): Nesting {
  const inner = { depth: nesting.depth + 1, listDepth: nesting.listDepth + (isList ? 1 : 0) };
  if (inner.depth > MARKDOWN_LIMITS.maxDepth || inner.listDepth > MARKDOWN_LIMITS.maxListDepth) {
    throw new MarkdownFailure("too_deep", line);
  }
  return inner;
}

/**
 * Lines that continue a container: `take` returns the line's text inside the container, or null when it is no container
 * line; a non-blank line that starts no block right after a non-blank line continues it lazily (paragraph continuation).
 * Trailing blank lines are left to the outer block.
 */
function collectContainer(
  lines: readonly SourceLine[],
  index: number,
  first: SourceLine,
  take: (text: string) => string | null,
  work: WorkCounter,
): Parsed<SourceLine[]> {
  const inner: SourceLine[] = [first];
  let lastContent = isBlank(first.text) ? -1 : 0;
  let next = index + 1;
  for (; next < lines.length; next += 1) {
    const line = visit(work, lineAt(lines, next));
    const taken = take(line.text);
    const previousIsBlank = isBlank(lineAt(inner, inner.length - 1).text);
    if (taken !== null) {
      inner.push({ text: taken, number: line.number });
    } else if (!isBlank(line.text) && !previousIsBlank && !startsBlock(line.text)) {
      inner.push(line);
    } else {
      break;
    }
    if (!isBlank(lineAt(inner, inner.length - 1).text)) lastContent = inner.length - 1;
  }
  // `inner[k]` is source line `index + k`. Trailing blank lines go back to the outer block; the first line (the marker) never
  // does, even when it is blank (an empty list item).
  const last = Math.max(lastContent, 0);
  return { block: inner.slice(0, lastContent + 1), next: index + last + 1 };
}

function parseQuote(
  lines: readonly SourceLine[],
  index: number,
  nesting: Nesting,
  state: BlockState,
): Parsed<MarkdownBlock> {
  const line = lineAt(lines, index);
  const inner = enter(nesting, line.number, false);
  state.budget.block(line.number);
  const content = quoteContent(line.text) ?? "";
  const collected = collectContainer(
    lines,
    index,
    { text: content, number: line.number },
    quoteContent,
    state.budget,
  );
  const children = parseBlocks(collected.block, inner, state);
  return { block: { type: "blockquote", children }, next: collected.next };
}

function parseListItem(
  lines: readonly SourceLine[],
  index: number,
  marker: ListMarker,
  inner: Nesting,
  state: BlockState,
): Parsed<MarkdownListItem> {
  const line = lineAt(lines, index);
  state.budget.block(line.number);
  const take = (text: string): string | null => {
    if (isBlank(text)) return "";
    return indentOf(text) >= marker.contentColumn ? text.slice(marker.contentColumn) : null;
  };
  const collected = collectContainer(
    lines,
    index,
    { text: marker.firstContent, number: line.number },
    take,
    state.budget,
  );
  return {
    block: { type: "listItem", children: parseBlocks(collected.block, inner, state) },
    next: collected.next,
  };
}

function parseList(
  lines: readonly SourceLine[],
  index: number,
  nesting: Nesting,
  state: BlockState,
): Parsed<MarkdownList> {
  const firstLine = lineAt(lines, index);
  const first = listMarker(firstLine.text);
  if (first === null) throw new RangeError("parseList needs a list item line");
  const inner = enter(nesting, firstLine.number, true);
  state.budget.block(firstLine.number);
  const items: MarkdownListItem[] = [];
  let next = index;
  let marker: ListMarker | null = first;
  while (marker !== null) {
    const item = parseListItem(lines, next, marker, inner, state);
    items.push(item.block);
    next = item.next;
    let following = next;
    while (
      following < lines.length &&
      isBlank(visit(state.budget, lineAt(lines, following)).text)
    ) {
      following += 1;
    }
    const candidate = following < lines.length ? listMarker(lineAt(lines, following).text) : null;
    const continues =
      candidate !== null &&
      candidate.ordered === first.ordered &&
      !isThematicBreak(lineAt(lines, following).text);
    marker = continues ? candidate : null;
    if (continues) next = following;
  }
  return { block: { type: "list", ordered: first.ordered, start: first.start, items }, next };
}

function parseBlock(
  lines: readonly SourceLine[],
  index: number,
  nesting: Nesting,
  state: BlockState,
): Parsed<MarkdownBlock> {
  const line = lineAt(lines, index);
  if (fenceOpen(line.text) !== null) return parseFence(lines, index, state);
  if (atxHeading(line.text) !== null) return { block: parseHeading(line, state), next: index + 1 };
  if (isThematicBreak(line.text)) {
    state.budget.block(line.number);
    return { block: { type: "thematicBreak" }, next: index + 1 };
  }
  if (quoteContent(line.text) !== null) return parseQuote(lines, index, nesting, state);
  if (listMarker(line.text) !== null) return parseList(lines, index, nesting, state);
  return parseParagraph(lines, index, state);
}

/** The blocks of a run of lines (the whole source, or the inside of a quote or a list item). */
export function parseBlocks(
  lines: readonly SourceLine[],
  nesting: Nesting,
  state: BlockState,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (isBlank(visit(state.budget, lineAt(lines, index)).text)) {
      index += 1;
      continue;
    }
    const parsed = parseBlock(lines, index, nesting, state);
    blocks.push(parsed.block);
    index = parsed.next;
  }
  return blocks;
}

export function parseDocumentBlocks(
  lines: readonly SourceLine[],
  state: BlockState,
): MarkdownBlock[] {
  return parseBlocks(lines, ROOT, state);
}
