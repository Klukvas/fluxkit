import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inject } from "vitest";
import {
  adminState,
  effectiveTokens,
  parseTokenBlocks,
  storefrontStates,
  type TokenBlock,
} from "./token-blocks.js";

/*
 * Test support of the theme specs (not a spec, not built: `tsconfig.build.json`). The specs check the EFFECTIVE token values
 * of the two apps, not `tokens.css` alone: the storefront reads `tokens.css` and then its fork-owned overrides; the admin
 * follows the shop (ADR 0047): `tokens.css`, the storefront's overrides, then its own fork-owned overrides. Which overrides files a run reads comes from the vitest
 * config (`provide`): the real files in `vitest.config.ts`, FILLED fixtures in `vitest.brand-fork.config.ts` (a fork's
 * rebrand), checked by `fork-run.spec.ts`.
 */

declare module "vitest" {
  export interface ProvidedContext {
    /** `upstream` (`vitest.config.ts`: the real files) or `brand-fork` (`vitest.brand-fork.config.ts`: filled fixtures). */
    themeRun: "upstream" | "brand-fork";
    /** Absolute path of the storefront overrides stylesheet this run reads. */
    brandOverridesFile: string;
    /** Absolute path of the admin overrides stylesheet this run reads. */
    adminOverridesFile: string;
  }
}

function provided(key: "brandOverridesFile" | "adminOverridesFile"): string {
  const value = inject(key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} is not provided: run the theme specs with a config of packages/theme`);
  }
  return value;
}

export const themeRun = inject("themeRun");

/**
 * The literal copy a spec really compares: the real file, or in the fork run the fixture the config puts in its place. A fork
 * that follows docs/customization.md (tokens.css untouched) keeps the fork run green; one that still edits tokens.css can see
 * the fork run name the fixture here.
 */
export function literalCopyFile(name: "email-theme.ts" | "theme-color.ts"): string {
  return themeRun === "brand-fork"
    ? `packages/theme/src/fork-fixture/${name} (the fork run's copy, vitest.brand-fork.config.ts; it pairs with the fixture overrides, not with your tokens.css edits)`
    : `packages/theme/src/${name}`;
}
export const brandOverridesFile = provided("brandOverridesFile");
export const adminOverridesFile = provided("adminOverridesFile");

export const tokensCss = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf8",
);
export const tokenCssBlocks = parseTokenBlocks(tokensCss);
export const brandOverridesCss = readFileSync(brandOverridesFile, "utf8");
export const brandOverrideBlocks = parseTokenBlocks(brandOverridesCss, brandOverridesFile);
/** A client font's `@font-face` rule in the admin overrides declares no token (ADR 0047). */
export const adminOverrideBlocks = parseTokenBlocks(
  readFileSync(adminOverridesFile, "utf8"),
  adminOverridesFile,
).filter((block: TokenBlock) => block.selector !== "@font-face");

const storefrontBlocks = [...tokenCssBlocks, ...brandOverrideBlocks];

/** The storefront's effective tokens in each page state it renders. */
export const storefrontTokens = Object.fromEntries(
  Object.entries(storefrontStates).map(([name, state]) => [
    name,
    effectiveTokens(storefrontBlocks, state),
  ]),
) as Record<keyof typeof storefrontStates, Map<string, string>>;

/**
 * The admin's effective tokens: `<html data-theme="light">` fixed, so of the storefront overrides only the light rule applies
 * (their dark and system rules never match the admin's page), then the admin's own overrides win.
 */
export const adminTokens = effectiveTokens(
  [...tokenCssBlocks, ...brandOverrideBlocks, ...adminOverrideBlocks],
  adminState,
);
