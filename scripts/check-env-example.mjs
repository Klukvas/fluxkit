// Every environment variable the code reads must be documented in .env.example (AGENTS.md section 3: "every new env var
// must be added to .env.example and the docs"). Usage: node scripts/check-env-example.mjs   (pnpm check:env)
//
// What counts as "read" (source files of apps/, packages/ and seeds/, specs excluded; build output and modules skipped):
//   - process.env.NAME, process.env["NAME"], process.env?.NAME
//   - env.NAME, env["NAME"], env?.NAME, and the same on `environment` and `source` (the parameter names the parsers use)
//   - loadEnv(...).NAME (Vite's loader in apps/admin/vite.config.ts)
//   - the keys of the environment schemas in packages/config/src (`  NAME: z...`), which is how loadEnv and
//     loadStorefrontEnv read their variables
// Documented means a line `NAME=...` or `# NAME=...` in .env.example. Variables that are deliberately not documented there
// are listed in NOT_IN_ENV_EXAMPLE with the reason. Exit 0 when complete, 1 with the missing names otherwise.
// Cheap and deterministic: no build, no network, only regular expressions over the files.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Read by code, documented elsewhere on purpose. */
export const NOT_IN_ENV_EXAMPLE = new Map([
  [
    "NODE_ENV",
    "set by the platform or the image (production), not by the shop's .env; docs/contracts/config.md and docs/deployment.md",
  ],
  [
    "OPENAPI_FEATURES",
    "tooling of `pnpm openapi:export` only (which features to include in the exported document); apps/api/README.md",
  ],
  ["CI", "set by the CI runner; switches tooling behaviour only"],
  [
    "DRIZZLE_KIT_OUT",
    "set only by scripts/check-schema-drift.sh for a temporary drizzle-kit output directory",
  ],
]);

const SCAN_ROOTS = ["apps", "packages", "seeds"];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "test-results",
  "playwright-report",
]);
const SOURCE_FILE = /\.(ts|tsx|mts|js|mjs|cjs)$/;
const SPEC_FILE = /\.(spec|test)\.(ts|tsx|mts|js|mjs)$/;
const NAME = "[A-Z][A-Z0-9_]*[A-Z0-9]";
const READ_PATTERNS = [
  new RegExp(`process\\.env(?:\\?\\.|\\.)(${NAME})\\b`, "g"),
  new RegExp(`process\\.env\\[\\s*["'](${NAME})["']\\s*\\]`, "g"),
  new RegExp(`\\b(?:env|environment|source)(?:\\?\\.|\\.)(${NAME})\\b`, "g"),
  new RegExp(`\\b(?:env|environment|source)\\[\\s*["'](${NAME})["']\\s*\\]`, "g"),
  new RegExp(`\\bloadEnv\\([^)]*\\)\\.(${NAME})\\b`, "g"),
];
/** Keys of a zod object in the config package: `    DATABASE_URL: z.string()...`. */
const SCHEMA_KEY = new RegExp(`^\\s+(${NAME}):\\s`, "gm");
const SCHEMA_DIRECTORY = join("packages", "config", "src");

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) yield* sourceFiles(join(directory, entry.name));
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !SPEC_FILE.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield join(directory, entry.name);
    }
  }
}

/** @returns {Map<string, string>} variable name -> first file (relative) that reads it */
export function collectReadVariables(repositoryRoot = root) {
  const found = new Map();
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of sourceFiles(join(repositoryRoot, scanRoot))) {
      const path = relative(repositoryRoot, file);
      const text = readFileSync(file, "utf8");
      const patterns = path.startsWith(SCHEMA_DIRECTORY)
        ? [...READ_PATTERNS, SCHEMA_KEY]
        : READ_PATTERNS;
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          if (!found.has(match[1])) found.set(match[1], path);
        }
      }
    }
  }
  return found;
}

/** @returns {Set<string>} names with a `NAME=` or `# NAME=` line */
export function documentedVariables(envExampleText) {
  return new Set(
    [...envExampleText.matchAll(new RegExp(`^#?\\s*(${NAME})=`, "gm"))].map((match) => match[1]),
  );
}

function main() {
  const read = collectReadVariables();
  const documented = documentedVariables(readFileSync(join(root, ".env.example"), "utf8"));
  const missing = [...read].filter(
    ([name]) => !documented.has(name) && !NOT_IN_ENV_EXAMPLE.has(name),
  );
  if (read.size === 0) {
    console.error("check:env found no environment variable reads at all; the scan is broken.");
    process.exit(1);
  }
  if (missing.length > 0) {
    console.error(
      "These environment variables are read by the code but not documented in .env.example",
    );
    console.error(
      "(add a `NAME=` or `# NAME=` line with a comment, or list the variable in NOT_IN_ENV_EXAMPLE with a reason):",
    );
    for (const [name, file] of missing.sort(([a], [b]) => a.localeCompare(b)))
      console.error(`  ${name}  (read in ${file})`);
    process.exit(1);
  }
  console.log(
    `check:env: ${read.size} variables read by the code, all documented in .env.example or listed as exceptions.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
