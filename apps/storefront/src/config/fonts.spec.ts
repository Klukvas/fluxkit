import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fontVariableClasses } from "../lib/font-classes";
import { fonts } from "./fonts";

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

describe("shop fonts (config/fonts.ts, plan 2026-11-08-design-changeability.md T1b)", () => {
  const fontsSource = readFileSync(join(srcRoot, fontsFile), "utf8");

  it("declares no font in the template: the list is empty while the file loads no font", () => {
    const declaresFonts = /^import\s+localFont\s+from\s+["']next\/font\/local["']/m.test(
      fontsSource,
    );
    expect(declaresFonts || fonts.length === 0).toBe(true);
    expect(fontVariableClasses([])).toBeUndefined();
  });

  it("gives every declared font a variable class (next/font/local with `variable`)", () => {
    for (const font of fonts) {
      expect(font.variable).toMatch(/^\S+$/);
    }
  });

  it("imports next/font only from config/fonts.ts, and never next/font/google (self-hosted fonts only: CSP)", () => {
    const files = sources(srcRoot).map((file) => relative(srcRoot, file).split("\\").join("/"));
    expect(files).toContain(fontsFile);
    const offenders = files.filter(
      (file) =>
        file !== fontsFile && nextFontImport.test(readFileSync(join(srcRoot, file), "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(fontsSource).not.toMatch(/["']next\/font\/google["']/);
    expect(nextFontImport.test(`import localFont from "next/font/local";`)).toBe(true);
    expect(nextFontImport.test(`import { Inter } from "next/font/google";`)).toBe(true);
  });

  it("puts the fonts' variable classes on <html> in the root layout, once", () => {
    const layout = readFileSync(join(srcRoot, "app/[locale]/layout.tsx"), "utf8");
    expect(layout).toMatch(/<html\b[^>]*className=\{fontVariableClasses\(fonts\)\}/);
    expect(layout.match(/fontVariableClasses\(/g)).toHaveLength(1);
  });

  it("joins the variable classes of several fonts", () => {
    expect(fontVariableClasses([{ variable: "a" }, { variable: "b" }])).toBe("a b");
  });
});
