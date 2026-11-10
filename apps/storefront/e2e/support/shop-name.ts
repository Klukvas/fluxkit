import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The shop name per locale as the storefront shows it (`site.name`; plan 2026-11-08-design-changeability.md B3): a fork renames
 * the shop in `src/messages-overrides/<locale>.json`, so no spec may write the name as a literal (`src/brand-literals.spec.ts`).
 * Read as data, the same merge order as `src/messages/index.ts` for this key (the override wins); not imported from `src`, so
 * the e2e suite does not load the app's TypeScript.
 */
function read(path: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../src", path), "utf8"),
  ) as Record<string, unknown>;
}

function shopName(locale: "uk" | "en"): string {
  const override = read(`messages-overrides/${locale}.json`)["site.name"];
  const name = override ?? read(`messages/${locale}/shell.json`)["site.name"];
  if (typeof name !== "string" || name === "") {
    throw new Error(`site.name is missing for ${locale}`);
  }
  return name;
}

export const SHOP_NAME = { uk: shopName("uk"), en: shopName("en") } as const;
