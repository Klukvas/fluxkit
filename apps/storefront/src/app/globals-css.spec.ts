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

  it("has no @apply outside a layer (an unlayered utility would beat the responsive ones)", () => {
    expect(outside).not.toContain("@apply");
  });
});
