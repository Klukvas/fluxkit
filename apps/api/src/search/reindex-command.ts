import { loadEnv } from "@fluxkit/config";
import { createApp } from "../app.factory.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { DEFAULT_JOB_BUDGET_MS, JobBudget } from "../jobs/job-budget.js";
import { withSchedulerLock } from "../jobs/scheduler-lock.js";
import { prepareDefaultMediaDirectory } from "../media/media-directory.js";
import { SearchIndexer, SearchIndexStateRepository } from "./indexer/index.js";

const USAGE =
  "Usage: pnpm search:reindex (takes no arguments; DATABASE_URL, SEARCH_ENABLED and MEILI_* come from the environment or .env)";

/** The person running the command can fix this (bad input, search off): the message is the whole output. */
export class ReindexUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReindexUsageError";
  }
}

export type ReindexOutcome =
  | {
      kind: "done";
      documents: number;
      swapped: number;
      synced: number;
      failures: readonly string[];
    }
  /** The scheduler lock is held (a running scheduler or a jobs:run-once): the rebuild is requested and that process does it. */
  | { kind: "lock_held" };

export const REINDEX_EXIT = Object.freeze({ ok: 0, failed: 1, lockHeld: 2 });

/** Rebuild runs of 30 s each; far more than any catalog of the template's size needs (plan section 13: 10 minutes). */
const MAX_RUNS = 120;

/**
 * `pnpm search:reindex` (ADR 0034 decision 5): requests a rebuild of every locale, then runs jobs 14 and 13 in the
 * foreground under the scheduler lock until the new indexes are swapped in and the queue is drained. Used after
 * `pnpm seed` and by operators. Refuses with search off. When the scheduler lock is held, the request stays and the
 * running scheduler does the work at its next ticks.
 */
export async function runReindexCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<ReindexOutcome> {
  if (argv.length > 0) {
    throw new ReindexUsageError(
      `pnpm search:reindex takes no arguments, got: ${argv.join(" ")}. ${USAGE}`,
    );
  }
  const config = loadEnv({ ...env });
  if (!config.search.enabled) {
    throw new ReindexUsageError(
      `Search is off (SEARCH_ENABLED is not true): there is no index to build. ${USAGE}`,
    );
  }
  await prepareDefaultMediaDirectory(config, env);
  const app = await createApp(
    { ...config, schedulerEnabled: false },
    { cleanExpiredSessionsOnBootstrap: false, logLevels: ["error", "warn"] },
  );
  try {
    await app.init();
    const database = app.get<Database>(DRIZZLE);
    const locale = app.get<LocaleConfig>(LOCALE_CONFIG);
    const indexer = app.get(SearchIndexer);
    await new SearchIndexStateRepository().requestRebuild(database, locale.locales, new Date());
    const locked = await withSchedulerLock(config.databaseUrl, async () => {
      let documents = 0;
      let swapped = 0;
      let synced = 0;
      const failures: string[] = [];
      for (let run = 0; run < MAX_RUNS && swapped === 0; run++) {
        const result = await indexer.rebuild(new Date(), new JobBudget(DEFAULT_JOB_BUDGET_MS));
        documents += result.documents;
        swapped += result.swapped;
        failures.push(...result.failures.map((failure) => failure.code));
        if (result.failures.length > 0 || result.waiting) {
          return { documents, swapped, synced, failures };
        }
        if (!result.truncated && result.swapped === 0 && result.started === 0) {
          break;
        }
      }
      for (let run = 0; run < MAX_RUNS; run++) {
        const result = await indexer.sync(new Date(), new JobBudget(DEFAULT_JOB_BUDGET_MS));
        synced += result.synced;
        failures.push(...result.failures.map((failure) => failure.code));
        if (result.failures.length > 0 || (!result.truncated && result.scanned === 0)) {
          break;
        }
      }
      return { documents, swapped, synced, failures };
    });
    return locked.acquired ? { kind: "done", ...locked.value } : { kind: "lock_held" };
  } finally {
    await app.close();
  }
}

export function formatReindex(outcome: ReindexOutcome): string {
  if (outcome.kind === "lock_held") {
    return "Another process holds the scheduler lock (a running scheduler or jobs:run-once). The rebuild is requested; that process builds the index at its next ticks.";
  }
  const lines = [
    `documents=${String(outcome.documents)} swapped=${String(outcome.swapped)} synced=${String(outcome.synced)}`,
  ];
  if (outcome.failures.length > 0) {
    lines.push(
      `failed: ${[...new Set(outcome.failures)].join(", ")} (see GET /admin/search/status)`,
    );
  }
  return lines.join("\n");
}

export function reindexExitCode(outcome: ReindexOutcome): number {
  if (outcome.kind === "lock_held") {
    return REINDEX_EXIT.lockHeld;
  }
  return outcome.failures.length > 0 ? REINDEX_EXIT.failed : REINDEX_EXIT.ok;
}
