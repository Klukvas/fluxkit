import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { messagesByLocale } from "./messages";

/**
 * Plan 2026-11-08-design-changeability.md B3: a fork renames the shop in `src/messages-overrides/<locale>.json` and must not have
 * to edit tests for it. So no unit spec and no e2e file writes the shop name: they read it from the merged messages
 * (`messagesByLocale`, or `e2e/support/shop-name.ts`). Two literals are not the shop name and stay: the CSRF header's name
 * (`X-Fluxkit-CSRF`, a protocol constant) and the e2e sender address of `EMAIL_FROM` (a test environment value).
 */
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const allowed = [/X-Fluxkit-CSRF/g, /"Fluxkit E2E <shop@example\.com>"/g];

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full, pattern);
    return pattern.test(entry) ? [full] : [];
  });
}

const shopNames = [
  ...new Set(Object.values(messagesByLocale).map((messages) => messages["site.name"] as string)),
];

/** Lines of a file that name the shop, after the allowed literals are removed. */
function brandLiteralLines(text: string, names: readonly string[]): string[] {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_-])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_-])`,
    "u",
  );
  return text
    .split("\n")
    .map((line) => allowed.reduce((rest, literal) => rest.replace(literal, ""), line))
    .filter((line) => pattern.test(line));
}

describe("no brand literals in specs and e2e (plan B3)", () => {
  const scanned = [
    ...files(join(appRoot, "src"), /\.spec\.tsx?$/),
    ...files(join(appRoot, "e2e"), /\.tsx?$/),
  ].filter((file) => !file.endsWith("brand-literals.spec.ts"));

  it("scans the unit specs and the whole e2e suite", () => {
    const paths = scanned.map((file) => relative(appRoot, file));
    expect(paths).toContain(join("src", "lib", "page-metadata.spec.ts"));
    expect(paths).toContain(join("e2e", "tests", "design-a.e2e.ts"));
    expect(paths).toContain(join("e2e", "support", "env.ts"));
    expect(shopNames.length).toBeGreaterThan(0);
  });

  it("finds a shop name written as a literal and ignores the allowed ones and longer words", () => {
    expect(brandLiteralLines('name: "Fluxkit" });', ["Fluxkit"])).toHaveLength(1);
    expect(brandLiteralLines("`Каталог — Fluxkit`", ["Fluxkit"])).toHaveLength(1);
    expect(brandLiteralLines('headers: { "X-Fluxkit-CSRF": "1" }', ["Fluxkit"])).toEqual([]);
    expect(brandLiteralLines('EMAIL_FROM: "Fluxkit E2E <shop@example.com>",', ["Fluxkit"])).toEqual(
      [],
    );
    expect(brandLiteralLines('"@fluxkit/ui" FluxkitShop', ["Fluxkit"])).toEqual([]);
  });

  it("no spec or e2e file names the shop: read site.name from the merged messages instead", () => {
    const offenders = scanned.flatMap((file) =>
      brandLiteralLines(readFileSync(file, "utf8"), shopNames).map(
        (line) => `${relative(appRoot, file)}: ${line.trim()}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
