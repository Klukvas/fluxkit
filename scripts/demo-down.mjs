#!/usr/bin/env node
// `pnpm demo:down`: stops and removes the Compose containers of `pnpm demo:up` and KEEPS their volumes (database, search
// index). To start over from nothing, remove the volumes yourself, deliberately:
//   docker compose --env-file .env -f infra/docker-compose.yml down -v
// (and delete `.env` if you want new secrets; the Postgres volume keeps the password it was created with).
// Uploaded images stay in MEDIA_DIR (default <repo>/var/media). The API and dev servers you started are not touched.
import { composeArgs, readEnvFile, run } from "./demo-lib.mjs";

try {
  if (process.argv.length > 2) {
    throw new Error("pnpm demo:down takes no arguments.");
  }
  readEnvFile();
  run("docker", [...composeArgs, "down"]);
  console.log("\nServices stopped; volumes kept. `pnpm demo:up` starts them again.");
} catch (error) {
  console.error(`demo:down failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
