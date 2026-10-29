import { Logger } from "@nestjs/common";
import {
  buildSearchDocuments,
  decideIndexAction,
  deriveIndexSettings,
  isOwnedIndexUid,
  quoteFilterValue,
  SEARCH_DOCUMENT_VERSION,
  SEARCH_INDEXING,
  searchBuildIndexUid,
  searchLiveIndexUid,
  type DerivedIndexSettings,
  type IndexAction,
  type SearchDocument,
} from "@fluxkit/core";
import { asc, eq } from "drizzle-orm";
import type { LocaleConfig } from "../../common/locale.js";
import type { PricingConfig } from "../../common/pricing-config.js";
import type { Database } from "../../database/database.module.js";
import { searchSynonymGroup } from "../../database/schema/index.js";
import { SearchEngine, SearchEngineError, type TaskUid } from "../engine/index.js";
import { SearchQueueRepository, type ClaimedSync } from "../queue/search-queue.repository.js";
import type { SearchConfig } from "../search-config.js";
import {
  buildContextFor,
  nextActiveProductIds,
  readSearchDefinitions,
  readSearchProducts,
  type SearchDefinitions,
} from "./search-catalog.reader.js";
import { SearchIndexStateRepository, type IndexStateRow } from "./search-index-state.repository.js";

/** What a job may still do in this run (the scheduler's `JobBudget`). */
export interface IndexerBudget {
  exhausted(): boolean;
}

export interface SyncResult {
  readonly enabled: boolean;
  /** A rebuild runs or is due: the queue is left untouched until it swaps (ADR 0034 decision 5). */
  readonly paused: boolean;
  readonly settingsUpdated: number;
  readonly scanned: number;
  readonly synced: number;
  readonly retried: number;
  readonly failures: readonly { readonly code: string; readonly products: number }[];
  readonly truncated: boolean;
}

export interface RebuildResult {
  readonly enabled: boolean;
  /** Locales whose build started in this run. */
  readonly started: number;
  readonly documents: number;
  readonly swapped: number;
  /** A failed run waits for its backoff (`search_index_state.next_attempt_at`). */
  readonly waiting: boolean;
  readonly failures: readonly { readonly code: string; readonly locales: readonly string[] }[];
  readonly truncated: boolean;
}

interface LocalePlan {
  readonly locale: string;
  readonly liveUid: string;
  readonly derived: DerivedIndexSettings;
  readonly state: IndexStateRow | undefined;
  readonly action: IndexAction;
}

const DISABLED_SYNC: SyncResult = {
  enabled: false,
  paused: false,
  settingsUpdated: 0,
  scanned: 0,
  synced: 0,
  retried: 0,
  failures: [],
  truncated: false,
};

const DISABLED_REBUILD: RebuildResult = {
  enabled: false,
  started: 0,
  documents: 0,
  swapped: 0,
  waiting: false,
  failures: [],
  truncated: false,
};

/** Ids per delete filter, so one filter string stays small. */
const DELETE_FILTER_IDS = 1_000;

/**
 * The indexer (ADR 0034 decision 5): job 13 `sync-search-index` applies queued product changes to the live indexes, job 14
 * `rebuild-search-index` builds every locale's index from scratch and swaps them in at once. Documents are always built
 * from the CURRENT database state by core `buildSearchDocuments`, so repeating any step is harmless. Every engine
 * failure is a `SearchEngineError` with a code: queue rows and state rows keep the code and wait for their backoff, the
 * job reports it, nothing is retried in a loop and nothing is swallowed (other errors propagate and fail the job).
 */
export class SearchIndexer {
  private readonly logger = new Logger("SearchIndexer");

  private readonly queue = new SearchQueueRepository();

  private readonly states = new SearchIndexStateRepository();

  /** When this process last pruned the engine's finished tasks. */
  private lastPrunedAt = 0;

  constructor(
    private readonly database: Database,
    private readonly engine: SearchEngine | null,
    private readonly config: SearchConfig,
    private readonly locale: LocaleConfig,
    private readonly pricing: PricingConfig,
  ) {}

  /** Job 13. */
  async sync(now: Date, budget: IndexerBudget): Promise<SyncResult> {
    const { engine, config } = this;
    if (!config.enabled || engine === null) {
      return DISABLED_SYNC;
    }
    const definitions = await readSearchDefinitions(this.database);
    const plans = await this.plan(definitions, now);
    if (
      plans.some((plan) => plan.action.kind === "rebuild" || plan.action.kind === "continue_build")
    ) {
      return { ...DISABLED_SYNC, enabled: true, paused: true };
    }

    let settingsUpdated = 0;
    for (const plan of plans.filter((entry) => entry.action.kind === "update_settings")) {
      if (isWaiting(plan.state, now)) {
        continue;
      }
      try {
        await engine.waitForTask(
          await engine.updateSettings(plan.liveUid, plan.derived.settings),
          config.tuning.taskTimeoutMs,
        );
        await this.states.recordSettings(
          this.database,
          plan.locale,
          plan.derived.settingsHash,
          now,
        );
        settingsUpdated += 1;
      } catch (error) {
        const code = engineCodeOf(error);
        await this.states.recordFailure(this.database, [plan.locale], code, now);
        this.logger.error(
          `Search settings of locale ${plan.locale} not applied: ${describeEngineError(error)}`,
        );
        return {
          ...DISABLED_SYNC,
          enabled: true,
          settingsUpdated,
          failures: [{ code, products: 0 }],
        };
      }
    }

    let scanned = 0;
    let synced = 0;
    let retried = 0;
    const failures: { code: string; products: number }[] = [];
    let truncated = false;
    for (let page = 0; ; page++) {
      if (page >= SEARCH_INDEXING.syncMaxPages || budget.exhausted()) {
        truncated = true;
        break;
      }
      const claimed = await this.queue.claimDue(this.database, now, SEARCH_INDEXING.syncPageSize);
      if (claimed.length === 0) {
        break;
      }
      scanned += claimed.length;
      try {
        await this.applyToLiveIndexes(claimed, plans, definitions);
      } catch (error) {
        const code = engineCodeOf(error);
        await this.queue.recordFailure(this.database, claimed, code, now);
        retried += claimed.length;
        failures.push({ code, products: claimed.length });
        // One failure per run is enough: the engine is likely down or refusing, the rest waits for the next tick.
        this.logger.error(
          `Search sync of ${String(claimed.length)} products failed: ${describeEngineError(error)}`,
        );
        break;
      }
      synced += await this.queue.settleSynced(this.database, claimed);
    }
    if (failures.length === 0) {
      await this.pruneTasks(now);
    }
    return {
      enabled: true,
      paused: false,
      settingsUpdated,
      scanned,
      synced,
      retried,
      failures,
      truncated,
    };
  }

  /** Job 14. */
  async rebuild(now: Date, budget: IndexerBudget): Promise<RebuildResult> {
    const { engine, config } = this;
    if (!config.enabled || engine === null) {
      return DISABLED_REBUILD;
    }
    const definitions = await readSearchDefinitions(this.database);
    let plans = await this.plan(definitions, now);
    // A live index the engine lost (a wiped volume) is rebuilt like a missing one.
    for (const plan of plans) {
      if (plan.action.kind === "none" || plan.action.kind === "update_settings") {
        const missing = await this.indexMissing(plan.liveUid);
        if (missing) {
          await this.states.forgetLive(this.database, plan.locale, now);
        }
      }
    }
    plans = await this.plan(definitions, now);
    const building = plans.filter(
      (plan) => plan.action.kind === "rebuild" || plan.action.kind === "continue_build",
    );
    if (building.length === 0) {
      return { ...DISABLED_REBUILD, enabled: true };
    }
    if (plans.some((plan) => isWaiting(plan.state, now))) {
      return { ...DISABLED_REBUILD, enabled: true, waiting: true };
    }
    // Every locale is rebuilt together: they swap in one request.
    const locales = plans.map((plan) => plan.locale);
    let started = 0;
    let documents = 0;
    try {
      for (const plan of plans) {
        if (plan.action.kind === "continue_build" && plan.state?.buildIndexUid != null) {
          if (!(await this.indexMissing(plan.state.buildIndexUid))) {
            continue;
          }
          // The build index is gone (engine restarted empty): start that locale again.
          await this.states.dropBuild(this.database, plan.locale, now);
        } else if (plan.state?.buildIndexUid != null) {
          await this.deleteOwnedIndex(plan.state.buildIndexUid);
          await this.states.dropBuild(this.database, plan.locale, now);
        }
        await this.startBuild(plan, now);
        started += 1;
      }

      const fresh = await this.states.loadAll(this.database);
      let complete = true;
      for (const plan of plans) {
        const state = fresh.get(plan.locale);
        const buildUid = state?.buildIndexUid;
        if (buildUid == null) {
          throw new Error(`The build of locale ${plan.locale} has no index after it was started.`);
        }
        let cursor = state?.buildCursor ?? null;
        for (;;) {
          if (budget.exhausted()) {
            complete = false;
            break;
          }
          const ids = await nextActiveProductIds(
            this.database,
            cursor,
            SEARCH_INDEXING.rebuildPageProducts,
          );
          if (ids.length === 0) {
            break;
          }
          const added = await this.addDocuments(buildUid, plan.locale, ids, definitions);
          const last = ids[ids.length - 1] ?? cursor;
          if (last === null) {
            break;
          }
          cursor = last;
          documents += added;
          await this.states.advanceBuild(this.database, plan.locale, cursor, added, now);
        }
        if (!complete) {
          break;
        }
      }
      if (!complete) {
        return {
          enabled: true,
          started,
          documents,
          swapped: 0,
          waiting: false,
          failures: [],
          truncated: true,
        };
      }
      const swapped = await this.swapIn(plans, definitions, now);
      return {
        enabled: true,
        started,
        documents,
        swapped,
        waiting: false,
        failures: [],
        truncated: false,
      };
    } catch (error) {
      const code = engineCodeOf(error);
      await this.states.recordFailure(this.database, locales, code, now);
      this.logger.error(`Search index rebuild failed: ${describeEngineError(error)}`);
      return {
        enabled: true,
        started,
        documents,
        swapped: 0,
        waiting: false,
        failures: [{ code, locales }],
        truncated: false,
      };
    }
  }

  /** The derived settings and the decision for every configured locale. */
  private async plan(definitions: SearchDefinitions, now: Date): Promise<LocalePlan[]> {
    if (!this.config.enabled) {
      return [];
    }
    const { indexPrefix } = this.config;
    await this.states.ensureRows(this.database, this.locale.locales);
    const states = await this.states.loadAll(this.database);
    const plans: LocalePlan[] = [];
    for (const locale of this.locale.locales) {
      const synonyms = await this.database
        .select({ terms: searchSynonymGroup.terms })
        .from(searchSynonymGroup)
        .where(eq(searchSynonymGroup.locale, locale))
        .orderBy(asc(searchSynonymGroup.createdAt), asc(searchSynonymGroup.id));
      const derived = deriveIndexSettings({
        locale,
        currency: this.pricing.shopCurrency,
        options: definitions.typeOptionCodes,
        attributes: definitions.allAssignments,
        synonymGroups: synonyms.map((row) => row.terms),
      });
      const state = states.get(locale);
      const action = decideIndexAction({
        locale,
        state:
          state === undefined
            ? null
            : {
                liveIndexUid: state.liveIndexUid,
                settingsHash: state.settingsHash,
                documentVersion: state.documentVersion,
                currency: state.currency,
                rebuildRequestedAt: state.rebuildRequestedAt,
                buildIndexUid: state.buildIndexUid,
                buildStartedAt: state.buildStartedAt,
              },
        derived,
        now,
      });
      plans.push({
        locale,
        liveUid: searchLiveIndexUid(indexPrefix, locale),
        derived,
        state,
        action,
      });
    }
    return plans;
  }

  /** Full replacement of the claimed products' documents in every live index, then removal of documents they lost. */
  private async applyToLiveIndexes(
    claimed: readonly ClaimedSync[],
    plans: readonly LocalePlan[],
    definitions: SearchDefinitions,
  ): Promise<void> {
    const engine = this.requireEngine();
    const timeout = this.taskTimeoutMs();
    const productIds = claimed.map((row) => row.productId);
    const records = await readSearchProducts(this.database, productIds, definitions, this.pricing);
    const tasks: TaskUid[] = [];
    for (const plan of plans) {
      const documents = records.flatMap((record) =>
        buildSearchDocuments(
          record.facts,
          buildContextFor(
            definitions,
            record.productTypeId,
            plan.locale,
            this.locale.defaultLocale,
          ),
        ),
      );
      // Added first, deleted second: tasks of one index run in order, so a sellable product never has no document.
      for (const batch of chunk(documents, SEARCH_INDEXING.rebuildBatchDocuments)) {
        tasks.push(await engine.addDocuments(plan.liveUid, batch));
      }
      for (const filter of staleDocumentFilters(productIds, documents)) {
        tasks.push(await engine.deleteDocumentsByFilter(plan.liveUid, filter));
      }
    }
    for (const task of tasks) {
      await engine.waitForTask(task, timeout);
    }
  }

  private async startBuild(plan: LocalePlan, now: Date): Promise<void> {
    const engine = this.requireEngine();
    if (!this.config.enabled) {
      return;
    }
    const uid = searchBuildIndexUid(this.config.indexPrefix, plan.locale, now);
    await engine.waitForTask(await engine.createIndex(uid), this.taskTimeoutMs());
    await engine.waitForTask(
      await engine.updateSettings(uid, plan.derived.settings),
      this.taskTimeoutMs(),
    );
    await this.states.startBuild(this.database, plan.locale, uid, now);
  }

  private async addDocuments(
    uid: string,
    locale: string,
    productIds: readonly string[],
    definitions: SearchDefinitions,
  ): Promise<number> {
    const engine = this.requireEngine();
    const records = await readSearchProducts(this.database, productIds, definitions, this.pricing);
    const documents: SearchDocument[] = records.flatMap((record) =>
      buildSearchDocuments(
        record.facts,
        buildContextFor(definitions, record.productTypeId, locale, this.locale.defaultLocale),
      ),
    );
    for (const batch of chunk(documents, SEARCH_INDEXING.rebuildBatchDocuments)) {
      await engine.waitForTask(await engine.addDocuments(uid, batch), this.taskTimeoutMs());
    }
    return documents.length;
  }

  /**
   * Swaps every locale's build in with ONE request (atomic, spike S1 E9), then deletes the old indexes and records the new
   * live state. Settings are applied once more right before the swap, so a definition change during the build is in.
   */
  private async swapIn(
    plans: readonly LocalePlan[],
    definitions: SearchDefinitions,
    now: Date,
  ): Promise<number> {
    const engine = this.requireEngine();
    const states = await this.states.loadAll(this.database);
    const fresh = await this.plan(definitions, now);
    const pairs: { indexes: readonly [string, string]; rename: boolean }[] = [];
    const swapped: {
      locale: string;
      liveIndexUid: string;
      settingsHash: string;
      documentVersion: number;
      currency: string;
      documentsCount: number;
    }[] = [];
    for (const plan of plans) {
      const state = states.get(plan.locale);
      const buildUid = state?.buildIndexUid;
      if (buildUid == null) {
        throw new Error(`Locale ${plan.locale} has no build to swap in.`);
      }
      const derived = fresh.find((entry) => entry.locale === plan.locale)?.derived ?? plan.derived;
      await engine.waitForTask(
        await engine.updateSettings(buildUid, derived.settings),
        this.taskTimeoutMs(),
      );
      const liveMissing = await this.indexMissing(plan.liveUid);
      // With `rename` the FIRST uid must exist and takes the second, missing one (probed on v1.55.0).
      pairs.push(
        liveMissing
          ? { indexes: [buildUid, plan.liveUid], rename: true }
          : { indexes: [plan.liveUid, buildUid], rename: false },
      );
      swapped.push({
        locale: plan.locale,
        liveIndexUid: plan.liveUid,
        settingsHash: derived.settingsHash,
        documentVersion: SEARCH_DOCUMENT_VERSION,
        currency: this.pricing.shopCurrency,
        documentsCount: await engine.documentCount(buildUid),
      });
    }
    await engine.swapIndexes(pairs);
    // KNOWN LIMITATION (v1.55.0, pinned in search-engine.spec.ts): a key scoped to indexes can not read the swap task (it
    // belongs to no index). Tasks run in the order they were enqueued, so a settings task on each live uid enqueued after
    // the swap ends after it: waiting for those is waiting for the swap (and re-applies the current settings). A swap that
    // did not happen is found by the document count, which must be the build's.
    for (const [index, entry] of swapped.entries()) {
      const derived = fresh.find((plan) => plan.locale === entry.locale)?.derived;
      await engine.waitForTask(
        await engine.updateSettings(entry.liveIndexUid, derived?.settings ?? {}),
        this.taskTimeoutMs(),
      );
      if ((await engine.documentCount(entry.liveIndexUid)) !== swapped[index]?.documentsCount) {
        throw new SearchEngineError("engine_task_failed", {
          operation: "swap indexes",
          engineCode: "swap_not_applied",
        });
      }
    }
    await this.states.completeSwap(this.database, swapped, now);
    // After a swap the build uid names the OLD live index (or nothing after a rename): delete it.
    for (const pair of pairs) {
      if (!pair.rename) {
        await this.deleteOwnedIndex(pair.indexes[1]);
      }
    }
    return pairs.length;
  }

  private async deleteOwnedIndex(uid: string): Promise<void> {
    if (!this.config.enabled || !isOwnedIndexUid(uid, this.config.indexPrefix)) {
      throw new Error("Refusing to delete an index outside the configured prefix.");
    }
    const engine = this.requireEngine();
    try {
      await engine.waitForTask(await engine.deleteIndex(uid), this.taskTimeoutMs());
    } catch (error) {
      // Already gone is the wanted end state.
      if (
        !(error instanceof SearchEngineError) ||
        (error.code !== "engine_index_missing" && error.engineCode !== "index_not_found")
      ) {
        throw error;
      }
    }
  }

  private async indexMissing(uid: string): Promise<boolean> {
    try {
      await this.requireEngine().documentCount(uid);
      return false;
    } catch (error) {
      if (error instanceof SearchEngineError && error.code === "engine_index_missing") {
        return true;
      }
      throw error;
    }
  }

  /** The engine keeps finished tasks for ever (spike S1, E11): this process prunes its own once an hour. */
  private async pruneTasks(now: Date): Promise<void> {
    const retentionMs = SEARCH_INDEXING.taskRetentionMinutes * 60_000;
    if (now.getTime() - this.lastPrunedAt < retentionMs) {
      return;
    }
    this.lastPrunedAt = now.getTime();
    try {
      // Not waited for: a key scoped to indexes can not read the task-deletion task (search-engine.spec.ts).
      await this.requireEngine().pruneFinishedTasks(new Date(now.getTime() - retentionMs));
    } catch (error) {
      if (!(error instanceof SearchEngineError)) {
        throw error;
      }
      this.logger.warn(`Pruning finished search tasks failed: ${error.code}`);
    }
  }

  private requireEngine(): SearchEngine {
    if (this.engine === null) {
      throw new Error("The search engine is not configured.");
    }
    return this.engine;
  }

  private taskTimeoutMs(): number {
    return this.config.enabled ? this.config.tuning.taskTimeoutMs : 0;
  }
}

function isWaiting(state: IndexStateRow | undefined, now: Date): boolean {
  return state?.nextAttemptAt != null && state.nextAttemptAt.getTime() > now.getTime();
}

/** The code of an engine failure; anything else is a bug and propagates. */
function engineCodeOf(error: unknown): string {
  if (error instanceof SearchEngineError) {
    return error.code;
  }
  throw error;
}

/** The code, and the engine's own code when it sent one (both are identifiers, never a message). */
function describeEngineError(error: unknown): string {
  return error instanceof SearchEngineError
    ? `${error.code}${error.engineCode === undefined ? "" : ` [${error.engineCode}]`}`
    : "unknown";
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Filters that delete the documents of the given products that are not among `documents` (variants that became
 * unsellable, were deleted, or products that are gone). Every value is quoted by core `quoteFilterValue`.
 */
export function staleDocumentFilters(
  productIds: readonly string[],
  documents: readonly SearchDocument[],
): string[] {
  const filters: string[] = [];
  const byProduct = new Map<string, string[]>();
  for (const document of documents) {
    byProduct.set(document.productId, [...(byProduct.get(document.productId) ?? []), document.id]);
  }
  const withoutDocuments = productIds.filter((id) => !byProduct.has(id));
  for (const batch of chunk(withoutDocuments, DELETE_FILTER_IDS)) {
    filters.push(`productId IN [${batch.map(quoteFilterValue).join(", ")}]`);
  }
  // Products with documents are grouped so one filter names at most about DELETE_FILTER_IDS kept ids (a product has at
  // most 250 variants). A group's filter keeps every current document of its products; variant ids are unique.
  let group: string[] = [];
  let kept: string[] = [];
  const flush = (): void => {
    if (group.length > 0) {
      filters.push(
        `productId IN [${group.map(quoteFilterValue).join(", ")}] AND NOT id IN [${kept.map(quoteFilterValue).join(", ")}]`,
      );
    }
    group = [];
    kept = [];
  };
  for (const [productId, ids] of byProduct) {
    if (group.length > 0 && kept.length + ids.length > DELETE_FILTER_IDS) {
      flush();
    }
    group.push(productId);
    kept.push(...ids);
  }
  flush();
  return filters;
}
