import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Design batch B (plan 2026-11-03-storefront-design-b.md): `@fluxkit/theme` gained a system mode that follows the OS dark
// setting. The admin shares the tokens but must not change: it renders `data-theme="light"`, and the BUILT stylesheet may
// follow `prefers-color-scheme` only for `[data-theme=system]`, a value the admin never sets. Reads the output of
// `vite build` (`pnpm test` builds first; turbo runs this package's build before its tests).

const appRoot = join(import.meta.dirname, "..");
const dist = join(appRoot, "dist");
const repoRoot = join(appRoot, "..", "..");
const themeSource = join(repoRoot, "packages", "theme", "src");

function builtCss(): string {
  const assets = join(dist, "assets");
  if (!existsSync(assets)) {
    throw new Error(
      "apps/admin/dist is missing: run `pnpm build` (the root `pnpm test` does) before this spec.",
    );
  }
  const files = readdirSync(assets).filter((name) => name.endsWith(".css"));
  expect(files.length, "built CSS files").toBeGreaterThan(0);
  return files.map((name) => readFileSync(join(assets, name), "utf8")).join("\n");
}

/** The bodies of every `@media (...prefers-color-scheme...)` rule, braces balanced. */
function colorSchemeMediaBlocks(css: string): string[] {
  const blocks: string[] = [];
  for (const match of css.matchAll(/@media[^{]*prefers-color-scheme[^{]*\{/g)) {
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
  }
  return blocks;
}

describe("the admin is not affected by the storefront's dark and system themes", () => {
  it("renders its page with data-theme=light, in the source and in the built index.html", () => {
    expect(readFileSync(join(appRoot, "index.html"), "utf8")).toMatch(
      /<html [^>]*data-theme="light"/,
    );
    expect(readFileSync(join(dist, "index.html"), "utf8")).toMatch(/<html [^>]*data-theme="light"/);
  });

  it("follows the OS colour scheme in the built CSS only for [data-theme=system]", () => {
    const blocks = colorSchemeMediaBlocks(builtCss());
    expect(blocks.length, "the tokens' system block is in the build").toBeGreaterThan(0);
    for (const block of blocks) {
      const selectors = [...block.matchAll(/([^{}]+)\{/g)].map((match) =>
        (match[1] as string).trim(),
      );
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        expect(selector.replace(/["']/g, ""), "a dark rule outside the opt-in system mode").toBe(
          "[data-theme=system]",
        );
      }
    }
  });

  it("keeps the light values on the page root and color-scheme light", () => {
    const css = builtCss();
    expect(css).toMatch(/:root,\s*\[data-theme=["']?light["']?\]\s*\{[^}]*color-scheme:\s*light/);
    expect(css).toMatch(/:root,\s*\[data-theme=["']?light["']?\]\s*\{[^}]*--fk-color-background:/);
  });

  it("is the scanner itself sound (a selector outside the system mode is found)", () => {
    const blocks = colorSchemeMediaBlocks(
      "@media (prefers-color-scheme:dark){:root{--a:1}[data-theme=system]{--a:2}}",
    );
    expect(blocks).toEqual([":root{--a:1}[data-theme=system]{--a:2}"]);
  });
});

// ADR 0047 (plan 2026-11-08-design-changeability.md, B2): the admin follows the shop's tokens; a fork themes the admin
// alone in `packages/theme/src/admin-overrides.css` (fork-owned, empty upstream). It comes after the shared tokens and the
// Tailwind mapping (a later rule of equal specificity wins), and the storefront never receives it.

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

/** Every file under `dir`, without dependencies and build or test output. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skippedFolders.has(entry.name)) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

/** A test file: a spec, an e2e scenario or e2e support code. Tests never ship, so they may read the overrides. */
const isTestFile = (path: string) =>
  /\.(spec|test|e2e)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)e2e\//.test(path);

/**
 * The shipped source files (repository-relative path, content) that mention the admin overrides: an import, a URL or a
 * name would bring the admin's values to the storefront. Tests are skipped (see `isTestFile`).
 */
function overridesOffenders(files: readonly (readonly [string, string])[]): string[] {
  return files
    .filter(([path]) => !path.endsWith("admin-overrides.css") && !isTestFile(path))
    .filter(([path]) => /\.(css|ts|tsx|mjs|js|json)$/.test(path))
    .filter(([, text]) => text.includes("admin-overrides"))
    .map(([path]) => path);
}

/** Dark, system or OS-following rules in an overrides stylesheet (comments removed). */
function forbiddenOverrideRules(css: string): string[] {
  const source = withoutComments(css);
  return [
    ...source.matchAll(/prefers-color-scheme/gi),
    ...source.matchAll(/data-theme\s*[~|^$*]?=\s*["']?\s*(dark|system)/gi),
  ].map((match) => match[0]);
}

describe("the fork-owned admin overrides (ADR 0047)", () => {
  it("imports admin-overrides.css last, after the shared tokens, the Tailwind mapping and the shop's overrides", () => {
    // The admin follows the shop (ADR 0047 decision 1): the storefront's fork-owned `brand-overrides.css` comes before the
    // admin's own overrides, which win for the admin alone (PR-I2a, option B).
    expect(cssImports(readFileSync(join(appRoot, "src", "styles.css"), "utf8"))).toEqual([
      "tailwindcss",
      "@fluxkit/theme/tokens.css",
      "@fluxkit/theme/tailwind.css",
      "@fluxkit/theme/brand-overrides.css",
      "@fluxkit/theme/admin-overrides.css",
    ]);
  });

  it("would still pass the built-CSS check with a filled shop overrides file: its dark rule never matches the light page, its media rule is the system one", () => {
    // The storefront overrides may hold `[data-theme="dark"]` and the system media rule; neither matches `data-theme="light"`.
    // The check of the built CSS above allows a colour-scheme media rule only for `[data-theme=system]`: a fork's filled file
    // (the theme package's fork fixture) passes it.
    const filled = withoutComments(
      readFileSync(join(themeSource, "fork-fixture", "brand-overrides.css"), "utf8"),
    );
    const blocks = colorSchemeMediaBlocks(filled);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      for (const match of block.matchAll(/([^{}]+)\{/g)) {
        expect((match[1] as string).trim().replace(/["']/g, "")).toBe("[data-theme=system]");
      }
    }
    expect(filled).toMatch(/\[data-theme="dark"\]\s*\{/);
  });

  it("is a file of @fluxkit/theme that adds no dark or OS-following rule", () => {
    const pkg = JSON.parse(readFileSync(join(themeSource, "..", "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./admin-overrides.css"]).toBe("./src/admin-overrides.css");
    // The admin renders data-theme="light": a dark block would never apply, and an OS-following block would leak the OS
    // setting into the admin (the built-CSS check above fails on a prefers-color-scheme rule too).
    expect(
      forbiddenOverrideRules(readFileSync(join(themeSource, "admin-overrides.css"), "utf8")),
    ).toEqual([]);
  });

  it("finds dark, system and OS-following rules in any letter case and spacing (the source check itself)", () => {
    for (const css of [
      "[data-theme=dark]{--fk-radius-md:0}",
      "[DATA-THEME=dark]{--fk-radius-md:0}",
      '[data-theme = "dark"]{--fk-radius-md:0}',
      "[ data-theme='System' i ]{--fk-radius-md:0}",
      "@media (PREFERS-COLOR-SCHEME: dark){:root{--fk-radius-md:0}}",
    ]) {
      expect(forbiddenOverrideRules(css), css).not.toEqual([]);
    }
    for (const css of [
      ':root, [data-theme="light"] {--fk-radius-md:0}',
      '/* no [data-theme="dark"] and no prefers-color-scheme here */ :root{}',
    ]) {
      expect(forbiddenOverrideRules(css), css).toEqual([]);
    }
  });

  it("never reaches the storefront, the UI library or the shared theme files", () => {
    const roots = [
      join(repoRoot, "apps", "storefront"),
      join(repoRoot, "packages", "ui"),
      themeSource,
    ];
    const files = roots
      .flatMap(sourceFiles)
      .map((file) => [relative(repoRoot, file), readFileSync(file, "utf8")] as const);
    expect(overridesOffenders(files)).toEqual([]);
  });

  it("refuses a mention in shipped code and allows one in a test (the source scan itself)", () => {
    const mention = '@import "@fluxkit/theme/admin-overrides.css";';
    expect(
      overridesOffenders([
        ["apps/storefront/src/app/globals.css", mention],
        ["apps/storefront/src/app/layout.tsx", 'import "@fluxkit/theme/admin-overrides.css";'],
        ["packages/ui/src/button.tsx", "// admin-overrides"],
        ["packages/theme/src/tokens.css", mention],
        ["packages/theme/src/index.ts", 'export const x = "admin-overrides.css";'],
      ]),
    ).toEqual([
      "apps/storefront/src/app/globals.css",
      "apps/storefront/src/app/layout.tsx",
      "packages/ui/src/button.tsx",
      "packages/theme/src/tokens.css",
      "packages/theme/src/index.ts",
    ]);
    // A spec may read the overrides (the planned contrast check of the effective admin values, plan B2).
    expect(
      overridesOffenders([
        ["packages/theme/src/contrast.spec.ts", 'read("admin-overrides.css")'],
        ["packages/ui/src/button.spec.tsx", "// admin-overrides"],
        ["apps/storefront/e2e/tests/theme.e2e.ts", "// admin-overrides"],
        ["apps/storefront/e2e/support/pages.ts", "// admin-overrides"],
      ]),
    ).toEqual([]);
  });

  it("reads imports in order and walks the storefront (the scanners themselves)", () => {
    expect(cssImports('/* @import "x.css"; */ @import "a.css";\n@import \'b.css\';')).toEqual([
      "a.css",
      "b.css",
    ]);
    const storefront = sourceFiles(join(repoRoot, "apps", "storefront"));
    expect(storefront.some((file) => file.endsWith("globals.css"))).toBe(true);
    expect(storefront.some((file) => file.includes("node_modules"))).toBe(false);
  });
});
