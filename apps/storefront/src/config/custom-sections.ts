import { BrandStrip } from "../components/fork/brand-strip";
import { FullBleedHero } from "../components/fork/full-bleed-hero";
import type { CustomSectionRegistry } from "../lib/custom-sections";

/**
 * FORK-OWNED (plan 2026-11-08-design-changeability.md, principle 6; `docs/contracts/home-sections.md`): the components of
 * the home page's `custom` sections, by name. Upstream ships it empty and never edits it afterwards, so a fork's entries
 * never conflict with template updates. Example (a brand strip in a NEW file of the fork):
 *
 *   import { BrandStrip } from "../components/brand-strip";
 *   export const customSections: CustomSectionRegistry = { brandStrip: BrandStrip };
 *
 * and in `config/home.ts`: `{ kind: "custom", id: "home-brands", name: "brandStrip", width: "full" }`.
 *
 * Each component is a SERVER component (never a `'use client'` file; `client-boundary.spec.ts`) that receives
 * `CustomSectionProps` (a plain view model: id, heading id, locale, translator, first-on-page, width; with `full` it spans
 * the window without a container and draws its own surface). Its texts go through `t` with keys of the fork's `custom.`
 * namespace (`src/messages-extra/{uk,en}.json`). An interactive part is a client component the server component renders with
 * plain, already translated props. A component that throws takes the home page down: handle a failed read inside it.
 */
export const customSections: CustomSectionRegistry = {
  // Reshape R4: the full-bleed hero and the brand-logos strip of the home page (`config/home.ts`).
  fullBleedHero: FullBleedHero,
  brandStrip: BrandStrip,
};
