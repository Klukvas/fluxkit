import type { RebuildResult, SearchIndexer, SyncResult } from "../search/indexer/index.js";
import type { JobBudget } from "./job-budget.js";

export interface SearchIndexJobDeps {
  indexer: Pick<SearchIndexer, "sync" | "rebuild">;
}

/**
 * Job 13 `sync-search-index` (ADR 0034 decision 5): applies the queued product changes to the live indexes, at most 20
 * pages of 100 products per run, and applies changed index settings in place. With `SEARCH_ENABLED=false` it reads
 * nothing (`enabled: false`); while a rebuild runs or is due it leaves the queue alone (`paused: true`).
 */
export function syncSearchIndex(
  deps: SearchIndexJobDeps,
  now: Date,
  options: { budget: JobBudget },
): Promise<SyncResult> {
  return deps.indexer.sync(now, options.budget);
}

/**
 * Job 14 `rebuild-search-index`: builds every locale's index from scratch when one is missing, built for another document
 * version or currency, or a rebuild was requested, resumes a running build from its cursor and swaps all locales in with
 * one atomic request when it is complete. Off with `SEARCH_ENABLED=false`.
 */
export function rebuildSearchIndex(
  deps: SearchIndexJobDeps,
  now: Date,
  options: { budget: JobBudget },
): Promise<RebuildResult> {
  return deps.indexer.rebuild(now, options.budget);
}
