import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themeColors as exported } from "./index.js";
import { themeColors } from "./theme-color.js";
import { darkSchemeMedia, parseTokenBlocks, themeSelectors, tokenBlock } from "./token-blocks.js";

const blocks = parseTokenBlocks(
  readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8"),
);
const background = (selector: string, media: string | null = null) =>
  tokenBlock(blocks, selector, media).tokens.get("--fk-color-background");

describe("themeColors (the storefront's theme-color, plan B1)", () => {
  it("is exported from the package entry point", () => {
    expect(exported).toBe(themeColors);
  });

  it("equals --fk-color-background of the light, the dark and the system-dark block of tokens.css", () => {
    expect(themeColors.light).toBe(background(themeSelectors.light));
    expect(themeColors.dark).toBe(background(themeSelectors.dark));
    expect(themeColors.dark).toBe(background(themeSelectors.system, darkSchemeMedia));
  });
});
