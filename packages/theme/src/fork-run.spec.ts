import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emailTheme } from "./email-theme.js";
import * as emailFixture from "./fork-fixture/email-theme.js";
import * as themeColorFixture from "./fork-fixture/theme-color.js";
import { emailTheme as exportedEmailTheme, themeColors as exportedThemeColors } from "./index.js";
import { themeColors } from "./theme-color.js";
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

  // Only about the fixtures' content: the upstream run reads the REAL files, which a fork fills, so nothing here may depend on
  // what they hold (a fork's own run must stay green).
  it.runIf(themeRun === "brand-fork")(
    "sees the fixtures' values in the fork run, each overrides file only in its own app",
    () => {
      expect(background(storefrontTokens.light)).toBe("#fbf8f3");
      expect(background(storefrontTokens.dark)).toBe("#0f1713");
      expect(adminTokens.get("--fk-color-primary")).toBe("#1f2937");
      // The admin never receives the storefront overrides (its background stays the template's), and the storefront never
      // the admin's (the fixture's client font is the admin's only).
      expect(background(adminTokens)).toBe(template.get("--fk-color-background"));
      expect(storefrontTokens.light.get("--fk-font-sans")).toBe(template.get("--fk-font-sans"));
    },
  );
});

describe("the literal copies a theme run reads", () => {
  it("are the real files upstream and the fork's updated copies in the fork run, also through the package entry", () => {
    const fork = themeRun === "brand-fork";
    expect(Object.is(themeColors, themeColorFixture.themeColors)).toBe(fork);
    expect(Object.is(emailTheme, emailFixture.emailTheme)).toBe(fork);
    expect(exportedThemeColors).toBe(themeColors);
    expect(exportedEmailTheme).toBe(emailTheme);
  });
});
