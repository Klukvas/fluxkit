import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adminOverridesFile,
  adminTokens,
  brandOverridesFile,
  storefrontTokens,
  themeRun,
  tokenCssBlocks,
} from "./theme-run.testing.js";
import { themeSelectors, tokenBlock } from "./token-blocks.js";

/**
 * Canary of the two theme runs: `vitest.config.ts` must read the real fork-owned overrides files and
 * `vitest.brand-fork.config.ts` the FILLED fixtures, or the fork run would check the template's defaults again and prove nothing.
 */
const own = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const background = (tokens: Map<string, string>) => tokens.get("--fk-color-background");
const template = tokenBlock(tokenCssBlocks, themeSelectors.light).tokens;

describe("the overrides files a theme run reads", () => {
  it("knows which run it is", () => {
    expect(["upstream", "brand-fork"]).toContain(themeRun);
  });

  it("reads the real files upstream and the fixtures in the fork run", () => {
    const fork = themeRun === "brand-fork";
    expect(brandOverridesFile).toBe(
      own(fork ? "fork-fixture/brand-overrides.css" : "brand-overrides.css"),
    );
    expect(adminOverridesFile).toBe(
      own(fork ? "fork-fixture/admin-overrides.css" : "admin-overrides.css"),
    );
  });

  it("sees the fork's palette only in the fork run (and the admin overrides only in the admin)", () => {
    const fork = themeRun === "brand-fork";
    expect(background(storefrontTokens.light) !== template.get("--fk-color-background")).toBe(fork);
    expect(
      storefrontTokens.dark.get("--fk-color-primary") !==
        storefrontTokens.light.get("--fk-color-primary"),
    ).toBe(true);
    expect(adminTokens.get("--fk-color-primary") !== template.get("--fk-color-primary")).toBe(fork);
    // The admin never receives the storefront overrides, and the storefront never the admin's.
    expect(background(adminTokens)).toBe(template.get("--fk-color-background"));
    expect(storefrontTokens.light.get("--fk-font-sans")).toBe(template.get("--fk-font-sans"));
  });
});
