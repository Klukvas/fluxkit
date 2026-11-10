import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTokenBlocks } from "./token-blocks.js";

/**
 * UPSTREAM-ONLY, FORK-DELETABLE (`docs/customization.md`): the template ships `brand-overrides.css` with no rule, so the
 * template's look is `tokens.css` alone and upstream never puts content into a file a fork owns. A fork that fills the file
 * deletes this spec; every other theme spec reads the effective values and also runs with a filled file
 * (`vitest.brand-fork.config.ts`).
 */
describe("brand-overrides.css upstream (TEMPLATE-DEFAULT CHECK)", () => {
  it("holds no rule, only its comment", () => {
    const css = readFileSync(
      fileURLToPath(new URL("./brand-overrides.css", import.meta.url)),
      "utf8",
    );
    expect(css).toMatch(/FORK-OWNED/);
    expect(parseTokenBlocks(css)).toEqual([]);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "").trim()).toBe("");
  });
});
