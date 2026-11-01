// Shared helpers of the local demo scripts (`pnpm demo:up`, `pnpm demo:down`, `pnpm demo:pay`; README "Try it locally").
// Development only: nothing here is used by the API, the storefront, the admin or CI.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const envFile = resolve(repoRoot, ".env");
export const composeArgs = ["compose", "--env-file", ".env", "-f", "infra/docker-compose.yml"];

/** Database names the demo scripts accept (the seed's rule, `apps/api/src/seed/seed-command.ts`). */
const DEMO_DATABASE_SUFFIXES = ["_dev", "_demo", "_local", "_test"];

/** `KEY=VALUE` lines of a dotenv file (no quotes, no expansion: the format `.env.example` uses). */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match !== null) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

export function readEnvFile() {
  if (!existsSync(envFile)) {
    throw new Error("No .env in the repository root. Run `pnpm demo:up` first.");
  }
  return parseEnv(readFileSync(envFile, "utf8"));
}

/**
 * The environment for a child command: this process's environment WITHOUT the keys that `.env` sets, so the file wins.
 * (`node --env-file` never overrides a variable that is already set; a `DATABASE_URL` left in the shell from `pnpm test`
 * would otherwise make the demo seed the test database.)
 */
export function childEnv(fileValues, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(fileValues)) {
    delete env[key];
  }
  return { ...env, ...extra };
}

/** Runs a command in the repository root with inherited output; throws with the command line on a non-zero exit. */
export function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", ...options });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` failed with exit code ${result.status}.`);
  }
}

/** `pg` from `apps/api` (no dependency of the root package), after `pnpm install`. */
export function loadPg() {
  return createRequire(resolve(repoRoot, "apps/api/package.json"))("pg");
}

/** Refuses anything that looks like a real shop: production, or a database name without a demo suffix. */
export function assertDemoDatabase(values) {
  if ((values.NODE_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error(
      "Refusing: NODE_ENV is production. The demo scripts are for a developer machine.",
    );
  }
  const name = decodeURIComponent(new URL(values.DATABASE_URL ?? "").pathname.replace(/^\//, ""));
  if (!DEMO_DATABASE_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) {
    throw new Error(
      `Refusing: the database "${name}" does not end in ${DEMO_DATABASE_SUFFIXES.join(", ")}.`,
    );
  }
  return name;
}
