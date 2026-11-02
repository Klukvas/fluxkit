/**
 * Reads `tokens.css` into its rule blocks, for the theme specs (and the admin's built-CSS check). A tiny parser for the one
 * shape this file uses: top-level `selector { --name: value; ... }` blocks and `@media (...) { selector { ... } }` around them.
 * Anything else (a nested rule, an unclosed brace) throws, so a new shape fails the tests instead of being skipped.
 */

export interface TokenBlock {
  /** The selector list as written, whitespace collapsed (`:root, [data-theme="light"]`). */
  selector: string;
  /** The media query of an enclosing `@media`, or `null`. */
  media: string | null;
  /** Custom properties (`--fk-*`) in source order. */
  tokens: Map<string, string>;
  /** Other declarations (`color-scheme`). */
  properties: Map<string, string>;
}

function declarations(body: string): {
  tokens: Map<string, string>;
  properties: Map<string, string>;
} {
  const tokens = new Map<string, string>();
  const properties = new Map<string, string>();
  for (const part of body.split(";")) {
    const text = part.trim();
    if (text === "") continue;
    const colon = text.indexOf(":");
    if (colon <= 0) throw new Error(`Unreadable declaration "${text}" in tokens.css`);
    const name = text.slice(0, colon).trim();
    const value = text.slice(colon + 1).trim();
    (name.startsWith("--") ? tokens : properties).set(name, value);
  }
  return { tokens, properties };
}

export function parseTokenBlocks(css: string): TokenBlock[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: TokenBlock[] = [];
  let index = 0;

  function readBlock(media: string | null): void {
    const open = source.indexOf("{", index);
    const close = source.indexOf("}", open);
    const selector = source.slice(index, open).replace(/\s+/g, " ").trim();
    const body = source.slice(open + 1, close);
    if (open < 0 || close < 0 || body.includes("{")) {
      throw new Error(`Unexpected rule shape near "${selector.slice(0, 40)}" in tokens.css`);
    }
    blocks.push({ selector, media, ...declarations(body) });
    index = close + 1;
  }

  for (;;) {
    while (index < source.length && /\s/.test(source[index] as string)) index += 1;
    if (index >= source.length) return blocks;
    if (source.startsWith("@media", index)) {
      const open = source.indexOf("{", index);
      if (open < 0) throw new Error("Unclosed @media in tokens.css");
      const media = source.slice(index + "@media".length, open).trim();
      index = open + 1;
      for (;;) {
        while (index < source.length && /\s/.test(source[index] as string)) index += 1;
        if (source[index] === "}") {
          index += 1;
          break;
        }
        if (index >= source.length) throw new Error("Unclosed @media in tokens.css");
        readBlock(media);
      }
    } else {
      readBlock(null);
    }
  }
}

/** The one block with exactly this selector and media (`null` = top level); throws when there is none or more than one. */
export function tokenBlock(
  blocks: readonly TokenBlock[],
  selector: string,
  media: string | null = null,
): TokenBlock {
  const found = blocks.filter((block) => block.selector === selector && block.media === media);
  if (found.length !== 1) {
    throw new Error(
      `Expected one "${selector}" block (media ${media ?? "none"}), found ${found.length}`,
    );
  }
  return found[0] as TokenBlock;
}

/** Selectors of the theme blocks in `tokens.css`. */
export const themeSelectors = {
  light: ':root, [data-theme="light"]',
  dark: '[data-theme="dark"]',
  /** Opt-in system mode: only a page whose `<html>` says `data-theme="system"` follows the OS setting. */
  system: '[data-theme="system"]',
} as const;

export const darkSchemeMedia = "(prefers-color-scheme: dark)";
