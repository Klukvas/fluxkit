import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Review B1 of PR 216: `.fk-header-button` was an unlayered rule with `@apply inline-flex`. Tailwind v4 puts its utilities
 * in `@layer utilities`, and unlayered CSS beats any layer, so `lg:hidden` on the same element never applied and a search
 * icon showed on desktop. Every `.fk-*` component class must therefore live in `@layer components`, where a utility on the
 * same element wins as it does everywhere else.
 */
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** The text of `@layer components { ... }` (brace counting) and everything outside it. */
function split(source: string): { inside: string; outside: string } {
  const start = source.indexOf("@layer components {");
  if (start === -1) return { inside: "", outside: source };
  let depth = 0;
  let end = start;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) {
      end = index;
      break;
    }
  }
  return {
    inside: source.slice(start, end + 1),
    outside: source.slice(0, start) + source.slice(end + 1),
  };
}

describe("app/globals.css component classes", () => {
  const { inside, outside } = split(css.replace(/\/\*[\s\S]*?\*\//g, ""));

  it("defines every .fk-* class inside @layer components, none unlayered", () => {
    expect(inside).toContain(".fk-header-button");
    // Written without a `-[` so the design guard's "arbitrary Tailwind value" pattern does not read it as a class.
    expect(outside.match(/\.fk(?:-\w+)+/g) ?? []).toEqual([]);
  });

  it("keeps the account placeholder as large as the control that replaces it (no layout shift)", () => {
    expect(inside).toMatch(/\.fk-header-slot \{\s*@apply [^;]*\bmin-h-11 min-w-11\b/);
  });

  it("has no @apply outside a layer (an unlayered utility would beat the responsive ones)", () => {
    expect(outside).not.toContain("@apply");
  });
});

describe("app/globals.css scrollbars (plan 2026-11-13-storefront-ui-round-4 B)", () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // The thumb and track must be a pair the theme's contrast test holds to 3:1 in every mode (`--color-border-input` on
  // `--color-background`, packages/theme/src/contrast.spec.ts); another pair would need its own entry there first.
  it("colours them from the --color-border-input / --color-background token pair, and only there", () => {
    expect(source.match(/scrollbar-color:[^;]*;/g)).toEqual([
      "scrollbar-color: var(--color-border-input) var(--color-background);",
    ]);
  });

  it("makes every scrollbar thin (scrollbar-width is not inherited)", () => {
    expect(source).toMatch(/\* \{\s*scrollbar-width: thin;\s*\}/);
  });
});
