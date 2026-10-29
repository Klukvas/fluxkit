// Gives the e2e run a fresh database: wipes it, migrates it, seeds the demo catalog and creates one owner. Run by the API's
// `webServer` entry in `playwright.config.ts` BEFORE the API starts (Playwright starts web servers before `globalSetup`,
// so a global setup would run against a server that is already up). Uses plain `node` and the API's BUILT output
// (`pnpm build` first), the same commands as `pnpm db:migrate`, `pnpm seed` and `pnpm admin:create` without their
// `--env-file`; `pg` is the API's own dependency, resolved from `apps/api`, so the storefront package adds nothing.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  E2E_MAIL_FILE,
  E2E_SEARCH_ENABLED,
  E2E_MEDIA_DIR,
  apiEnvironment,
  databaseNameOf,
  type Env,
  requireE2eDatabaseUrl,
} from "./support/env.ts";
import { createSuiteKey } from "./support/meili.ts";

const apiRoot = resolve(import.meta.dirname, "../../api");
const databaseUrl = requireE2eDatabaseUrl();
const name = databaseNameOf(databaseUrl);

interface Client {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}
const { Client } = createRequire(resolve(apiRoot, "package.json"))("pg") as {
  Client: new (options: { connectionString: string }) => Client;
};

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  // Belt and braces: the name came from the URL, the server says which database this really is.
  const current = (await client.query("select current_database() as name")).rows[0]?.["name"];
  if (current !== name) {
    throw new Error(
      `Connected to "${String(current)}", expected "${String(name)}": refusing to wipe.`,
    );
  }
  await client.query('drop schema if exists "drizzle" cascade');
  await client.query('drop schema if exists "public" cascade');
  await client.query('create schema "public"');
} finally {
  await client.end();
}
console.log(`e2e: wiped database ${String(name)}`);

// A fresh, empty upload directory (the API refuses to start without it). It is a fixed path under the temp directory.
rmSync(E2E_MEDIA_DIR, { recursive: true, force: true });
mkdirSync(E2E_MEDIA_DIR, { recursive: true, mode: 0o750 });
console.log(`e2e: upload directory ${E2E_MEDIA_DIR}`);

// A fresh mailbox: the fake email provider appends to this file, and a mail of an earlier run must never be found.
rmSync(E2E_MAIL_FILE, { force: true });

// Search on: nothing of an earlier run in the engine, and a key scoped to this suite's index prefix (created with the master
// key, which only this setup and the teardown hold). `apiEnvironment()` below picks the key up from its file, so the seed
// (its catalog writes mark the products for the index), the reindex and the API all run with search enabled.
if (E2E_SEARCH_ENABLED) {
  await createSuiteKey(process.env);
  console.log("e2e: engine key created");
}

const env = apiEnvironment();
const run = (script: string, args: string[] = [], extra: Env = {}) =>
  execFileSync(process.execPath, [resolve(apiRoot, "dist", script), ...args], {
    // The Next.js typings make NODE_ENV mandatory in ProcessEnv; apiEnvironment() deliberately leaves it unset.
    env: { ...env, ...extra } as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
run("database/migrate.js");
run("seed/seed.js");
run("auth/create-admin.js", ["--email", ADMIN_EMAIL], { ADMIN_PASSWORD });
// `pnpm search:reindex`: builds the index of every locale from the seeded catalog and swaps it in, so the first page load
// finds products (the scheduler is off in this suite, nothing else would build it).
if (E2E_SEARCH_ENABLED) run("search/reindex.js");
console.log("e2e: database ready");
