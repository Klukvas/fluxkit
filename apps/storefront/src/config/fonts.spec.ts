import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fontVariableClasses } from "../lib/font-classes";

// Source-only on purpose: `config/fonts.ts` is NEVER imported here (review M1 of PR 242). A fork fills it with `localFont({...})`
// calls, which only work under Next's font transform; Vitest has none, so a runtime import would throw
// (`default is not a function`) and take the whole storefront unit suite down.
const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const fontsFile = "config/fonts.ts";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|mts|mjs)$/.test(entry) && !/\.spec\.tsx?$/.test(entry) ? [full] : [];
  });
}

const nextFontImport = /(?:from\s+|import\s*\(\s*|import\s+)["']next\/font(?:\/[a-z-]+)?["']/;

/** Problems of a `config/fonts.ts` source, read as text: an empty template list, or local fonts each with a `variable`. */
function fontsSourceProblems(source: string): string[] {
  const problems: string[] = [];
  if (/["']next\/font\/google["']/.test(source)) problems.push("next/font/google is refused");
  if (!/export const fonts\b/.test(source)) problems.push("no `export const fonts`");
  const loadsFonts = /^import\s+localFont\s+from\s+["']next\/font\/local["']/m.test(source);
  const empty = /export const fonts\s*:[^=]*=\s*\[\s*\]\s*;/.test(source);
  if (!loadsFonts && !empty) problems.push("`fonts` lists entries but no font is loaded");
  const calls = [...source.matchAll(/\blocalFont\(\{([\s\S]*?)\}\);/g)];
  for (const call of calls) {
    if (!/\bvariable:\s*["']--font-(?:\w|-)+["']/.test(call[1] as string)) {
      problems.push('a localFont call without `variable: "--font-..."`');
    }
  }
  return problems;
}

// A fork's filled file, as text (the reproduction of review M1: this content must not break the suite).
const forkFontsSource = `import localFont from "next/font/local";

export interface ShopFont {
  readonly variable: string;
}

const display = localFont({
  src: [{ path: "./fonts/display-700.woff2", weight: "700", style: "normal" }],
  variable: "--font-display-face",
  display: "swap",
  preload: false,
});

export const fonts: readonly ShopFont[] = [display];
`;

describe("shop fonts (config/fonts.ts, plan 2026-11-08-design-changeability.md T1b)", () => {
  const fontsSource = readFileSync(join(srcRoot, fontsFile), "utf8");

  it("reads config/fonts.ts as text only (never imported by unit tests)", () => {
    const thisSpec = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(thisSpec).not.toMatch(/^import[^;]*from\s+["']\.\/fonts["']/m);
  });

  it("accepts the template (empty) and a fork's filled file, and refuses broken shapes", () => {
    expect(fontsSourceProblems(fontsSource)).toEqual([]);
    expect(fontsSourceProblems(forkFontsSource)).toEqual([]);
    expect(
      fontsSourceProblems(`export const fonts: readonly ShopFont[] = [{ variable: "x" }];`),
    ).toEqual(["`fonts` lists entries but no font is loaded"]);
    expect(
      fontsSourceProblems(forkFontsSource.replace(`variable: "--font-display-face",`, "")),
    ).toEqual(['a localFont call without `variable: "--font-..."`']);
    expect(
      fontsSourceProblems(`import { Inter } from "next/font/google";\nexport const fonts = [];`),
    ).toContain("next/font/google is refused");
  });

  it("imports next/font only from config/fonts.ts (self-hosted fonts only: CSP)", () => {
    const files = sources(srcRoot).map((file) => relative(srcRoot, file).split("\\").join("/"));
    expect(files).toContain(fontsFile);
    const offenders = files.filter(
      (file) =>
        file !== fontsFile && nextFontImport.test(readFileSync(join(srcRoot, file), "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(nextFontImport.test(`import localFont from "next/font/local";`)).toBe(true);
    expect(nextFontImport.test(`import { Inter } from "next/font/google";`)).toBe(true);
  });

  it("puts the fonts' variable classes on <html> in the root layout, once", () => {
    const layout = readFileSync(join(srcRoot, "app/[locale]/layout.tsx"), "utf8");
    expect(layout).toMatch(/<html\b[^>]*className=\{fontVariableClasses\(fonts\)\}/);
    expect(layout.match(/fontVariableClasses\(/g)).toHaveLength(1);
  });

  it("renders no class without fonts and joins the variable classes of several", () => {
    expect(fontVariableClasses([])).toBeUndefined();
    expect(fontVariableClasses([{ variable: "a" }, { variable: "b" }])).toBe("a b");
  });
});
