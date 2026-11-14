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
const URL_SOURCE = new RegExp(`${CSS_OPAQUE}|((?<![-\\w\\\\\u0080-\uffff])url\\()`, "gi");

export type VisualFontFace = {
  family: string;
  weight: string;
  style: string;
  status: FontFaceLoadStatus;
};

export type VisualFontRule = { family: string; src: string };

function normalizedFamily(family: string): string {
  return family
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .toLowerCase();
}

function hasUrlSource(src: string): boolean {
  // Quoted local() names may themselves contain "url("; only a function token counts.
  return [...src.matchAll(URL_SOURCE)].some((match) => match[1] !== undefined);
}

/** Missing local() aliases legitimately fall through the font stack; requested URL fonts must settle before comparison. */
export function unsettledWebFonts(
  faces: readonly VisualFontFace[],
  rules: readonly VisualFontRule[],
): VisualFontFace[] {
  const webFamilies = new Set(
    rules.filter((rule) => hasUrlSource(rule.src)).map((rule) => normalizedFamily(rule.family)),
  );
  // A family shared by URL and local-only rules is conservatively checked: faces expose no source provenance.
  return faces.filter(
    (face) =>
      webFamilies.has(normalizedFamily(face.family)) &&
      (face.status === "loading" || face.status === "error"),
  );
}

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
