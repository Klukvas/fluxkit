import type { StoreData } from "../lib/store-data";

/**
 * Which optional features are on (plan docs/plans/2026-11-13-blog.md, E5): `GET /store/config` `features`, read through the
 * store data layer, so up to `CATALOG_REVALIDATE_SECONDS` (60 s) old. Pure: the running app's wiring is `runtime.server.ts`.
 */
export interface EnabledFeatures {
  features: readonly string[];
  /** The API could not be read and this is the last good copy in memory: the shop may have switched a feature since. */
  stale: boolean;
}

/** The config's `features`. A config that cannot be read, or answers 4xx, throws: whether a feature is on is then unknown. */
export async function loadEnabledFeatures(
  data: Pick<StoreData, "getConfig">,
): Promise<EnabledFeatures> {
  const outcome = await data.getConfig();
  if (!outcome.ok) {
    throw new Error(
      `GET /store/config answered ${String(outcome.status)} ${outcome.problem.code}, so the enabled features are unknown.`,
    );
  }
  return { features: outcome.data.features, stale: outcome.stale };
}

/**
 * The features for a decision that must be current (a slice's page, the sitemap): a stale copy throws, so a feature the shop
 * switched off during an outage is not served from memory (the route's error view instead). The header and footer take the
 * stale copy (`shellEnabledFeatures`): a link is harmless, its page decides again.
 */
export function currentFeatures(state: EnabledFeatures): readonly string[] {
  if (state.stale) {
    throw new Error(
      "GET /store/config could not be read just now (only an older copy is in memory), so the enabled features are unknown.",
    );
  }
  return state.features;
}
