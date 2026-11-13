import pg from "pg";
import { DB_CONNECTION_TIMEOUT_MS } from "../database/database.module.js";
import {
  aheadOfJournal,
  appliedTimestamps,
  featureMigrationsTable,
  pendingEntries,
  readJournal,
  type Queryable,
} from "../database/migration-journal.js";
import type { LoadedFeature } from "./feature-loader.js";

/**
 * Refuses to start the API while an enabled feature's migrations table and journal disagree (ADR 0049): migrations the table
 * does not record (its routes would fail on a missing table at the first request), or a recorded migration newer than the
 * whole journal (an older build against a newer feature schema; `pnpm db:migrate` refuses that database the same way).
 * Names the feature and the tags, never the database. A feature without a `drizzle/` journal, and a start without
 * features, run no query at all.
 */
export async function assertFeatureMigrationsApplied(
  db: Queryable,
  features: readonly Pick<LoadedFeature, "name" | "migrationsFolder">[],
): Promise<void> {
  const unapplied: string[] = [];
  const ahead: string[] = [];
  for (const { name, migrationsFolder } of features) {
    if (migrationsFolder === undefined) {
      continue;
    }
    const journal = await readJournal(migrationsFolder);
    const applied = await appliedTimestamps(db, featureMigrationsTable(name));
    const newest = aheadOfJournal(journal, applied);
    if (newest !== undefined) {
      ahead.push(`"${name}" (newest recorded created_at ${newest})`);
      continue;
    }
    const pending = pendingEntries(journal, applied);
    if (pending.length > 0) {
      unapplied.push(`"${name}" (${pending.map((entry) => entry.tag).join(", ")})`);
    }
  }
  const problems = [
    ...(ahead.length === 0
      ? []
      : [
          `Enabled features have migrations that are newer than this code: ${ahead.join("; ")}. ` +
            "Deploy the matching or newer release.",
        ]),
    ...(unapplied.length === 0
      ? []
      : [
          `Enabled features have migrations that are not applied: ${unapplied.join("; ")}. ` +
            "Run `pnpm db:migrate` with the same FEATURES_ENABLED before starting the API.",
        ]),
  ];
  if (problems.length > 0) {
    throw new Error(
      `${problems.join(" ")} (docs/contracts/README.md, section Feature extension points)`,
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
