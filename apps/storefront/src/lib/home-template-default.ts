import { isDeepStrictEqual } from "node:util";
import type { HomeSection } from "../config/home";

/**
 * UPSTREAM-ONLY test helper (plan 2026-11-08-design-changeability.md, L4): a copy of the template's default `homeSections`
 * (`config/home.ts`). Specs that pin the template's default home page (its order, its frozen markup) run only while the real
 * config still equals this copy, so a fork that reshapes its home page (config and new files only) keeps a green suite: those
 * specs are skipped there, with their reason in the test name. Not used by the app. Upstream changes it together with
 * `config/home.ts` and the frozen copies.
 */
export const templateHomeSections: readonly HomeSection[] = [
  {
    kind: "hero",
    id: "home-hero",
    headlineKey: "home.hero.title",
    sublineKey: "home.hero.description",
    cta: { labelKey: "home.hero.cta", href: "/catalog" },
    image: { src: "/home/hero.svg", width: 640, height: 480, altKey: null },
    decoration: {
      blob: true,
      sticker: { textKey: "home.hero.sticker" },
      highlightKey: "home.hero.highlight",
      popIn: true,
    },
  },
  {
    kind: "banners",
    source: "admin",
    id: "home-banners",
    titleKey: "home.banners.title",
    reveal: "fade-up",
  },
  {
    kind: "categories",
    id: "home-categories",
    reveal: "pop-in",
    titleKey: "home.categoryTiles.title",
    limit: 6,
  },
  {
    kind: "productRow",
    id: "home-new-products",
    reveal: "fade-up",
    titleKey: "home.newProducts.title",
    limit: 8,
    source: { sort: "newest" },
    viewAll: { labelKey: "home.newProducts.all" },
  },
  { kind: "trust", id: "home-trust", titleKey: "home.trust.title", reveal: "fade-up" },
  {
    kind: "richText",
    id: "home-about",
    titleKey: "home.about.title",
    bodyKey: "home.about.body",
    reveal: "fade-up",
  },
];
/** True while `sections` is the template's default composition (upstream, or a fork that kept it). */
export function isTemplateHomeComposition(sections: readonly HomeSection[]): boolean {
  return isDeepStrictEqual(sections, templateHomeSections);
}

/** Part of the test names of the default pins: why they are skipped in a fork that changed its home page. */
export const TEMPLATE_DEFAULT_ONLY =
  "template default only: skipped once config/home.ts differs from lib/home-template-default.ts";
