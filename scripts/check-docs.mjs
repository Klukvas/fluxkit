// Docs check (AGENTS.md section 18): code changes that need documentation must come with it.
// Usage: node scripts/check-docs.mjs --base origin/main
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const baseIndex = process.argv.indexOf("--base");
const base = baseIndex > 0 ? process.argv[baseIndex + 1] : undefined;
if (base === undefined) {
  console.error("check:docs needs --base <ref>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const changed = git("diff", "--name-status", `${base}...HEAD`)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, ...rest] = line.split("\t");
    return { status: status[0], path: rest[rest.length - 1] };
  });

const touched = (predicate) => changed.some((entry) => predicate(entry.path));
const problems = [];

const controllerChanged = changed.some(({ path }) => {
  if (/^apps\/api\/src\/.*\.controller\.ts$/.test(path)) return true;
  if (/^packages\/features\/[^/]+\/src\/.*\.ts$/.test(path) && existsSync(path)) {
    return readFileSync(path, "utf8").includes("@Controller(");
  }
  return false;
});
if (controllerChanged && !touched((path) => path.startsWith("docs/api/"))) {
  problems.push(
    "A controller changed but nothing under docs/api/ did (document the endpoint, and regenerate openapi.json for core routes).",
  );
}

if (
  touched(
    (path) =>
      /^apps\/api\/drizzle\/.*\.sql$/.test(path) || path === "apps/api/src/database/schema.ts",
  ) &&
  !touched((path) => path === "CHANGELOG.md")
) {
  problems.push("The database schema or a migration changed but CHANGELOG.md did not.");
}

const addedPackage = changed.some(
  ({ status, path }) => status === "A" && /^(apps|packages)\/(.+\/)?package\.json$/.test(path),
);
if (addedPackage && !touched((path) => path.startsWith("docs/files/"))) {
  problems.push("A new package was added but nothing under docs/files/ changed.");
}

const tokensPath = "packages/theme/src/tokens.css";
if (touched((path) => path === tokensPath)) {
  const names = (css) =>
    [...css.matchAll(/(--fk-[a-z0-9-]+)\s*:/g)]
      .map((match) => match[1])
      .sort()
      .join(",");
  const before = (() => {
    try {
      return git("show", `${base}:${tokensPath}`);
    } catch {
      return "";
    }
  })();
  if (
    names(before) !== names(readFileSync(tokensPath, "utf8")) &&
    !touched((path) => path === "docs/contracts/theme-tokens.md")
  ) {
    problems.push("Design token names changed but docs/contracts/theme-tokens.md did not.");
  }
}

console.log(`changed files: ${changed.length}`);
if (problems.length > 0) {
  console.error("Docs check failed:\n" + problems.map((line) => `  - ${line}`).join("\n"));
  process.exit(1);
}
