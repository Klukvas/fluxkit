import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `docs/customization.md` is the fork author's only guide (plan 2026-11-08-design-changeability.md B5): every repository path it
 * names in backticks must exist, so a move or rename upstream fails here instead of misleading a fork. Paths a fork creates
 * itself are the only exception.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const doc = readFileSync(join(repoRoot, "docs", "customization.md"), "utf8");

/** Folders the guide tells a fork to create: missing in the template, present in a fork that followed step 10. */
const FORK_CREATES = new Set(["apps/admin/public/"]);

function repositoryPaths(text: string): string[] {
  const paths = [...text.matchAll(/`((?:apps|packages|docs|scripts)\/[^`\s]+)`/g)].map(
    (match) => match[1] as string,
  );
  return [...new Set(paths)];
}

describe("docs/customization.md (plan B5)", () => {
  const paths = repositoryPaths(doc);

  it("names the files of the rebrand checklist", () => {
    for (const path of [
      "apps/storefront/src/config/brand.ts",
      "apps/storefront/src/config/fonts.ts",
      "apps/storefront/src/messages-overrides/uk.json",
      "packages/theme/src/tokens.css",
      "packages/theme/src/admin-overrides.css",
      "docs/contracts/branding.md",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("names only paths that exist (or that a fork creates, listed here)", () => {
    const missing = paths.filter(
      (path) => !FORK_CREATES.has(path) && !existsSync(join(repoRoot, path)),
    );
    expect(missing).toEqual([]);
  });

  it("lists as fork-created only paths the guide names (they may exist in a fork that followed it)", () => {
    for (const path of FORK_CREATES) expect(paths, path).toContain(path);
  });
});
