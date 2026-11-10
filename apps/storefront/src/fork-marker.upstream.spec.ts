// UPSTREAM-ONLY and FORK-DELETABLE: a client fork creates the marker `.fluxkit-fork` at the repository root and deletes this
// file in the same step (`docs/customization.md`, "Before you start"). The marker turns off the `check:docs` rule for the
// storefront config files a fork fills itself (`scripts/check-docs.mjs`, `docs/contracts/README.md`); in the template it would
// let a contract change through without its docs, so the template must never contain it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const marker = ".fluxkit-fork";

describe("the fork marker in the template", () => {
  it("is not in the repository", () => {
    expect(existsSync(join(repoRoot, marker))).toBe(false);
  });

  it("is the file check:docs looks for", () => {
    const script = readFileSync(join(repoRoot, "scripts", "check-docs.mjs"), "utf8");
    expect(script).toContain(`const forkMarker = "${marker}";`);
  });
});
