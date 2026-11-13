import { notFound } from "next/navigation";
import { cache } from "react";
import { StoreUnavailableError, type StoreData } from "../lib/store-data";
import { storeData } from "../lib/store-data.server";
import { currentFeatures, loadEnabledFeatures } from "./enabled";
import type { FeatureData } from "./types";

/**
 * The running app's view of the optional features (plan docs/plans/2026-11-13-blog.md, E5; rules in `enabled.ts`). Server code
 * only. It does not import the registry, so a slice's pages may import it without a cycle.
 */

/** `loadEnabledFeatures` of the running app, read once per request (the config itself is cached for 60 s). */
export const getEnabledFeatures = cache(() => loadEnabledFeatures(storeData));

/**
 * The first call of every page and `generateMetadata` of a slice, before any read of the feature's API: a real 404 while the
 * feature is not enabled (no `loading.tsx` sits above a slice, `route-structure.spec.ts`). A config that cannot be read now
 * (none, a 4xx, or only a stale copy in memory) throws: the route's error view.
 */
export async function requireFeature(name: string): Promise<void> {
  if (!currentFeatures(await getEnabledFeatures()).includes(name)) notFound();
}

/**
 * The enabled features for the header and the footer. They must not take every page down: an API that cannot be read (already
 * logged by the store data layer) means no feature link, like the header's category links; a stale copy is used as it is (the
 * link's page decides again); anything else throws.
 */
export async function shellEnabledFeatures(): Promise<readonly string[]> {
  try {
    return (await getEnabledFeatures()).features;
  } catch (error) {
    if (error instanceof StoreUnavailableError) return [];
    throw error;
  }
}

/** The reads of one feature against the running app's API (`StoreData.featureRead`, never the last-good copy). */
export function featureData(name: string, data: StoreData = storeData): FeatureData {
  return { read: (operation, call, read) => data.featureRead(name, operation, call, read) };
}
