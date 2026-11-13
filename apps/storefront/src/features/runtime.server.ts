import { notFound } from "next/navigation";
import { cache } from "react";
import { StoreUnavailableError, type StoreData } from "../lib/store-data";
import { storeData } from "../lib/store-data.server";
import type { FeatureData } from "./types";

/**
 * The running app's view of the optional features (plan docs/plans/2026-11-13-blog.md, E5). Server code only. It does not
 * import the registry, so a slice's pages may import it without a cycle.
 */

/**
 * The names in `GET /store/config` `features` (the API's `FEATURES_ENABLED` that loaded). A config that cannot be read, or
 * answers 4xx, throws: whether a feature is on is then unknown, and a page must not guess.
 */
export async function loadEnabledFeatures(data: Pick<StoreData, "getConfig">): Promise<string[]> {
  const outcome = await data.getConfig();
  if (!outcome.ok) {
    throw new Error(
      `GET /store/config answered ${String(outcome.status)} ${outcome.problem.code}, so the enabled features are unknown.`,
    );
  }
  return outcome.data.features;
}

/** `loadEnabledFeatures` of the running app, read once per request (the config itself is cached for 60 s). */
export const getEnabledFeatures = cache(() => loadEnabledFeatures(storeData));

/**
 * The first call of every page and `generateMetadata` of a slice, before any read of the feature's API: a real 404 while the
 * feature is not enabled (no `loading.tsx` sits above a slice, `route-structure.spec.ts`). An unreadable config throws (the
 * route's error view).
 */
export async function requireFeature(name: string): Promise<void> {
  if (!(await getEnabledFeatures()).includes(name)) notFound();
}

/**
 * The enabled features for the header and the footer. They must not take every page down: an API that cannot be read (already
 * logged by the store data layer) means no feature link, like the header's category links; anything else throws.
 */
export async function shellEnabledFeatures(): Promise<string[]> {
  try {
    return await getEnabledFeatures();
  } catch (error) {
    if (error instanceof StoreUnavailableError) return [];
    throw error;
  }
}

/** The reads of one feature against the running app's API (`StoreData.featureRead`, never the last-good copy). */
export function featureData(name: string, data: StoreData = storeData): FeatureData {
  return { read: (operation, call, read) => data.featureRead(name, operation, call, read) };
}
