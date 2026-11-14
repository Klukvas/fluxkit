import type { Page } from "@playwright/test";

// Skip comments and quoted strings, including braces/semicolons inside URLs and font names.
const CSS_OPAQUE = String.raw`/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`;
const CSS_SPACE = String.raw`(?:\s|/\*[\s\S]*?\*/)*`;
const FONT_FACE = new RegExp(
  `${CSS_OPAQUE}|(@font-face\\s*\\{)((?:${CSS_OPAQUE}|[^{}"'/]|/(?!\\*))*)\\}`,
  "gi",
);
const OPTIONAL_DISPLAY = new RegExp(
  `((?:^|;)${CSS_SPACE}font-display${CSS_SPACE}:${CSS_SPACE})optional(?=${CSS_SPACE}(?:;|$))|${CSS_OPAQUE}`,
  "gi",
);

/**
 * The comparison measures settled typography. With `optional`, a cold context may keep fallback metrics for the
 * document's lifetime; `document.fonts.ready` alone cannot make frames deterministic. Only the harness's browser
 * switches optional faces to block, then waits and checks fonts in scripted and script-free frames. Product behaviour
 * (the CLS reason in template-fonts.ts) is unchanged. Both sides run this harness, so they render the same way.
 */
export function blockOptionalFontDisplay(css: string): string {
  return css.replace(FONT_FACE, (match: string, opening: string | undefined, body: string) => {
    if (opening === undefined) return match;
    const rewritten = body.replace(
      OPTIONAL_DISPLAY,
      (descriptor: string, prefix: string | undefined) =>
        prefix === undefined ? descriptor : `${prefix}block`,
    );
    return `${opening}${rewritten}}`;
  });
}

/** Install before navigation; URL pathname matching also accepts cache-busting query strings. */
export async function installVisualFonts(page: Page, origin: string): Promise<void> {
  await page.route(
    (url) => url.origin === origin && /^\/_next\/static\/.*\.css$/.test(url.pathname),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: blockOptionalFontDisplay(await response.text()) });
    },
  );
}
