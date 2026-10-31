import type { SearchEnv } from "@fluxkit/config";
import { SEARCH_INDEXING } from "@fluxkit/core";
import { DEFAULT_INTERACTIVE_LIMITS } from "./engine/index.js";

/** How long the API waits for the engine (ADR 0034 decision 11). Tests shorten them. */
export interface SearchTuning {
  /** One indexing request (documents, settings, swaps, stats). */
  readonly requestTimeoutMs: number;
  /** One store search or suggest request: past it the route answers `503 search_unavailable`. */
  readonly searchTimeoutMs: number;
  /** The engine check of the admin status. */
  readonly healthTimeoutMs: number;
  /** One indexing task (documents, settings, swap). */
  readonly taskTimeoutMs: number;
  /** A fan-out writer above this many products requests a rebuild instead (core `SEARCH_INDEXING`). */
  readonly fanOutRebuildThreshold: number;
  /** Longest wait of a store search or suggest call for a slot of the engine client (ADR 0041); within its timeout. */
  readonly engineQueueWaitMs: number;
}

export const DEFAULT_SEARCH_TUNING: SearchTuning = Object.freeze({
  requestTimeoutMs: 10_000,
  searchTimeoutMs: 2_000,
  healthTimeoutMs: 2_000,
  taskTimeoutMs: 20_000,
  fanOutRebuildThreshold: SEARCH_INDEXING.fanOutRebuildThreshold,
  engineQueueWaitMs: DEFAULT_INTERACTIVE_LIMITS.maxQueueWaitMs,
});

export const SEARCH_CONFIG = Symbol("SEARCH_CONFIG");

export type SearchConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly meiliUrl: string;
      /** Never logged, never in an error or a response. */
      readonly meiliApiKey: string;
      readonly indexPrefix: string;
      /** Store search and suggest calls in flight at once, and waiting (`SEARCH_ENGINE_MAX_*`, ADR 0041). */
      readonly engineMaxConcurrency: number;
      readonly engineMaxQueue: number;
      readonly tuning: SearchTuning;
    };

/** A caller without an environment (tests, the OpenAPI export, the commands) and `SEARCH_ENABLED=false`. */
export const DISABLED_SEARCH_CONFIG: SearchConfig = Object.freeze({ enabled: false });

export function searchConfigOf(
  env: SearchEnv | undefined,
  tuning: Partial<SearchTuning> = {},
): SearchConfig {
  if (env === undefined || !env.enabled) {
    return DISABLED_SEARCH_CONFIG;
  }
  return {
    enabled: true,
    meiliUrl: env.meiliUrl,
    meiliApiKey: env.meiliApiKey,
    indexPrefix: env.indexPrefix,
    engineMaxConcurrency: env.engineMaxConcurrency,
    engineMaxQueue: env.engineMaxQueue,
    tuning: { ...DEFAULT_SEARCH_TUNING, ...tuning },
  };
}

/** The startup line (plan section 7): no URL, no key; no network call is made at startup. */
export function searchStartupLine(config: SearchConfig): string {
  return config.enabled ? `Search: enabled (${config.indexPrefix})` : "Search: disabled";
}
