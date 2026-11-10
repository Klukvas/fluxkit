import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The real wiring of the fork marker in `scripts/check-docs.mjs` (`docs/contracts/README.md`): the script runs against a
 * throw-away git repository, so the marker is read from the BASE ref as in CI. Runs in a fork too (it never reads the fork's own
 * files), so it is not upstream-only.
 */
const script = fileURLToPath(new URL("../../../scripts/check-docs.mjs", import.meta.url));
const footer = "apps/storefront/src/config/footer.ts";
const slotsModule = "apps/storefront/src/lib/slots.ts";
const markerSpec = "apps/storefront/src/fork-marker.upstream.spec.ts";

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=check",
      "-c",
      "user.email=check@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo, stdio: "ignore" },
  );
}

function write(repo: string, path: string, text = "x\n"): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** A repository whose `main` has the given files, checked out on a branch `pr`. */
function repository(baseFiles: string[]): string {
  const repo = mkdtempSync(join(tmpdir(), "check-docs-fork-"));
  repos.push(repo);
  mkdirSync(join(repo, "scripts"));
  copyFileSync(script, join(repo, "scripts", "check-docs.mjs"));
  for (const path of [footer, slotsModule, ...baseFiles]) write(repo, path);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "pr");
  return repo;
}

/** Commits the change on `pr` and runs the docs check against `main`. */
function check(repo: string, change: { write?: string[]; remove?: string[] }) {
  for (const path of change.write ?? []) write(repo, path, "changed\n");
  for (const path of change.remove ?? []) rmSync(join(repo, path));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "change");
  const run = spawnSync(process.execPath, ["scripts/check-docs.mjs", "--base", "main"], {
    cwd: repo,
    encoding: "utf8",
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe("check:docs and the fork marker (real script, throw-away repository)", () => {
  it("keeps the contract rule without the marker", () => {
    const result = check(repository([markerSpec]), { write: [footer] });
    expect(result.status).toBe(1);
    expect(result.output).toContain("changed but nothing under docs/contracts/ did");
  });

  it("keeps it in the PR that adds the marker: only the base ref turns fork mode on", () => {
    const result = check(repository([markerSpec]), {
      write: [".fluxkit-fork", footer],
      remove: [markerSpec],
    });
    expect(result.status).toBe(1);
  });

  it("passes a marker-only PR (step 0 on its own)", () => {
    const result = check(repository([markerSpec]), {
      write: [".fluxkit-fork"],
      remove: [markerSpec],
    });
    expect(result.status).toBe(0);
  });

  it("leaves the fork's own config files out once the base has the marker", () => {
    const result = check(repository([".fluxkit-fork"]), { write: [footer] });
    expect(result.output).toContain(".fluxkit-fork found in main");
    expect(result.status).toBe(0);
  });

  it("keeps the rule for the files that define the contract, even in a fork", () => {
    expect(check(repository([".fluxkit-fork"]), { write: [slotsModule] }).status).toBe(1);
  });

  it("fails closed when the tree holds both the marker and the spec that refuses it", () => {
    const result = check(repository([".fluxkit-fork"]), { write: [markerSpec] });
    expect(result.status).toBe(1);
    expect(result.output).toContain(`delete ${markerSpec}`);
  });
});
