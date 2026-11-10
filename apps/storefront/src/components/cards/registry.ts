import { customCards } from "./custom";
import { GridCard } from "./grid-card";
import { ListCard } from "./list-card";
import type { CardKindEntry, CardRegistry } from "./types";

/**
 * The product card REGISTRY (plan 2026-11-08-design-changeability.md, L2; contract: `docs/contracts/card-registry.md`). Lists
 * render cards by kind name through it (`ProductGrid`), so a redesign adds a card in new files and registers it in the
 * fork-owned `custom.ts` instead of editing core cards. Server-only: no `'use client'` file may import it
 * (`client-boundary.spec.ts`); it lives in `components/` because `config/` stays pure data without React.
 */

/** The kinds the template ships: `grid` (the default, today's card) and `list` (`?view=list`). */
export const builtInCards = {
  grid: {
    Card: GridCard,
    listClassName: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
    maxEagerImages: 4,
  },
  list: { Card: ListCard, listClassName: "grid grid-cols-1 gap-4", maxEagerImages: 2 },
} as const satisfies CardRegistry;

/** The built-in kinds with a fork's registrations on top (a fork's entry of the same name wins). */
export function createCardRegistry(custom: CardRegistry): CardRegistry {
  return { ...builtInCards, ...custom };
}

/** The registry the storefront renders with: built-in kinds plus `custom.ts`. */
export const cardRegistry: CardRegistry = createCardRegistry(customCards);

/**
 * The entry of a kind. An unknown name (a typo in a fork's list, a removed kind) falls back to the `grid` card so the
 * shopper still sees the products, and is reported with `console.error` on every render, never silently.
 */
export function resolveCard(kind: string, registry: CardRegistry = cardRegistry): CardKindEntry {
  // Own entries only: a kind such as "toString" must not resolve to an Object.prototype member.
  const entry = Object.hasOwn(registry, kind) ? registry[kind] : undefined;
  if (entry !== undefined) return entry;
  console.error(
    `Unknown product card kind "${kind}"; rendering the "grid" card. Registered kinds: ${Object.keys(registry).join(", ")}. Register it in apps/storefront/src/components/cards/custom.ts.`,
  );
  return registry["grid"] ?? builtInCards.grid;
}
