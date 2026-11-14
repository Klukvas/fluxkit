import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adminOverrideBlocks, brandOverridesCss } from "./theme-run.testing.js";
import {
  darkSchemeMedia,
  parseTokenBlocks,
  themeSelectors,
  tokenBlock,
  type TokenBlock,
} from "./token-blocks.js";

// Plan 2026-11-08-design-changeability.md WP2 "Storefront overrides" (PR-I2a): `brand-overrides.css` is the storefront's
// fork-owned token overrides file. The storefront stylesheet imports it LAST; the admin imports it before its own fork-owned
// overrides file (ADR 0047: the admin follows the shop). Unlike the admin's file it may hold dark and system rules: the storefront renders all three modes.

const themeSource = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = join(themeSource, "..", "..", "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The `@import` targets of a stylesheet, in source order (comments removed). */
function cssImports(css: string): string[] {
  return [...withoutComments(css).matchAll(/@import\s+["']([^"']+)["']/g)].map(
    (match) => match[1] as string,
  );
}

const skippedFolders = new Set([
  "node_modules",
  ".next",
  "dist",
  ".turbo",
  "test-results",
  "playwright-report",
  "blob-report",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skippedFolders.has(entry.name)) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

/** Tests never ship, so they may read the overrides (the theme specs do). */
const isTestFile = (path: string) =>
  /\.(spec|test|e2e)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)e2e\//.test(path);

/** The two stylesheets that import the shop's overrides (the storefront's and, since option B of PR-I2a, the admin's). */
const importingStylesheets = new Set([
  "apps/storefront/src/app/globals.css",
  "apps/admin/src/styles.css",
]);

/** Shipped source files (repository-relative path, content) other than the two importing stylesheets that name the file. */
function brandOverridesOffenders(files: readonly (readonly [string, string])[]): string[] {
  return files
    .filter(([path]) => !path.endsWith("/brand-overrides.css") && !isTestFile(path))
    .filter(([path]) => !importingStylesheets.has(path))
    .filter(([path]) => /\.(css|ts|tsx|mjs|js|json|html)$/.test(path))
    .filter(([, text]) => /brand-overrides/i.test(text))
    .map(([path]) => path);
}

const themedToken = /^--fk-(color|shadow)-/;
const allowedRules = [
  [themeSelectors.light, null],
  [themeSelectors.dark, null],
  [themeSelectors.system, darkSchemeMedia],
] as const;

/**
 * What is wrong with a storefront overrides stylesheet, given the blocks of `tokens.css`. Every rule must be one of the three
 * theme rules of `tokens.css` (same selector, same specificity: the later file wins), at most once each, in the order of
 * `tokens.css`. A colour or shadow set for light must also be set for dark and system: on `<html data-theme="dark">` the
 * override's `:root` rule matches too and, coming after the dark rule of `tokens.css`, would win (light colours in dark mode).
 */
/** Splits on commas outside parentheses (`rgb(0, 0, 0)` stays whole). */
function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

const length = /^(0|-?[0-9]*\.?[0-9]+(rem|px|em))$/;
const shadowPart =
  /^(inset\s+)?(-?[0-9]*\.?[0-9]+(px|rem)?\s+){2,4}(rgba?\([^()]*\)|#[0-9a-f]{3,8})$/i;
const fontFamily =
  /^(var\(--font-[a-z0-9-]+(?:,\s*(?:"[^"()]+"|'[^'()]+'|[a-z][\w-]*(?: [a-z][\w-]*)*)\s*)?\)|"[^"]+"|'[^']+'|[a-z][\w-]*( [a-z][\w-]*)*)$/i;

/**
 * What is wrong with one token value, for the overrides files and `tokens.css` alike: no empty value, no `!important` (any
 * spacing), colours as 6-digit hex (the contrast check reads no other format; also for colours outside its pairs), lengths
 * for radii, sizes and the spacing unit, `none` or `x y [blur [spread]] colour` shadows, and a list of font families.
 */
export function valueProblems(name: string, value: string): string[] {
  if (value.trim() === "") return [`${name} has no value`];
  if (/!\s*important/i.test(value)) return [`${name} uses !important`];
  if (name.startsWith("--fk-color-") && !/^#[0-9a-f]{6}$/i.test(value)) {
    return [`${name}: "${value}" is not a 6-digit hex colour (#rrggbb)`];
  }
  if (/^--fk-(radius|font-size|line-height|space)-/.test(name) && !length.test(value)) {
    return [`${name}: "${value}" is not a length (0, rem, px or em)`];
  }
  if (name.startsWith("--fk-shadow-") && value !== "none") {
    if (!topLevelParts(value).every((part) => shadowPart.test(part))) {
      return [
        `${name}: "${value}" is not a box shadow (x y [blur [spread]] colour, comma-separated) or none`,
      ];
    }
  }
  if (name.startsWith("--fk-motion-duration-") && !/^(?:0|[0-9]*\.?[0-9]+(?:ms|s))$/.test(value)) {
    return [`${name}: "${value}" is not a non-negative duration (0, ms or s)`];
  }
  if (name.startsWith("--fk-motion-ease-")) {
    const number = "(-?(?:[0-9]*\\.)?[0-9]+)";
    const bezier = new RegExp(
      `^cubic-bezier\\(\\s*${number}\\s*,\\s*${number}\\s*,\\s*${number}\\s*,\\s*${number}\\s*\\)$`,
    ).exec(value);
    const validBezier =
      bezier !== null && [bezier[1], bezier[3]].every((x) => Number(x) >= 0 && Number(x) <= 1);
    if (!/^(linear|ease|ease-in|ease-out|ease-in-out)$/.test(value) && !validBezier) {
      return [
        `${name}: "${value}" is not an easing (cubic-bezier x coordinates must be in [0, 1])`,
      ];
    }
  }
  if (/^--fk-font-(sans|mono|display)$/.test(name)) {
    if (!topLevelParts(value).every((family) => fontFamily.test(family))) {
      return [`${name}: "${value}" is not a list of font families`];
    }
  }
  return [];
}

/** A selector or media written differently from `tokens.css` only in spaces or quotes. */
const spelling = (text: string | null) => (text ?? "").replace(/\s+/g, "").replace(/'/g, '"');

function overridesProblems(css: string, tokenBlocks: readonly TokenBlock[]): string[] {
  let blocks: TokenBlock[];
  try {
    blocks = parseTokenBlocks(css, "brand-overrides.css");
  } catch (error) {
    return [`not a token overrides stylesheet: ${(error as Error).message}`];
  }
  const problems: string[] = [];
  const known = new Set(tokenBlock(tokenBlocks, themeSelectors.light).tokens.keys());
  const indexes: number[] = [];
  for (const block of blocks) {
    const where = `"${block.selector}"${block.media === null ? "" : ` in @media ${block.media}`}`;
    const rule = allowedRules.findIndex(
      ([selector, media]) => block.selector === selector && block.media === media,
    );
    const respelled = allowedRules.find(
      ([selector, media]) =>
        spelling(block.selector) === spelling(selector) &&
        spelling(block.media) === spelling(media),
    );
    if (rule < 0 && respelled) {
      const [selector, media] = respelled;
      problems.push(
        `${where}: write the selector exactly as in tokens.css: ${media === null ? selector : `@media ${media} { ${selector} }`}`,
      );
      continue;
    }
    if (rule < 0) {
      problems.push(
        `${where}: use only the selectors of tokens.css (${allowedRules
          .map(([selector, media]) => (media === null ? selector : `${selector} in ${media}`))
          .join("; ")}); another one has another specificity or another meaning`,
      );
      continue;
    }
    if (indexes.includes(rule)) problems.push(`${where}: written twice (one rule per theme)`);
    if (indexes.some((index) => index > rule)) {
      problems.push(`${where}: keep the order of tokens.css (light, dark, system)`);
    }
    indexes.push(rule);
    for (const name of block.properties.keys()) {
      problems.push(`${where}: ${name} is not a token (only --fk-* overrides here)`);
    }
    for (const [name, value] of block.tokens) {
      if (!known.has(name)) problems.push(`${where}: ${name} is not a token of tokens.css`);
      problems.push(...valueProblems(name, value).map((problem) => `${where}: ${problem}`));
      if (rule > 0 && !themedToken.test(name)) {
        problems.push(`${where}: ${name} is not a colour or shadow; set it in the light rule only`);
      }
    }
  }
  const tokensOf = (rule: number) =>
    blocks.find(
      (block) =>
        block.selector === allowedRules[rule]?.[0] && block.media === allowedRules[rule]?.[1],
    )?.tokens ?? new Map<string, string>();
  const [light, dark, system] = [tokensOf(0), tokensOf(1), tokensOf(2)];
  for (const name of [...light.keys()].filter((token) => themedToken.test(token))) {
    if (!dark.has(name)) problems.push(`${name} is set for light but not for dark`);
  }
  if (JSON.stringify([...system]) !== JSON.stringify([...dark])) {
    problems.push(
      "the system rule must hold exactly the dark rule's tokens and values, in the same order",
    );
  }
  return problems;
}

const tokenBlocks = parseTokenBlocks(read("packages/theme/src/tokens.css"));

describe("the storefront's fork-owned token overrides (brand-overrides.css)", () => {
  it("is exported by @fluxkit/theme", () => {
    const pkg = JSON.parse(read("packages/theme/package.json")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./brand-overrides.css"]).toBe("./src/brand-overrides.css");
  });

  it("is imported by the storefront stylesheet last, after the tokens and the Tailwind mapping, and the admin overrides never", () => {
    expect(cssImports(read("apps/storefront/src/app/globals.css"))).toEqual([
      "tailwindcss",
      "@fluxkit/theme/tokens.css",
      "@fluxkit/theme/tailwind.css",
      "@fluxkit/theme/brand-overrides.css",
    ]);
  });

  it("is imported by the admin stylesheet too, before the admin's own overrides (the admin follows the shop, ADR 0047)", () => {
    // Option B of PR-I2a: admin effective = tokens.css + brand-overrides.css (light rule) + admin-overrides.css.
    expect(cssImports(read("apps/admin/src/styles.css"))).toEqual([
      "tailwindcss",
      "@fluxkit/theme/tokens.css",
      "@fluxkit/theme/tailwind.css",
      "@fluxkit/theme/brand-overrides.css",
      "@fluxkit/theme/admin-overrides.css",
    ]);
  });

  it("is not named by other shipped sources of the admin, the UI library or the other theme files", () => {
    const files = [join(repoRoot, "apps", "admin"), join(repoRoot, "packages", "ui"), themeSource]
      .flatMap(sourceFiles)
      .map((file) => [relative(repoRoot, file), readFileSync(file, "utf8")] as const);
    expect(files.length).toBeGreaterThan(20);
    expect(brandOverridesOffenders(files)).toEqual([]);
  });

  it("refuses a mention in shipped code and allows one in a test (the source scan itself)", () => {
    expect(
      brandOverridesOffenders([
        ["apps/admin/src/styles.css", '@import "@fluxkit/theme/brand-overrides.css";'],
        ["apps/admin/src/main.tsx", 'import "@fluxkit/theme/brand-overrides.css";'],
        ["apps/admin/index.html", '<link href="/brand-overrides.css">'],
        ["packages/ui/src/button.tsx", "// Brand-Overrides"],
        ["packages/theme/src/index.ts", 'export const x = "brand-overrides.css";'],
        ["packages/theme/src/brand-overrides.css", ":root{}"],
        ["packages/theme/src/contrast.spec.ts", 'read("brand-overrides.css")'],
        ["apps/admin/e2e/tests/theme.e2e.ts", "// brand-overrides"],
      ]),
    ).toEqual([
      "apps/admin/src/main.tsx",
      "apps/admin/index.html",
      "packages/ui/src/button.tsx",
      "packages/theme/src/index.ts",
    ]);
  });

  it("holds only overrides of the theme rules of tokens.css (the file this run reads: the real one, or the fork fixture)", () => {
    expect(overridesProblems(brandOverridesCss, tokenBlocks)).toEqual([]);
  });

  it("holds valid values in tokens.css and in the admin overrides this run reads (the same value rules)", () => {
    const problems = [...tokenBlocks, ...adminOverrideBlocks].flatMap((block) =>
      [...block.tokens].flatMap(([name, value]) => valueProblems(name, value)),
    );
    expect(problems).toEqual([]);
  });
});

describe("the overrides rules (the checker itself)", () => {
  const light =
    ':root,\n[data-theme="light"] {\n  --fk-color-primary: #1f5f4a;\n  --fk-radius-card: 0;\n}';
  const dark = '[data-theme="dark"] {\n  --fk-color-primary: #62b796;\n}';
  const system =
    '@media (prefers-color-scheme: dark) {\n  [data-theme="system"] {\n    --fk-color-primary: #62b796;\n  }\n}';

  it("accepts an empty file, a light-only radius, and a colour in all three rules (dark and system rules are allowed here)", () => {
    expect(overridesProblems("/* nothing */", tokenBlocks)).toEqual([]);
    expect(
      overridesProblems(':root, [data-theme="light"] { --fk-radius-card: 0; }', tokenBlocks),
    ).toEqual([]);
    expect(overridesProblems(`${light}\n${dark}\n${system}`, tokenBlocks)).toEqual([]);
    expect(overridesProblems(`${dark}\n${system}`, tokenBlocks)).toEqual([]);
  });

  it("refuses a colour set for light only (it would leak into dark and system)", () => {
    expect(overridesProblems(light, tokenBlocks)).toEqual([
      "--fk-color-primary is set for light but not for dark",
    ]);
  });

  it("refuses a system rule that differs from the dark rule", () => {
    expect(
      overridesProblems(`${light}\n${dark}\n${system.replace("#62b796", "#000000")}`, tokenBlocks),
    ).toEqual([
      "the system rule must hold exactly the dark rule's tokens and values, in the same order",
    ]);
  });

  it("refuses other selectors, other media, unknown tokens, other properties, !important, repeats and another order", () => {
    const problems = (css: string) => overridesProblems(css, tokenBlocks).join("\n");
    expect(problems("html { --fk-radius-card: 0; }")).toMatch(/"html": use only the selectors/);
    expect(problems(":root { --fk-radius-card: 0; }")).toMatch(/":root": use only the selectors/);
    expect(problems('html[data-theme="dark"] { --fk-color-primary: #000000; }')).toMatch(
      /use only the selectors/,
    );
    expect(
      problems(
        '@media (prefers-color-scheme: dark) { :root, [data-theme="light"] { --fk-radius-card: 0; } }',
      ),
    ).toMatch(/use only the selectors/);
    expect(problems(':root, [data-theme="light"] { --fk-color-brand: #000000; }')).toMatch(
      /--fk-color-brand is not a token/,
    );
    expect(problems(':root, [data-theme="light"] { color-scheme: dark; }')).toMatch(
      /color-scheme is not a token/,
    );
    expect(problems(':root, [data-theme="light"] { --fk-radius-card: 0 !important; }')).toMatch(
      /uses !important/,
    );
    expect(
      problems(':root, [data-theme="light"] { --fk-color-ring: #111111 ! important; }'),
    ).toMatch(/uses !important/);
    expect(
      problems(':root, [data-theme="light"] { --fk-color-ring: #111111 !\tIMPORTANT; }'),
    ).toMatch(/uses !important/);
    expect(problems(`${dark}\n${dark}\n${system}`)).toMatch(/written twice/);
    expect(problems(`${dark}\n${light}\n${system}`)).toMatch(/keep the order of tokens.css/);
    expect(problems('[data-theme="dark"] { --fk-radius-card: 0; }')).toMatch(
      /--fk-radius-card is not a colour or shadow/,
    );
    expect(problems(":root { a { --b: 1; } }")).toMatch(/not a token overrides stylesheet/);
    expect(problems('@font-face { font-family: "X"; src: url("/x.woff2"); }')).toMatch(
      /use only the selectors/,
    );
  });

  it("names the exact spelling when a selector or media differs from tokens.css only in spaces or quotes", () => {
    const problems = (css: string) => overridesProblems(css, tokenBlocks).join("\n");
    expect(problems(':root,[data-theme="light"] { --fk-radius-card: 0; }')).toMatch(
      /write the selector exactly as in tokens.css: :root, \[data-theme="light"\]/,
    );
    expect(problems("[data-theme='dark'] { --fk-color-primary: #000000; }")).toMatch(
      /write the selector exactly as in tokens.css: \[data-theme="dark"\]/,
    );
    expect(
      problems(
        '@media (prefers-color-scheme:dark) { [data-theme="system"] { --fk-color-primary: #000000; } }',
      ),
    ).toMatch(/write the selector exactly as in tokens.css: @media \(prefers-color-scheme: dark\)/);
  });

  it("refuses empty and invalid values with a message naming the token", () => {
    const problems = (declaration: string) =>
      overridesProblems(`:root, [data-theme="light"] { ${declaration} }`, tokenBlocks).join("\n");
    expect(problems("--fk-radius-card: ;")).toMatch(/--fk-radius-card has no value/);
    expect(problems("--fk-radius-card: banana;")).toMatch(
      /--fk-radius-card: "banana" is not a length/,
    );
    expect(problems("--fk-color-border: red; ")).toMatch(
      /--fk-color-border: "red" is not a 6-digit hex/,
    );
    expect(problems("--fk-color-border: #fff;")).toMatch(/is not a 6-digit hex/);
    expect(problems("--fk-shadow-card: banana;")).toMatch(
      /--fk-shadow-card: "banana" is not a box shadow/,
    );
    expect(problems("--fk-font-sans: 12px;")).toMatch(
      /--fk-font-sans: "12px" is not a list of font families/,
    );
    for (const valid of [
      "--fk-radius-card: 0;",
      "--fk-radius-card: 9999px;",
      "--fk-shadow-card: none;",
      "--fk-shadow-card: 0 1px 2px 0 rgb(23 36 30 / 0.06), inset 0 0 0 1px rgba(0, 0, 0, 0.1);",
      '--fk-font-display: var(--font-display-face), "Times New Roman", ui-serif, serif;',
    ]) {
      // Only the value rules here (a light-only colour or shadow is the separate rule above).
      expect(
        problems(valid)
          .replace(/^.* is set for light but not for dark$/gm, "")
          .trim(),
        valid,
      ).toBe("");
    }
  });

  it("names the overrides file when it cannot be parsed", () => {
    expect(overridesProblems(":root { nonsense }", tokenBlocks).join("")).toMatch(
      /Unreadable declaration "nonsense" in brand-overrides.css/,
    );
  });
});

describe("motion and font value validation", () => {
  it("accepts non-negative durations and rejects malformed or negative values", () => {
    for (const value of ["0", "0ms", "150ms", "0.25s", ".4s"])
      expect(valueProblems("--fk-motion-duration-fast", value)).toEqual([]);
    for (const value of ["-1ms", "250", "ms", "1px", "calc(1s)"])
      expect(valueProblems("--fk-motion-duration-fast", value)).not.toEqual([]);
  });
  it("accepts named easings and bezier overshoot, but constrains x coordinates", () => {
    for (const value of [
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "cubic-bezier(0.34, 1.56, 0.64, 1)",
    ])
      expect(valueProblems("--fk-motion-ease-spring", value)).toEqual([]);
    for (const value of [
      "banana",
      "cubic-bezier(-0.1, 0, 1, 1)",
      "cubic-bezier(0, 0, 1.1, 1)",
      "cubic-bezier(0, 1, 1)",
      "cubic-bezier(0, x, 1, 1)",
    ])
      expect(valueProblems("--fk-motion-ease-spring", value)).not.toEqual([]);
  });
  it("accepts the template var fallback precisely without accepting invalid font expressions", () => {
    expect(
      valueProblems(
        "--fk-font-sans",
        "var(--font-template-sans, ui-sans-serif), system-ui, sans-serif",
      ),
    ).toEqual([]);
    for (const value of [
      "var(--font-body,)",
      "var(--font-body, 12px)",
      "var(--font-body, url(x))",
      "garbage()",
      "12px",
    ])
      expect(valueProblems("--fk-font-sans", value)).not.toEqual([]);
  });
});
