import pg from "pg";
import { loadEnv } from "@fluxkit/config";
import { rewrapEnvelopes, type RewrapTables } from "./rewrap-envelopes.js";

export const REWRAP_LOCK_KEY = 7_426_058;
export interface RewrapOutcome {
  readonly exitCode: number;
  readonly tables: RewrapTables;
}

/** Standalone DB operation: no application bootstrap, discovery, provider import or remote calls. */
export async function runRewrapCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<RewrapOutcome> {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--dry-run"))
    throw new Error("integration_rewrap_arguments_invalid");
  if (!env["SECRETS_ENCRYPTION_KEY"]?.trim())
    throw new Error("integration_rewrap_current_key_required");
  if (!env["SECRETS_ENCRYPTION_KEY_PREVIOUS"]?.trim())
    throw new Error("integration_rewrap_previous_key_required");
  let ring;
  try {
    ring = loadEnv({
      DATABASE_URL: env["DATABASE_URL"] ?? "postgres://unused",
      SECRETS_ENCRYPTION_KEY: env["SECRETS_ENCRYPTION_KEY"],
      SECRETS_ENCRYPTION_KEY_PREVIOUS: env["SECRETS_ENCRYPTION_KEY_PREVIOUS"],
    }).secretsKeyRing;
  } catch {
    throw new Error("integration_rewrap_keys_invalid");
  }
  if (ring === null || ring.previous === null) throw new Error("integration_rewrap_keys_invalid");
  if (!env["DATABASE_URL"]?.trim()) throw new Error("integration_rewrap_database_required");
  const client = new pg.Client({
    connectionString: env["DATABASE_URL"],
    connectionTimeoutMillis: 5000,
  });
  // A checked-out connection's error is also reported by its pending query; never print its raw parameters.
  client.on("error", () => {
    process.exitCode = 1;
  });
  try {
    await client.connect();
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [REWRAP_LOCK_KEY],
    );
    if (lock.rows[0]?.locked !== true) throw new Error("integration_rewrap_lock_held");
    const tables = await rewrapEnvelopes(
      client,
      { current: ring.current, previous: ring.previous },
      { dryRun: argv[0] === "--dry-run" },
    );
    return {
      tables,
      exitCode: Object.values(tables).some(
        (table) =>
          table.failed > 0 || table.unknown > 0 || (!argv.length && table.remainingPrevious > 0),
      )
        ? 1
        : 0,
    };
  } finally {
    // Closing the dedicated connection releases its session advisory lock even on failure/interruption.
    await client.end();
  }
}
