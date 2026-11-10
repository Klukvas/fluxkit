/**
 * The shop's own web fonts. FORK-OWNED: empty in the template, and upstream never edits this file after creating it, so a
 * client fork fills it without merge conflicts (plan 2026-11-08-design-changeability.md, principle 6). Rules and the token
 * side: README "Fonts" and `docs/contracts/theme-tokens.md` ("Fonts").
 *
 * `next/font/local` is imported only here (`fonts.spec.ts`). Each font's `.variable` class is put on `<html>` once by the root
 * layout, so a token on `:root` can name it. Example for a heading face (woff2 files next to this file, in `fonts/`):
 *
 *   import localFont from "next/font/local";
 *
 *   const display = localFont({
 *     src: [
 *       { path: "./fonts/display-600.woff2", weight: "600", style: "normal" },
 *       { path: "./fonts/display-700.woff2", weight: "700", style: "normal" },
 *     ],
 *     variable: "--font-display-face",
 *     display: "swap",
 *     preload: false,
 *     adjustFontFallback: "Arial",
 *   });
 *
 *   export const fonts: readonly ShopFont[] = [display];
 *
 * and in `packages/theme/src/brand-overrides.css` (light rule):
 * `--fk-font-display: var(--font-display-face), ui-sans-serif, system-ui, sans-serif;`
 */

/** What the layout needs of a `next/font/local` result: its `variable` class. */
export interface ShopFont {
  readonly variable: string;
}

export const fonts: readonly ShopFont[] = [];
