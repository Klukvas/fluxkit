// Docs check (AGENTS.md section 18): code changes that need documentation must come with it.
// Usage: node scripts/check-docs.mjs --base origin/main (or --self-test: only the rule's own cases)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Storefront layout and branding config files that are public contracts (plan docs/plans/2026-11-08-design-changeability.md,
// principle 7). Most do not exist yet: the rule applies from the PR that adds one, and a change that touches none passes.
const contractConfig = /^apps\/storefront\/src\/config\/(brand|catalog|header|footer|slots)\.tsx?$/;

/** The problem when a contract config file changed (added, edited, renamed or deleted) without a change under docs/contracts/. */
function contractConfigProblem(paths) {
  if (!paths.some((path) => contractConfig.test(path))) return null;
  if (paths.some((path) => path.startsWith("docs/contracts/"))) return null;
  return "A storefront contract config file (apps/storefront/src/config/{brand,catalog,header,footer,slots}.ts or .tsx) changed but nothing under docs/contracts/ did.";
}

/** Parses `git diff --name-status`; a rename or copy lists the old and the new path: `path` is the new one, `paths` both. */
function parseNameStatus(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status[0], path: rest[rest.length - 1], paths: rest };
    });
}

const changedPaths = (entries) => entries.flatMap((entry) => entry.paths);

// The rule's own cases, run on every call before the diff is read (and alone with --self-test): a broken rule fails loudly.
// `nameStatus` cases go through the parser, so a rename away from (or onto) a contract file is covered too.
const selfTestCases = [
  {
    nameStatus: "R100\tapps/storefront/src/config/brand.ts\tapps/storefront/src/config/branding.ts",
    fails: true,
  },
  {
    nameStatus:
      "R100\tapps/storefront/src/config/brand.ts\tapps/storefront/src/config/branding.ts\nM\tdocs/contracts/branding.md",
    fails: false,
  },
  { nameStatus: "M\tapps/storefront/src/config/home.ts", fails: false },
  { paths: [], fails: false },
  {
    paths: ["apps/storefront/src/config/home.ts", "apps/storefront/src/config/theme.ts"],
    fails: false,
  },
  {
    paths: ["apps/storefront/src/config/catalog.spec.ts", "apps/storefront/src/config/brand.json"],
    fails: false,
  },
  { paths: ["apps/storefront/src/config/brand.ts"], fails: true },
  { paths: ["apps/storefront/src/config/slots.tsx", "docs/files/storefront.md"], fails: true },
  {
    paths: ["apps/storefront/src/config/header.ts", "apps/storefront/src/config/footer.tsx"],
    fails: true,
  },
  {
    paths: ["apps/storefront/src/config/catalog.ts", "docs/contracts/layout-config.md"],
    fails: false,
  },
  { paths: ["apps/storefront/src/config/slots.tsx", "docs/contracts/slots.md"], fails: false },
  { paths: ["apps/admin/src/config/brand.ts", "packages/ui/src/config/footer.ts"], fails: false },
];
const casePaths = ({ paths, nameStatus }) => paths ?? changedPaths(parseNameStatus(nameStatus));
const selfTestFailures = selfTestCases.filter(
  (testCase) => (contractConfigProblem(casePaths(testCase)) !== null) !== testCase.fails,
);
if (selfTestFailures.length > 0) {
  console.error(
    "check:docs self-test failed for: " +
      selfTestFailures.map((testCase) => JSON.stringify(casePaths(testCase))).join(", "),
  );
  process.exit(1);
}
if (process.argv.includes("--self-test")) {
  console.log(`check:docs self-test: ${selfTestCases.length} cases passed`);
  process.exit(0);
}

const baseIndex = process.argv.indexOf("--base");
const base = baseIndex > 0 ? process.argv[baseIndex + 1] : undefined;
if (base === undefined) {
  console.error("check:docs needs --base <ref>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const changed = parseNameStatus(git("diff", "--name-status", `${base}...HEAD`));

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

const contractProblem = contractConfigProblem(changedPaths(changed));
if (contractProblem !== null) problems.push(contractProblem);

console.log(`changed files: ${changed.length}`);
if (problems.length > 0) {
  console.error("Docs check failed:\n" + problems.map((line) => `  - ${line}`).join("\n"));
  process.exit(1);
}
