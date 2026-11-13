import { fileURLToPath } from "node:url";
import { loadEnv } from "@fluxkit/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  DEFAULT_FEATURES_DIR,
  featureMigrationsFolder,
  findEnabledFeatures,
} from "../features/feature-loader.js";
import {
  aheadOfJournal,
  appliedTimestamps,
  CORE_MIGRATIONS_TABLE,
  featureMigrationsTable,
  MIGRATIONS_SCHEMA,
  pendingEntries,
  readJournal,
  type JournalEntry,
} from "./migration-journal.js";

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
  "Usage: pnpm db:migrate (takes no arguments; DATABASE_URL and FEATURES_ENABLED come from the environment or .env)";

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
  /** Tests only: where feature packages are looked up (default `FEATURES_DIR`, else `<repo>/packages/features`). */
  featuresDir?: string;
}

/** What one run did to the journal of one enabled feature (ADR 0049). */
export interface FeatureMigrateResult {
  name: string;
  /** Journal tags applied by this run, in order; empty when the feature was up to date. */
  applied: string[];
  /** Number of migrations in the feature's journal. */
  total: number;
}

export interface MigrateResult {
  /** Name of the migrated database; never the user, password or host. */
  database: string;
  /** Journal tags applied by this run, in order; empty when the database was up to date. */
  applied: string[];
  /** Number of migrations in the journal. */
  total: number;
  /** The enabled features that ship migrations, in `FEATURES_ENABLED` order; empty without such features. */
  features: FeatureMigrateResult[];
}

function plural(count: number): string {
  return count === 1 ? "migration" : "migrations";
}

export function formatMigrateResult(result: MigrateResult): string {
  const lines =
    result.applied.length === 0
      ? [`Database is up to date (${result.total} migrations)`]
      : [
          `Applied ${result.applied.length} ${plural(result.applied.length)}:`,
          ...result.applied.map((tag) => `  ${tag}`),
        ];
  for (const feature of result.features) {
    if (feature.applied.length === 0) {
      lines.push(
        `Feature "${feature.name}" is up to date (${feature.total} ${plural(feature.total)})`,
      );
    } else {
      lines.push(
        `Feature "${feature.name}": applied ${feature.applied.length} ${plural(feature.applied.length)}:`,
        ...feature.applied.map((tag) => `  ${tag}`),
      );
    }
  }
  return lines.join("\n");
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

/** One journal and the table that records it: the core one, or the one of an enabled feature. */
interface JournalTarget {
  /** Absent for the core journal. */
  feature?: string;
  folder: string;
  table: string;
}

interface FeatureTarget extends JournalTarget {
  feature: string;
}

interface Planned {
  journal: JournalEntry[];
  pending: JournalEntry[];
}

/** The enabled features that ship migrations, resolved BEFORE anything connects, so a missing feature changes nothing. */
async function featureTargets(
  enabled: readonly string[],
  featuresDir: string,
): Promise<FeatureTarget[]> {
  let manifests;
  try {
    manifests = await findEnabledFeatures({ enabled, featuresDir });
  } catch (error) {
    throw new MigrateUsageError(`${(error as Error).message} Nothing was changed. ${USAGE}`);
  }
  const targets: FeatureTarget[] = [];
  for (const manifest of manifests) {
    const folder = await featureMigrationsFolder(manifest.dir);
    if (folder !== undefined) {
      targets.push({
        feature: manifest.name,
        folder,
        table: featureMigrationsTable(manifest.name),
      });
    }
  }
  return targets;
}

/**
 * Reads every journal and its table, and refuses before applying anything when one table is ahead of its journal (the
 * code is older than the database): the Drizzle migrator would call it "up to date" and the run would be half done.
 */
async function plan<Target extends JournalTarget>(
  pool: pg.Pool,
  targets: readonly Target[],
  database: string,
): Promise<(Target & Planned)[]> {
  const planned: (Target & Planned)[] = [];
  for (const target of targets) {
    const journal = await readJournal(target.folder);
    const applied = await appliedTimestamps(pool, target.table);
    const ahead = aheadOfJournal(journal, applied);
    if (ahead !== undefined) {
      const newestInJournal =
        journal.length === 0 ? "none" : String(Math.max(...journal.map((e) => e.when)));
      const subject =
        target.feature === undefined
          ? `database "${database}"`
          : `feature "${target.feature}" of database "${database}"`;
      throw new MigrateRefusal(
        `Refusing to migrate ${subject}: it has migrations that are newer than this code ` +
          `(newest recorded created_at ${ahead}, newest in the journal ${newestInJournal}). ` +
          "The code is older than the database. Deploy the matching or newer release, or point DATABASE_URL at the right database. " +
          "Nothing was changed.",
      );
    }
    planned.push({ ...target, journal, pending: pendingEntries(journal, applied) });
  }
  return planned;
}

/** Forward only. Drizzle runs all pending migrations of one journal in one transaction; its errors propagate unchanged. */
async function apply(pool: pg.Pool, target: JournalTarget & Planned): Promise<string[]> {
  if (target.pending.length === 0) {
    return [];
  }
  await migrate(drizzle(pool), {
    migrationsFolder: target.folder,
    migrationsTable: target.table,
    migrationsSchema: MIGRATIONS_SCHEMA,
  });
  const recorded = new Set(await appliedTimestamps(pool, target.table));
  const missing = target.pending.filter((entry) => !recorded.has(entry.when));
  if (missing.length > 0) {
    throw new Error(
      `The migrator finished but did not record: ${missing.map((entry) => entry.tag).join(", ")}.`,
    );
  }
  return target.pending.map((entry) => entry.tag);
}

/**
 * Applies every pending migration of `apps/api/drizzle` to `DATABASE_URL`, in journal order, using the Drizzle
 * migrator; then, for each feature in `FEATURES_ENABLED` that ships a `drizzle/` journal, its pending migrations, each
 * recorded in its own table `drizzle.__drizzle_migrations_feature_<name>` (ADR 0049). A disabled feature is never
 * migrated. Forward only: it never rolls back, drops or deletes (rollbacks are the hand-written `NNNN_name.down.sql`
 * scripts; a feature's go before any core one). Runs under a session-level advisory lock, so two instances starting
 * together cannot both apply. Throws `MigrateUsageError`, `MigrateRefusal` or `MigrateFailure`; the caller decides the
 * exit code.
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
  const { databaseUrl, enabledFeatures, featuresDir } = loadEnv({ ...env });
  const database = databaseNameOf(databaseUrl);
  const secrets = secretsOf(databaseUrl);
  const coreTarget: JournalTarget = {
    folder: options.migrationsFolder ?? migrationsFolder,
    table: CORE_MIGRATIONS_TABLE,
  };
  const features = await featureTargets(
    enabledFeatures,
    options.featuresDir ?? featuresDir ?? DEFAULT_FEATURES_DIR,
  );

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
    const [core] = await plan(pool, [coreTarget], database);
    const plannedFeatures = await plan(pool, features, database);
    if (core === undefined) {
      throw new Error("The core journal is missing from the migration plan.");
    }
    // Core first, then the features in FEATURES_ENABLED order: a feature table may reference a core table, never the reverse.
    const coreApplied = await apply(pool, core);
    const featureResults: FeatureMigrateResult[] = [];
    for (const feature of plannedFeatures) {
      featureResults.push({
        name: feature.feature,
        applied: await apply(pool, feature),
        total: feature.journal.length,
      });
    }
    if (connectionError !== undefined) {
      throw connectionError;
    }
    return { database, applied: coreApplied, total: core.journal.length, features: featureResults };
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
