// Gives the admin e2e run a fresh database: wipes it, migrates it, seeds the demo catalog and creates the owner. Run by the
// API's `webServer` entry in `playwright.config.ts` BEFORE the API starts (Playwright starts web servers before
// `globalSetup`, so a global setup would run against a server that is already up). Uses plain `node` and the API's BUILT
// output (`pnpm build` first), the same commands as `pnpm db:migrate`, `pnpm seed` and `pnpm admin:create` without their
// `--env-file`; `pg` is the API's own dependency, resolved from `apps/api`, so the admin package adds nothing.
// The manager and the viewer need the running API (they are created through the users API with the owner's session, as an
// owner would): `global-setup.ts` does that once the servers are up.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  ADMIN_E2E_MEDIA_DIR,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  apiEnvironment,
  databaseNameOf,
  type Env,
  requireE2eDatabaseUrl,
} from "./support/env.ts";

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
console.log(`admin e2e: wiped database ${String(name)}`);

// A fresh, empty upload directory (the API refuses to start without it). It is a fixed path under the temp directory.
rmSync(ADMIN_E2E_MEDIA_DIR, { recursive: true, force: true });
mkdirSync(ADMIN_E2E_MEDIA_DIR, { recursive: true, mode: 0o750 });
console.log(`admin e2e: upload directory ${ADMIN_E2E_MEDIA_DIR}`);

const env = apiEnvironment();
const run = (script: string, args: string[] = [], extra: Env = {}) =>
  execFileSync(process.execPath, [resolve(apiRoot, "dist", script), ...args], {
    env: { ...env, ...extra } as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
run("database/migrate.js");
run("seed/seed.js");
run("auth/create-admin.js", ["--email", OWNER_EMAIL], { ADMIN_PASSWORD: OWNER_PASSWORD });
console.log("admin e2e: database ready");
