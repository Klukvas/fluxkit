import type { CardRegistry } from "./types";

/**
 * FORK-OWNED (plan 2026-11-08-design-changeability.md, principle 6; `docs/contracts/card-registry.md`): a client fork
 * registers its own product card kinds here, or overrides `grid` / `list`, with cards in NEW files it imports here. Upstream
 * ships it empty and never edits it afterwards, so a fork's entries never conflict with template updates. Example:
 *
 *   import { CompactCard } from "./compact-card";
 *   export const customCards: CardRegistry = {
 *     compact: { Card: CompactCard, listClassName: "grid grid-cols-2 gap-2 lg:grid-cols-6", maxEagerImages: 6 },
 *   };
 *
 * A card is a server component that receives `CardProps` (a plain view model); it must not be a `'use client'` file.
 */
export const customCards: CardRegistry = {};
