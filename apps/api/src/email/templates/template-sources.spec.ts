import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The source rules of `templates/` (ADR 0031 decision 14 and open question 6, decided here: a spec, not a lint plugin,
 * so no new dependency): markup is written with the `html` tag only (it escapes every value), `unsafeRawHtml` is not
 * used, and no color, font or size is written literally: they come from `context.theme` (`emailTheme`), so a rebrand
 * changes the tokens, never a template. A hairline border (`1px`), `0` and `100%` are structure, not design values.
 */

const directory = fileURLToPath(new URL(".", import.meta.url));

function sources(): [string, string][] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
    .sort()
    .map((file) => [file, readFileSync(join(directory, file), "utf8")]);
}

/** Comments may name what they forbid. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("template sources", () => {
  it("are found (the guard checks something)", () => {
    expect(sources().map(([file]) => file)).toEqual(
      expect.arrayContaining(["admin-test.template.ts", "email-layout.ts"]),
    );
  });

  it.each(sources())("%s writes markup only through the html tag", (_file, source) => {
    const text = code(source);
    expect(text).not.toContain("unsafeRawHtml");
    for (const match of text.matchAll(/(\bhtml)?`((?:[^`\\]|\\.)*)`/g)) {
      if (/<[a-zA-Z!/]/.test(match[2] ?? "")) {
        expect({ literal: match[0].slice(0, 60), tagged: match[1] === "html" }).toMatchObject({
          tagged: true,
        });
      }
    }
    for (const match of text.matchAll(/(["'])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      expect({ literal: match[0], markup: /<[a-zA-Z!/]/.test(match[2] ?? "") }).toMatchObject({
        markup: false,
      });
    }
  });

  it.each(sources())("%s writes no literal color, font or size", (_file, source) => {
    const text = code(source);
    expect(text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(text.match(/\b(rgba?|hsla?)\(/g) ?? []).toEqual([]);
    expect(
      (text.match(/\b\d+(\.\d+)?(px|em|rem|pt)\b/g) ?? []).filter((size) => size !== "1px"),
    ).toEqual([]);
    expect(text.match(/font-family:\s*[^$\s]/g) ?? []).toEqual([]);
    expect(text.match(/font-size:\s*[^$\s]/g) ?? []).toEqual([]);
    expect(text.match(/(?<![\w-])color:\s*[^$\s]/g) ?? []).toEqual([]);
  });
});
