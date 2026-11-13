/**
 * The storefront slice of an optional feature (plan docs/plans/2026-11-13-blog.md, E5 to E7; contract
 * `docs/contracts/README.md`, "Feature extension points"): a route group `app/[locale]/(feature-<name>)/` whose private
 * `_feature/feature.ts` exports `feature: StorefrontFeature`. Only `features/registry.generated.ts` imports a manifest. A manifest
 * imports nothing but these types, the storefront's constants and its own messages: the registry feeds the messages, the
 * header and the footer, so anything heavier would be in every page (and an import of those back would be a cycle).
 */
import type { Locale } from "@fluxkit/ui";
import type { CatalogOutcome, FeatureCall, ReadOptions } from "../lib/store-data";

/** Where a feature's link shows: after the header's configured links, or in the footer (`docs/contracts/header-footer.md`). */
export type FeatureLinkPlacement = "header" | "footer";

export interface FeatureNavigationLink {
  placement: FeatureLinkPlacement;
  /** A key of the feature's own messages (`features.<name>.`). */
  labelKey: string;
  /** A plain storefront path without the locale, one of the slice's pages (`/blog`). */
  path: string;
}

/** A page of the sitemap: a plain storefront path without the locale; `lastModified` an ISO date when known. */
export interface FeatureSitemapPage {
  path: string;
  lastModified?: string;
}

/** The reads of one feature (`StoreData.featureRead` bound to its name): never served from the last-good copy. */
export interface FeatureData {
  read<T>(operation: string, call: FeatureCall<T>, read?: ReadOptions): Promise<CatalogOutcome<T>>;
}

export interface FeatureSitemapContext {
  /** The locale the sitemap reads the API in (the default locale); each path is then listed once per locale. */
  locale: Locale;
  data: FeatureData;
}

export interface StorefrontFeature {
  /** The feature name of `FEATURES_ENABLED` and `GET /store/config` `features`; equal to the slice folder's `<name>`. */
  name: string;
  navigation: readonly FeatureNavigationLink[];
  /**
   * The slice's public pages for `/sitemap.xml`, asked only while the feature is enabled. A failed read throws: a silently
   * short sitemap would hide pages.
   */
  sitemap(context: FeatureSitemapContext): Promise<readonly FeatureSitemapPage[]>;
  /**
   * The slice's texts per locale, flat keys under `features.<name>.` only, the same keys in every locale: the content of
   * `_feature/messages/<locale>.json` (the release check of `next.config.ts` reads those files). Merged after the area files and
   * before a fork's extras and overrides, so a fork overrides them like any upstream text.
   */
  messages: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
}

/** A registry entry: the slice folder's `<name>` (from the generator) and its manifest. */
export interface RegisteredFeature {
  folder: string;
  feature: StorefrontFeature;
}
