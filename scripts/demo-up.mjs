#!/usr/bin/env node
// `pnpm demo:up`: everything a developer machine needs to click through the demo shop (README "Try it locally").
//
//   1. Writes `.env` from `.env.example` when it is missing: random local secrets (node:crypto), the database `fluxkit_dev`,
//      search on, local media uploads, plain-HTTP cookies and the TEST-ONLY `fake` shipping and payment providers.
//      An existing `.env` is used as it is (only a placeholder MEILI_API_KEY is replaced, see 3).
//   2. Starts Postgres, Redis and Meilisearch with `infra/docker-compose.yml` and waits until they are healthy
//      (`--skip-docker`: the services already run, for example natively).
//   3. Creates a Meilisearch key scoped to the index prefix (README "Catalog search") when MEILI_API_KEY is still the
//      placeholder, and writes it into `.env`.
//   4. Builds, migrates, seeds the demo catalog (with its images), builds the search index.
//   5. Creates the admin owner `owner@example.com` (`--admin-email` to change) with a random password, printed ONCE and
//      stored nowhere; skipped when that admin exists.
//   6. Prints the URLs and the commands that start the API, the storefront and the admin.
//
// Development only. It refuses NODE_ENV=production and a database whose name does not end in _dev, _demo, _local or _test.
// It never deletes data; `pnpm demo:down` stops the services and keeps their volumes.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertDemoDatabase,
  childEnv,
  composeArgs,
  envFile,
  loadPg,
  parseEnv,
  repoRoot,
  run,
} from "./demo-lib.mjs";

const MEILI_KEY_PLACEHOLDER = "change-me-scoped-search-key";
const DEFAULT_ADMIN_EMAIL = "owner@example.com";

function usage() {
  return "Usage: pnpm demo:up [--skip-docker] [--admin-email <address>]";
}

function parseArgs(argv) {
  const options = { skipDocker: false, adminEmail: DEFAULT_ADMIN_EMAIL };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--skip-docker") {
      options.skipDocker = true;
    } else if (arg === "--admin-email" && argv[index + 1] !== undefined) {
      options.adminEmail = argv[++index];
    } else {
      throw new Error(`Unknown argument ${arg}. ${usage()}`);
    }
  }
  return options;
}

const hex = (bytes) => randomBytes(bytes).toString("hex");

/** Sets `KEY=value` on its line in the example (also a commented `# KEY=` line), or appends it. */
function setLine(lines, key, value) {
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  const commented = lines.findIndex((line) => line.startsWith(`# ${key}=`));
  const at = index >= 0 ? index : commented;
  if (at >= 0) {
    lines[at] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
}

function writeDemoEnv() {
  const example = readFileSync(resolve(repoRoot, ".env.example"), "utf8");
  const base = parseEnv(example);
  const postgresPassword = hex(18);
  const redisPassword = hex(18);
  const user = base.POSTGRES_USER ?? "fluxkit";
  const values = {
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: "fluxkit_dev",
    REDIS_PASSWORD: redisPassword,
    MEILI_MASTER_KEY: hex(24),
    DATABASE_URL: `postgres://${user}:${postgresPassword}@127.0.0.1:${base.POSTGRES_PORT ?? "5432"}/fluxkit_dev`,
    REDIS_URL: `redis://:${redisPassword}@127.0.0.1:${base.REDIS_PORT ?? "6379"}`,
    SEARCH_ENABLED: "true",
    MEILI_API_KEY: MEILI_KEY_PLACEHOLDER,
    ORDER_TOKEN_SECRET: randomBytes(48).toString("base64url"),
    ADMIN_COOKIE_SECURE: "false",
    STORE_COOKIE_SECURE: "false",
    // TEST-ONLY providers (refused under NODE_ENV=production): a pickup point carrier and a payment that charges nothing.
    SHIPPING_PROVIDERS_ENABLED: "fake",
    PAYMENT_PROVIDERS_ENABLED: "fake",
    FAKE_PAYMENT_ADOPT_WEBHOOKS: "true",
    MEDIA_STORAGE_DRIVER: "local",
  };
  const lines = example.split("\n");
  for (const [key, value] of Object.entries(values)) {
    setLine(lines, key, value);
  }
  const header = [
    "# Written by `pnpm demo:up` for a LOCAL demo: random secrets of this machine, test-only providers. Never commit it,",
    "# never use it for a real shop. Delete it and run `pnpm demo:up` again (with fresh volumes) to start over.",
  ];
  writeFileSync(envFile, `${header.join("\n")}\n${lines.join("\n")}`, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  console.log("Wrote .env with random local secrets (mode 0600, git-ignored).");
}

/** Replaces the MEILI_API_KEY line of `.env` (the only line this script ever changes in an existing file). */
function storeMeiliKey(key) {
  const lines = readFileSync(envFile, "utf8").split("\n");
  setLine(lines, "MEILI_API_KEY", key);
  writeFileSync(envFile, lines.join("\n"), { mode: 0o600 });
}

async function createSearchKey(values) {
  const prefix = values.MEILI_INDEX_PREFIX || "fluxkit_";
  const response = await fetch(`${values.MEILI_URL}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${values.MEILI_MASTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: "fluxkit API (pnpm demo:up)",
      indexes: [`${prefix}*`],
      expiresAt: null,
      actions: [
        "search",
        "documents.add",
        "documents.delete",
        "indexes.create",
        "indexes.delete",
        "indexes.swap",
        "settings.update",
        "settings.get",
        "tasks.get",
        "tasks.delete",
        "stats.get",
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Meilisearch refused to create the search key (HTTP ${response.status}).`);
  }
  const { key } = await response.json();
  return key;
}

async function adminExists(values, email) {
  const { Client } = loadPg();
  const client = new Client({ connectionString: values.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query("select 1 from admin_user where email = lower($1)", [email]);
    return result.rowCount > 0;
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(resolve(repoRoot, "node_modules"))) {
    throw new Error(
      "Dependencies are not installed. Run `pnpm install` (Node 22, pnpm 10.28; `corepack enable`), then `pnpm demo:up` again.",
    );
  }
  if (existsSync(envFile)) {
    console.log("Using the existing .env (not changed, except a placeholder MEILI_API_KEY).");
  } else {
    writeDemoEnv();
  }
  let values = parseEnv(readFileSync(envFile, "utf8"));
  const database = assertDemoDatabase(values);
  const searchOn = values.SEARCH_ENABLED === "true";

  if (options.skipDocker) {
    console.log("--skip-docker: expecting Postgres, Redis and Meilisearch to run already.");
  } else {
    run("docker", [...composeArgs, "up", "-d", "--wait"]);
  }

  if (searchOn && (values.MEILI_API_KEY ?? "") === MEILI_KEY_PLACEHOLDER) {
    storeMeiliKey(await createSearchKey(values));
    values = parseEnv(readFileSync(envFile, "utf8"));
    console.log("Created a Meilisearch key scoped to the index prefix and wrote it into .env.");
  }

  const env = childEnv(values);
  run("pnpm", ["build"], { env });
  run("pnpm", ["--filter", "@fluxkit/api", "db:migrate"], { env });
  run("pnpm", ["--filter", "@fluxkit/api", "seed"], { env });
  if (searchOn) {
    run("pnpm", ["--filter", "@fluxkit/api", "search:reindex"], { env });
  } else {
    console.log("SEARCH_ENABLED is not true in .env: no search index built.");
  }

  let password;
  if (await adminExists(values, options.adminEmail)) {
    console.log(
      `\nThe admin ${options.adminEmail} exists already: its password is unchanged (printed only when it was created).` +
        "\nLost it? Create another owner: ADMIN_PASSWORD='<12+ characters>' pnpm admin:create --email other@example.com",
    );
  } else {
    // Only in the child's environment: never in a file, an argument or a log.
    password = randomBytes(18).toString("base64url");
    run("pnpm", ["--filter", "@fluxkit/api", "admin:create", "--email", options.adminEmail], {
      env: childEnv(values, { ADMIN_PASSWORD: password }),
    });
  }

  const port = values.PORT || "3000";
  const storefront = values.STOREFRONT_PUBLIC_URL || "http://localhost:3001";
  console.log(`
Demo ready (database ${database}). Start the three servers, each in its own terminal:

  pnpm --filter @fluxkit/api start                  # API on http://127.0.0.1:${port}
  pnpm --filter @fluxkit/storefront dev -p 3001     # shop: ${storefront}/uk
  pnpm --filter @fluxkit/admin dev                  # admin: http://localhost:5173/admin-ui/

Admin sign-in: ${options.adminEmail}${password === undefined ? "" : `  password: ${password}\n(shown once, stored nowhere: save it now)`}

Test-only providers are on: payment "fake" charges nothing and has no payment page; after "Pay" run \`pnpm demo:pay\`.
Delivery methods are seeded INACTIVE: activate them in the admin under Shipping to see the delivery step.
Stop the services with \`pnpm demo:down\` (data is kept).`);
}

main().catch((error) => {
  console.error(`\ndemo:up failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
