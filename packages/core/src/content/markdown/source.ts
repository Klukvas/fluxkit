/** One line of the source after line-end normalization, with its 1-based number in the original text. */
export interface SourceLine {
  readonly text: string;
  readonly number: number;
}

const TAB_STOP = 4;
/** Characters that may come before the content of a line: indentation, quote and list markers. */
const PREFIX_CHARACTERS = new Set([" ", "\t", ">", "-", "*", "+", ".", ")", ..."0123456789"]);

/**
 * Tabs in the leading indentation and markers count to the next stop of four, so `-\ta` and `\tb` line up like the spaces a
 * writer sees. Tabs after the first other character stay as they are.
 */
function expandPrefixTabs(text: string): string {
  let column = 0;
  let expanded = "";
  let hasTab = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (!PREFIX_CHARACTERS.has(char)) {
      return hasTab ? expanded + text.slice(index) : text;
    }
    if (char === "\t") {
      hasTab = true;
      const width = TAB_STOP - (column % TAB_STOP);
      expanded += " ".repeat(width);
      column += width;
    } else {
      expanded += char;
      column += 1;
    }
  }
  return expanded;
}

/** `\r\n`, a lone `\r` and `\n` all end a line. */
export function sourceLines(source: string): SourceLine[] {
  return source
    .split(/\r\n|\r|\n/u)
    .map((text, index) => ({ text: expandPrefixTabs(text), number: index + 1 }));
}

/** The 1-based line of the character at `offset`, counting line ends like `sourceLines`. */
export function lineOfOffset(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    const char = source.charAt(index);
    if (char === "\n" || (char === "\r" && source.charAt(index + 1) !== "\n")) {
      line += 1;
    }
  }
  return line;
}

export function isBlank(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char !== " " && char !== "\t") return false;
  }
  return true;
}

/** Leading spaces (tabs in the prefix are already expanded). */
export function indentOf(text: string): number {
  let index = 0;
  while (text.charAt(index) === " ") index += 1;
  return index;
}

/** Removes leading and trailing spaces and tabs (not other Unicode spaces, which are text). */
export function trimSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (text.charAt(start) === " " || text.charAt(start) === "\t")) start += 1;
  while (end > start && (text.charAt(end - 1) === " " || text.charAt(end - 1) === "\t")) end -= 1;
  return text.slice(start, end);
}
