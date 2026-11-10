import { HorizontalListCard } from "./horizontal-list-card";
import { PortraitGridCard } from "./portrait-grid-card";
import type { CardRegistry } from "./types";

/**
 * FORK-OWNED (plan 2026-11-08-design-changeability.md, principle 6; `docs/contracts/card-registry.md`): a client fork
 * overrides the `grid` and/or `list` card here, with cards in NEW files it imports here. Upstream ships it empty and never
 * edits it afterwards, so a fork's entries never conflict with template updates. Example:
 *
 *   import { BrandGridCard } from "./brand-grid-card";
 *   export const customCards: CardRegistry = {
 *     grid: { Card: BrandGridCard, listClassName: "grid grid-cols-2 gap-2 lg:grid-cols-6", maxEagerImages: 6 },
 *   };
 *
 * Today ONLY overrides of `grid` / `list` take effect: the lists choose the kind from `?view=` (default `grid`). A new kind
 * name registered here is accepted but never selected until `config/catalog.ts` (plan L2) can name it: NOT YET AVAILABLE.
 *
 * A card is a server component that receives `CardProps` (a plain view model); it must not be a `'use client'` file.
 */
export const customCards: CardRegistry = {
  // Reshape R1: the portrait card with the price pill, sale badge and favourite heart over the picture.
  grid: {
    Card: PortraitGridCard,
    listClassName: "grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4",
    maxEagerImages: 4,
  },
  // Reshape R2: the horizontal card of `?view=list` (the list/grid switch itself ships with the template).
  list: { Card: HorizontalListCard, listClassName: "grid grid-cols-1 gap-4", maxEagerImages: 2 },
};
