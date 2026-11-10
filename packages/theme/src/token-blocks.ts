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

/** What a page's `<html>` and device say: the `data-theme` value (`null`: no attribute) and whether the OS asks for dark. */
export interface PageState {
  theme: "light" | "dark" | "system" | null;
  osDark: boolean;
}

/** Whether one selector of a block's list matches the page root; only the selector shapes of the theme files are known. */
function selectorMatches(selector: string, state: PageState): boolean {
  if (selector === ":root") return true;
  const attribute = /^\[data-theme="(light|dark|system)"\]$/.exec(selector);
  if (attribute) return attribute[1] === state.theme;
  throw new Error(
    `Unknown selector "${selector}": the theme files use only :root and [data-theme="..."]`,
  );
}

function mediaMatches(media: string | null, state: PageState): boolean {
  if (media === null) return true;
  if (media === darkSchemeMedia) return state.osDark;
  throw new Error(`Unknown media query "${media}" in a theme file`);
}

/**
 * The EFFECTIVE token values on the page root: the blocks of every stylesheet in import order (`tokens.css`, then an overrides
 * file), each block that matches the page applied in turn, so a later block wins. Source order alone decides because every
 * known selector has the same specificity (one pseudo-class or one attribute: 0,1,0); an unknown selector or media throws.
 * Example: an override of `:root, [data-theme="light"]` also matches a dark page and beats the dark block of `tokens.css`.
 */
export function effectiveTokens(
  blocks: readonly TokenBlock[],
  state: PageState,
): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const block of blocks) {
    // Every selector and the media are read even when an earlier one decides: an unknown shape always throws.
    const selectors = block.selector.split(",").map((part) => selectorMatches(part.trim(), state));
    if (!mediaMatches(block.media, state) || !selectors.includes(true)) continue;
    for (const [name, value] of block.tokens) tokens.set(name, value);
  }
  return tokens;
}

/** The page states the storefront renders: light (also the default), dark, and system on a light and on a dark device. */
export const storefrontStates = {
  light: { theme: "light", osDark: false },
  dark: { theme: "dark", osDark: false },
  "system on a light OS": { theme: "system", osDark: false },
  "system on a dark OS": { theme: "system", osDark: true },
} as const satisfies Record<string, PageState>;

/** The one page state of the admin: `<html data-theme="light">`, whatever the device says (ADR 0047). */
export const adminState: PageState = { theme: "light", osDark: true };
