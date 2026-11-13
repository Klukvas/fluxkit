import pg from "pg";
import { DB_CONNECTION_TIMEOUT_MS } from "../database/database.module.js";
import {
  appliedTimestamps,
  featureMigrationsTable,
  pendingEntries,
  readJournal,
  type Queryable,
} from "../database/migration-journal.js";
import type { LoadedFeature } from "./feature-loader.js";

/**
 * Refuses to start the API while an enabled feature has migrations its table does not record (ADR 0049): its routes
 * would fail on a missing table at the first request instead. Names the feature and the missing tags, never the
 * database. A feature without a `drizzle/` journal, and a start without features, run no query at all.
 */
export async function assertFeatureMigrationsApplied(
  db: Queryable,
  features: readonly Pick<LoadedFeature, "name" | "migrationsFolder">[],
): Promise<void> {
  const problems: string[] = [];
  for (const { name, migrationsFolder } of features) {
    if (migrationsFolder === undefined) {
      continue;
    }
    const pending = pendingEntries(
      await readJournal(migrationsFolder),
      await appliedTimestamps(db, featureMigrationsTable(name)),
    );
    if (pending.length > 0) {
      problems.push(`"${name}" (${pending.map((entry) => entry.tag).join(", ")})`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Enabled features have migrations that are not applied: ${problems.join("; ")}. ` +
        "Run `pnpm db:migrate` with the same FEATURES_ENABLED before starting the API (docs/contracts/features.md).",
    );
  }
}

/**
 * `assertFeatureMigrationsApplied` on its own short connection, for `createApp` BEFORE Nest builds the application (a
 * provider that throws there makes Nest abort the process instead of rejecting). Connects only when an enabled feature
 * ships migrations.
 */
export async function assertFeatureMigrationsAppliedTo(
  databaseUrl: string,
  features: readonly Pick<LoadedFeature, "name" | "migrationsFolder">[],
): Promise<void> {
  if (features.every((feature) => feature.migrationsFolder === undefined)) {
    return;
  }
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
  });
  await client.connect();
  try {
    await assertFeatureMigrationsApplied(client, features);
  } finally {
    await client.end();
  }
}
