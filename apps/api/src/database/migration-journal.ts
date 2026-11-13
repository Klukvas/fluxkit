import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The schema of every migrations table, the core one and the per-feature ones (Drizzle's default). */
export const MIGRATIONS_SCHEMA = "drizzle";

/** The core migrations table (Drizzle's default name). */
export const CORE_MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * The migrations table of one feature (ADR 0049): `drizzle.__drizzle_migrations_feature_<name>`, a dash of the name
 * written as an underscore (feature names are lowercase letters, digits and dashes, so the mapping is one to one).
 */
export function featureMigrationsTable(featureName: string): string {
  return `__drizzle_migrations_feature_${featureName.replaceAll("-", "_")}`;
}

/** The prefix every feature migrations table starts with (for the test database reset). */
export const FEATURE_MIGRATIONS_TABLE_PREFIX = "__drizzle_migrations_feature_";

export interface JournalEntry {
  tag: string;
  when: number;
}

/** The entries of `<folder>/meta/_journal.json`, checked for the two fields the runner relies on. */
export async function readJournal(folder: string): Promise<JournalEntry[]> {
  const path = join(folder, "meta", "_journal.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read the migration journal ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (
    !Array.isArray(entries) ||
    !entries.every(
      (entry: unknown) =>
        typeof (entry as JournalEntry | null)?.tag === "string" &&
        Number.isSafeInteger((entry as JournalEntry | null)?.when),
    )
  ) {
    throw new Error(`The migration journal ${path} has no valid "entries" (tag and when).`);
  }
  return (entries as JournalEntry[]).map(({ tag, when }) => ({ tag, when }));
}

/** Something that runs one SQL query: a pool, a pool client or a client. */
export interface Queryable {
  query<Row extends object>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

/** `created_at` of every row of a migrations table; empty when the table does not exist yet. */
export async function appliedTimestamps(db: Queryable, table: string): Promise<number[]> {
  const exists = await db.query<{ name: string | null }>("select to_regclass($1) as name", [
    `"${MIGRATIONS_SCHEMA}"."${table}"`,
  ]);
  if (exists.rows[0]?.name === null || exists.rows[0] === undefined) {
    return [];
  }
  const result = await db.query<{ created_at: string }>(
    `select created_at from "${MIGRATIONS_SCHEMA}"."${table}" order by created_at`,
  );
  return result.rows.map((row) => Number(row.created_at));
}

/** What the Drizzle migrator would run: every entry newer than the newest recorded one, nothing else. */
export function pendingEntries(
  journal: readonly JournalEntry[],
  applied: readonly number[],
): JournalEntry[] {
  const newestApplied = applied.length === 0 ? undefined : Math.max(...applied);
  return journal.filter((entry) => newestApplied === undefined || entry.when > newestApplied);
}

/**
 * The newest recorded `created_at` when it is newer than the whole journal (the database is ahead of this code), else
 * `undefined`. The Drizzle migrator would wrongly call such a database "up to date".
 */
export function aheadOfJournal(
  journal: readonly JournalEntry[],
  applied: readonly number[],
): number | undefined {
  if (applied.length === 0) {
    return undefined;
  }
  const newestApplied = Math.max(...applied);
  const newestInJournal =
    journal.length === 0 ? undefined : Math.max(...journal.map((e) => e.when));
  return newestInJournal === undefined || newestApplied > newestInJournal
    ? newestApplied
    : undefined;
}
