import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brandOverridesCss } from "./theme-run.testing.js";
import {
  darkSchemeMedia,
  parseTokenBlocks,
  themeSelectors,
  tokenBlock,
  type TokenBlock,
} from "./token-blocks.js";

// Plan 2026-11-08-design-changeability.md WP2 "Storefront overrides" (PR-I2a): `brand-overrides.css` is the storefront's
// fork-owned token overrides file. The storefront stylesheet imports it LAST; the admin never does (it has its own fork-owned
// overrides file, ADR 0047). Unlike the admin's file it may hold dark and system rules: the storefront renders all three modes.

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

/** Shipped source files (repository-relative path, content) outside the storefront that mention the storefront overrides. */
function brandOverridesOffenders(files: readonly (readonly [string, string])[]): string[] {
  return files
    .filter(([path]) => !path.endsWith("/brand-overrides.css") && !isTestFile(path))
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
function overridesProblems(css: string, tokenBlocks: readonly TokenBlock[]): string[] {
  let blocks: TokenBlock[];
  try {
    blocks = parseTokenBlocks(css);
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
      if (/!important/i.test(value)) problems.push(`${where}: ${name} uses !important`);
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

  it("is never imported by the admin stylesheet (the admin has its own overrides file)", () => {
    const imports = cssImports(read("apps/admin/src/styles.css"));
    expect(imports).toContain("@fluxkit/theme/tokens.css");
    expect(imports.filter((target) => /brand-overrides/i.test(target))).toEqual([]);
  });

  it("is not named by shipped sources of the admin, the UI library or the other theme files", () => {
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
        ["apps/admin/index.html", '<link href="/brand-overrides.css">'],
        ["packages/ui/src/button.tsx", "// Brand-Overrides"],
        ["packages/theme/src/index.ts", 'export const x = "brand-overrides.css";'],
        ["packages/theme/src/brand-overrides.css", ":root{}"],
        ["packages/theme/src/contrast.spec.ts", 'read("brand-overrides.css")'],
        ["apps/admin/e2e/tests/theme.e2e.ts", "// brand-overrides"],
      ]),
    ).toEqual([
      "apps/admin/src/styles.css",
      "apps/admin/index.html",
      "packages/ui/src/button.tsx",
      "packages/theme/src/index.ts",
    ]);
  });

  it("holds only overrides of the theme rules of tokens.css (the file this run reads: the real one, or the fork fixture)", () => {
    expect(overridesProblems(brandOverridesCss, tokenBlocks)).toEqual([]);
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
});
