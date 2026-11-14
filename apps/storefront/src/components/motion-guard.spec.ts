import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Motion in both CSS entry points follows the same token contract as component utilities. */
export function motionViolations(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const violations = [
    ...source.matchAll(/(?:^|[;{])\s*(?:animation|transition)(?:-[\w-]+)?\s*:\s*([^;{}]+)/g),
  ]
    .filter((match) => /(?:\d*\.)?\d+(?:ms|s)\b/.test(match[1] ?? ""))
    .map((match) => match[0]);
  if (/cubic-bezier\s*\(/i.test(source)) violations.push("raw easing");
  if (/#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/i.test(source)) violations.push("raw colour");
  return violations;
}

describe("motion CSS token guard", () => {
  for (const path of ["../app/globals.css", "../../../../packages/ui/src/motion.css"]) {
    it(`${path} uses tokens for motion and colours`, () => {
      expect(motionViolations(readFileSync(new URL(path, import.meta.url), "utf8"))).toEqual([]);
    });
  }
  it("rejects raw shorthand/longhand times, easing and colours", () => {
    for (const rule of [
      ".a { transition: transform 200ms; }",
      ".a { animation-delay: .2s; }",
      ".a { transition-duration: 0.25s; }",
      ".a { transition-timing-function: cubic-bezier(0, 0, 1, 1); }",
      ".a { color: " + "#" + "fff; }",
      ".a { color: " + "rgb" + "(0 0 0); }",
    ])
      expect(motionViolations(rule).length).toBeGreaterThan(0);
    expect(
      motionViolations(
        ".a { animation: roll calc(var(--fk-motion-duration-base) * 2) var(--fk-motion-ease-spring); }",
      ),
    ).toEqual([]);
  });
});
