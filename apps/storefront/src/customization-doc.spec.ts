import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `docs/customization.md` is the fork author's only guide (plan 2026-11-08-design-changeability.md B5): every repository path it
 * names in backticks must exist, so a move or rename upstream fails here instead of misleading a fork. Paths a fork creates
 * itself, and the upstream-only files the guide tells a fork to delete, are the only exceptions.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const doc = readFileSync(join(repoRoot, "docs", "customization.md"), "utf8");

/** Folders the guide tells a fork to create: missing in the template, present in a fork that followed step 10. */
const FORK_CREATES = new Set(["apps/admin/public/"]);

/**
 * Upstream-only checks the guide tells a fork to DELETE once it changes the matching config: present in the template, missing in
 * a fork that followed the guide (this spec must stay green there).
 */
const FORK_DELETES = new Set([
  "apps/storefront/src/components/header-footer-defaults.upstream.spec.tsx",
  "apps/storefront/src/components/header-footer-defaults/",
  "apps/storefront/src/config/slots.upstream.spec.ts",
  "apps/storefront/src/components/cards/custom.upstream.spec.ts",
  "apps/storefront/src/lib/home-template-default.upstream.spec.ts",
  "packages/theme/src/brand-overrides.upstream.spec.ts",
  // Deleted with the creation of the fork marker `.fluxkit-fork` (the guide's step 0).
  "apps/storefront/src/fork-marker.upstream.spec.ts",
]);

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
      "packages/theme/src/brand-overrides.css",
      "packages/theme/src/email-theme.ts",
      "packages/theme/src/theme-color.ts",
      "packages/theme/src/admin-overrides.css",
      "docs/contracts/branding.md",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("names only paths that exist (or that a fork creates or deletes, listed here)", () => {
    const missing = paths.filter(
      (path) =>
        !FORK_CREATES.has(path) && !FORK_DELETES.has(path) && !existsSync(join(repoRoot, path)),
    );
    expect(missing).toEqual([]);
  });

  it("lists as fork-deleted only paths the guide names", () => {
    for (const path of FORK_DELETES) expect(paths, path).toContain(path);
  });

  it("lists as fork-created only paths the guide names (they may exist in a fork that followed it)", () => {
    for (const path of FORK_CREATES) expect(paths, path).toContain(path);
  });

  it("names every upstream-only spec in the list of section 0, step 3, and nothing else there (the list cannot go stale)", () => {
    const step = doc.slice(doc.indexOf("## 0."), doc.indexOf("## 1."));
    const listed = repositoryPaths(step).filter(isUpstreamSpec).sort();
    // On disk: every one must be listed (in a fork that followed the guide, some are gone: still listed, never unlisted).
    for (const path of upstreamSpecsOnDisk()) expect(listed, path).toContain(path);
    // The list and FORK_DELETES name the same upstream-only specs.
    expect(listed).toEqual([...FORK_DELETES].filter(isUpstreamSpec).sort());
  });
});

function isUpstreamSpec(path: string): boolean {
  return /\.upstream\.spec\.[cm]?[jt]sx?$/.test(path);
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".next", ".turbo"]);

/** Every `*.upstream.spec.*` file under `apps/` and `packages/` (no dependencies or build output). */
function upstreamSpecsOnDisk(): string[] {
  return ["apps", "packages"].flatMap((top) => filesUnder(top).filter(isUpstreamSpec));
}

// Dependencies and build output are pruned while walking, not filtered afterwards: a recursive listing of the whole tree went
// through every node_modules folder and took over 5 s on a busy CI runner (the test timed out).
function filesUnder(relativeDirectory: string): string[] {
  return readdirSync(join(repoRoot, relativeDirectory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : filesUnder(path);
      return entry.isFile() ? [path] : [];
    },
  );
}
