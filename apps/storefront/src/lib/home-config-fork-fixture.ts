import type { HomeSection } from "../config/home.ts";

// The template's `config/home.ts`, unchanged except for `homeSections` below (a local export wins over `export *`). The
// `.ts` extension keeps the fork run's alias of `config/home` from pointing this import back at this file.
export * from "../config/home.ts";

/**
 * A client fork's `config/home.ts` composition, for `vitest.home-fork.config.ts` only (see `home-fork-fixture.tsx`): a
 * full-width custom section first (flush under the header), the hero, a contained custom section, then template sections.
 */
export const homeSections: readonly HomeSection[] = [
  { kind: "custom", id: "home-brands", name: "brandStrip", width: "full" },
  {
    kind: "hero",
    id: "home-hero",
    headlineKey: "home.hero.title",
    cta: { labelKey: "home.hero.cta", href: "/catalog" },
  },
  { kind: "custom", id: "home-promo", name: "promo" },
  { kind: "categories", id: "home-categories", titleKey: "home.categoryTiles.title", limit: 6 },
  { kind: "trust", id: "home-trust", titleKey: "home.trust.title", width: "contained" },
  { kind: "richText", id: "home-about", titleKey: "home.about.title", bodyKey: "home.about.body" },
];
