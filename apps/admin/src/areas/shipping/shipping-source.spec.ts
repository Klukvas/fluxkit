import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the Shipping area's wiring that static markup cannot see. They read the sources as text, so each rule is pinned
 * to the shape of the code that keeps it; a refactor that keeps the rule updates the pattern here.
 */
const folder = import.meta.dirname;
const sources = readdirSync(folder)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name))
  .map((name) => ({
    name,
    code: readFileSync(join(folder, name), "utf8").replace(
      /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
      "$1",
    ),
  }));

describe("shipping area source guards", () => {
  it("finds its sources", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it("never asks for or stores a credential: no password field, no input named like a key, token or secret", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/type="password"|type=\{"password"\}/);
      expect(code, name).not.toMatch(
        /name="[^"]*(api_?key|token|secret|password|credential)[^"]*"/i,
      );
    }
  });

  it("sends every settings write exactly once: through a form submit, a run-write call or the delete confirmation", () => {
    const writes =
      /adminClient\.(createShippingMethod|updateShippingMethod|deleteShippingMethod|putShippingProviderSettings|checkShippingProvider)\(/g;
    let seen = 0;
    for (const { name, code } of sources) {
      for (const match of code.matchAll(writes)) {
        seen += 1;
        const line = code.slice(
          code.lastIndexOf("\n", match.index) + 1,
          code.indexOf("\n", match.index),
        );
        expect(line, `${name}: ${match[0]}`).toMatch(
          /form\.submit\(\(\) =>|runWrite\(\(\) =>|remove=\{\(\) =>/,
        );
      }
    }
    expect(seen).toBe(5);
  });

  it("never retries a write: no loop, timer or second call around the writes", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/setInterval|setTimeout|while \(|retry\(/);
    }
  });

  it("converts money through the decimal parser only: no number parsing of amounts", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/parseFloat|Number\(\s*(values|text|amount)|Math\.round/);
    }
  });
});
