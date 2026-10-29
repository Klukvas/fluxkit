import type { SearchEnv } from "@fluxkit/config";
import type pg from "pg";
import { DEFAULT_LOCALE, DEFAULT_LOCALES } from "@fluxkit/config";
import { DEFAULT_PRICING_CONFIG } from "../common/pricing-config.js";
import type { Database } from "../database/database.module.js";
import { SearchEngine } from "../search/engine/index.js";
import { SearchIndexer } from "../search/indexer/index.js";
import {
  DEFAULT_SEARCH_TUNING,
  searchConfigOf,
  type SearchTuning,
} from "../search/search-config.js";
import {
  createScopedKey,
  deleteIndexesWithPrefix,
  deleteKey,
  meiliUrl,
  testIndexPrefix,
} from "./search-engine.js";

/**
 * TEST ONLY: catalog search against the real Meilisearch with a fresh index prefix and a key scoped to it, as an operator
 * sets it up (README "Catalog search"). `env` goes to `startApp({search})`; `indexer()` builds an indexer on the same
 * prefix with another engine address or key when a spec needs a broken engine.
 */
export class SearchWorld {
  private constructor(
    readonly prefix: string,
    readonly key: string,
    private readonly keyUid: string,
  ) {}

  static async create(label = "sw"): Promise<SearchWorld> {
    const prefix = testIndexPrefix(label);
    const key = await createScopedKey(prefix);
    return new SearchWorld(prefix, key.key, key.uid);
  }

  get env(): Extract<SearchEnv, { enabled: true }> {
    return { enabled: true, meiliUrl: meiliUrl(), meiliApiKey: this.key, indexPrefix: this.prefix };
  }

  liveUid(locale: string): string {
    return `${this.prefix}catalog_${locale.replace(/-/g, "_")}`;
  }

  indexer(
    database: Database,
    overrides: { url?: string; key?: string; tuning?: Partial<SearchTuning> } = {},
  ): SearchIndexer {
    const config = searchConfigOf(
      {
        ...this.env,
        ...(overrides.url === undefined ? {} : { meiliUrl: overrides.url }),
        ...(overrides.key === undefined ? {} : { meiliApiKey: overrides.key }),
      },
      { ...DEFAULT_SEARCH_TUNING, taskTimeoutMs: 10_000, ...overrides.tuning },
    );
    if (!config.enabled) {
      throw new Error("Test setup: search config is off");
    }
    return new SearchIndexer(
      database,
      new SearchEngine({
        url: config.meiliUrl,
        apiKey: config.meiliApiKey,
        requestTimeoutMs: config.tuning.requestTimeoutMs,
      }),
      config,
      { defaultLocale: DEFAULT_LOCALE, locales: [...DEFAULT_LOCALES] },
      DEFAULT_PRICING_CONFIG,
    );
  }

  async dispose(pool: pg.Pool): Promise<void> {
    await deleteIndexesWithPrefix(this.prefix);
    await deleteKey(this.keyUid);
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    await pool.query("delete from search_synonym_group");
  }
}

/** A budget that is used up after `units` checks (a job checks before each unit of work). */
export function budgetOf(units: number): { exhausted(): boolean } {
  let used = 0;
  return {
    exhausted: () => {
      used += 1;
      return used > units;
    },
  };
}

export const UNLIMITED_BUDGET = { exhausted: (): boolean => false };
