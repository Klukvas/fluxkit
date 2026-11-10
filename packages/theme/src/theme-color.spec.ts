import { describe, expect, it } from "vitest";
import { themeColors as exported } from "./index.js";
import { themeColors } from "./theme-color.js";
import { literalCopyFile, storefrontTokens } from "./theme-run.testing.js";

// `themeColors` is a literal copy (HTML cannot read a CSS variable): it must equal the storefront's EFFECTIVE page background,
// `tokens.css` plus the fork-owned `brand-overrides.css`, so a fork that rebrands in its overrides file is told which literals
// to write here.
const background = (tokens: Map<string, string>) => tokens.get("--fk-color-background");

describe("themeColors (the storefront's theme-color, plan B1)", () => {
  it("is exported from the package entry point", () => {
    expect(exported).toBe(themeColors);
  });

  it("equals the effective --fk-color-background of the light, the dark and the system-dark page", () => {
    const expected = {
      light: background(storefrontTokens.light),
      dark: background(storefrontTokens.dark),
    };
    expect(background(storefrontTokens["system on a dark OS"])).toBe(expected.dark);
    expect(background(storefrontTokens["system on a light OS"])).toBe(expected.light);
    expect(
      { ...themeColors },
      `update the literals in ${literalCopyFile("theme-color.ts")}: export const themeColors = ${JSON.stringify(expected)} as const;`,
    ).toEqual(expected);
  });
});
