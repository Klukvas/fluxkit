import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@fluxkit/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Folder with the generated migrations, resolved from this file (`src/database` and `dist/database` are both two
 * levels below `apps/api`), never from the current directory: it must work from pnpm, from the repository root
 * and from a deployed `dist`.
 */
export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Key of the session-level `pg_advisory_lock` that serializes `pnpm db:migrate` runs on one database. Fixed and
 * documented on purpose: every instance must use the same number. Different from the key (7_426_001) the test
 * helpers use to protect the schema of the shared `_test` database.
 */
export const MIGRATION_LOCK_KEY = 7_426_002;

const USAGE =
  "Usage: pnpm db:migrate (takes no arguments; DATABASE_URL comes from the environment or .env)";

/** The person running the command can fix this (bad input, missing variable): the message is the whole output. */
export class MigrateUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrateUsageError";
  }
}

/** The command decided not to touch the database, and says why. Nothing was changed. */
export class MigrateRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrateRefusal";
  }
}

/** An unexpected failure already turned into text with the connection string and password removed. */
export class MigrateFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrateFailure";
  }
}

export interface MigrateIo {
  log: (line: string) => void;
}

export interface MigrateOptions {
  /** Tests only: another folder with the same layout (`meta/_journal.json` plus `<tag>.sql`). */
  migrationsFolder?: string;
}

export interface MigrateResult {
  /** Name of the migrated database; never the user, password or host. */
  database: string;
  /** Journal tags applied by this run, in order; empty when the database was up to date. */
  applied: string[];
  /** Number of migrations in the journal. */
  total: number;
}

interface JournalEntry {
  tag: string;
  when: number;
}

export function formatMigrateResult(result: MigrateResult): string {
  if (result.applied.length === 0) {
    return `Database is up to date (${result.total} migrations)`;
  }
  const noun = result.applied.length === 1 ? "migration" : "migrations";
  return [
    `Applied ${result.applied.length} ${noun}:`,
    ...result.applied.map((tag) => `  ${tag}`),
  ].join("\n");
}

function databaseNameOf(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")) || "(default)";
  } catch {
    // Only used for display; an unparseable URL fails at connect time with a redacted message.
    return "(unknown)";
  }
}

/** Every form in which the credentials of the URL could show up in an error text. */
function secretsOf(databaseUrl: string): string[] {
  const secrets = new Set<string>([databaseUrl]);
  try {
    const url = new URL(databaseUrl);
    for (const part of [url.password, url.username]) {
      if (part === "") continue;
      secrets.add(part);
      try {
        secrets.add(decodeURIComponent(part));
      } catch {
        // A malformed percent sequence has no decoded form; the raw form is already in the set.
      }
    }
  } catch {
    // Not a URL: the whole string is the only secret we can name.
  }
  return [...secrets].filter((secret) => secret.length > 0);
}

const CONNECTION_STRING = /postgres(?:ql)?:\/\/\S+/gi;

function redact(text: string, secrets: readonly string[]): string {
  let result = text.replace(CONNECTION_STRING, "postgres://[redacted]");
  // Longest first, so the whole URL goes before the password inside it.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join("[redacted]");
  }
  return result;
}

const PG_ERROR_FIELDS = ["code", "detail", "hint", "where"] as const;

function describeOne(error: unknown, depth: number): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const lines = [error.stack ?? error.message];
  const fields = error as unknown as Record<string, unknown>;
  for (const field of PG_ERROR_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value !== "" && !lines[0]?.includes(value)) {
      lines.push(`${field}: ${value}`);
    }
  }
  if (depth < 4) {
    if (error instanceof AggregateError) {
      for (const inner of error.errors as unknown[]) lines.push(describeOne(inner, depth + 1));
    }
    if (error.cause !== undefined) {
      lines.push(`Caused by: ${describeOne(error.cause, depth + 1)}`);
    }
  }
  return lines.join("\n");
}

/** Full error text (stack, Postgres fields, causes) with the connection string and credentials replaced. */
export function describeMigrateError(error: unknown, secrets: readonly string[]): string {
  return redact(describeOne(error, 0), secrets);
}

async function readJournal(folder: string): Promise<JournalEntry[]> {
  const journal = JSON.parse(await readFile(`${folder}/meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

/** `created_at` of every row the migrator recorded; empty before the first run. */
async function appliedTimestamps(pool: pg.Pool): Promise<number[]> {
  const exists = await pool.query<{ name: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations') as name",
  );
  if (exists.rows[0]?.name === null) {
    return [];
  }
  const result = await pool.query<{ created_at: string }>(
    'select created_at from "drizzle"."__drizzle_migrations"',
  );
  return result.rows.map((row) => Number(row.created_at));
}

async function applyPending(
  pool: pg.Pool,
  folder: string,
  database: string,
): Promise<MigrateResult> {
  const journal = await readJournal(folder);
  const applied = await appliedTimestamps(pool);
  const newestApplied = applied.length === 0 ? undefined : Math.max(...applied);
  const newestInJournal =
    journal.length === 0 ? undefined : Math.max(...journal.map((e) => e.when));

  // The Drizzle migrator runs every journal entry newer than the newest recorded one and nothing else. A database
  // whose newest record is newer than the whole journal would therefore look "up to date" to a plain migrate call.
  if (
    newestApplied !== undefined &&
    (newestInJournal === undefined || newestApplied > newestInJournal)
  ) {
    throw new MigrateRefusal(
      `Refusing to migrate database "${database}": it has migrations that are newer than this code ` +
        `(newest recorded created_at ${newestApplied}, newest in the journal ${newestInJournal ?? "none"}). ` +
        "The code is older than the database. Deploy the matching or newer release, or point DATABASE_URL at the right database. " +
        "Nothing was changed.",
    );
  }

  const pending = journal.filter(
    (entry) => newestApplied === undefined || entry.when > newestApplied,
  );
  if (pending.length === 0) {
    return { database, applied: [], total: journal.length };
  }

  // Forward only. Drizzle runs all pending migrations in one transaction; its errors propagate unchanged.
  await migrate(drizzle(pool), { migrationsFolder: folder });

  const recorded = new Set(await appliedTimestamps(pool));
  const missing = pending.filter((entry) => !recorded.has(entry.when));
  if (missing.length > 0) {
    throw new Error(
      `The migrator finished but did not record: ${missing.map((entry) => entry.tag).join(", ")}.`,
    );
  }
  return { database, applied: pending.map((entry) => entry.tag), total: journal.length };
}

/**
 * Applies every pending migration of `apps/api/drizzle` to `DATABASE_URL`, in journal order, using the Drizzle
 * migrator. Forward only: it never rolls back, drops or deletes (rollbacks are the hand-written
 * `drizzle/NNNN_name.down.sql` scripts). Runs under a session-level advisory lock, so two instances starting
 * together cannot both apply. Throws `MigrateUsageError`, `MigrateRefusal` or `MigrateFailure`; the caller decides
 * the exit code.
 */
export async function runMigrateCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: MigrateIo,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  if (argv.length > 0) {
    throw new MigrateUsageError(
      `pnpm db:migrate takes no arguments, got: ${argv.join(" ")}. ${USAGE}`,
    );
  }
  const rawUrl = env["DATABASE_URL"];
  if (rawUrl === undefined || rawUrl.trim() === "") {
    throw new MigrateUsageError(
      `DATABASE_URL is not set. Put it in the root .env (see .env.example) or export it. ${USAGE}`,
    );
  }
  const { databaseUrl } = loadEnv({ ...env });
  const database = databaseNameOf(databaseUrl);
  const secrets = secretsOf(databaseUrl);

  io.log(`Migrating database "${database}"`);
  // A dedicated connection holds the lock for the whole run; the pool (one connection) runs the migrator.
  const lock = new pg.Client({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  let connectionError: Error | undefined;
  const remember = (error: Error): void => {
    connectionError ??= error;
  };
  lock.on("error", remember);
  pool.on("error", remember);
  try {
    await lock.connect();
    await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    const result = await applyPending(pool, options.migrationsFolder ?? migrationsFolder, database);
    if (connectionError !== undefined) {
      throw connectionError;
    }
    return result;
  } catch (error) {
    if (error instanceof MigrateRefusal) {
      throw error;
    }
    throw new MigrateFailure(describeMigrateError(error, secrets));
  } finally {
    // Ending the session releases the advisory lock, also when the connection is already broken or the migration
    // failed; an explicit unlock query could fail and hide the real error.
    await lock.end();
    await pool.end();
  }
}
