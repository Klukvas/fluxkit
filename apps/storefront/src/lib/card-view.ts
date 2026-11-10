/**
 * The `view` presentation URL parameter of the catalog, category and search result lists (plan
 * 2026-11-08-design-changeability.md, L5; contract `docs/contracts/card-registry.md`). Pure. `?view=list` shows the list with
 * the `list` card kind; without it (the default) the `grid` card kind is used. It changes only how the list is shown: it is
 * never sent to the API, never part of a cache key, a canonical URL or the sitemap. Both URL systems keep it
 * (`search-query.ts`, `catalog-query.ts`); an unknown value is dropped by a redirect, as their other parameters are.
 */

export const CARD_VIEWS = ["grid", "list"] as const;
export type CardView = (typeof CARD_VIEWS)[number];

/** The view without a parameter. It is never written into an address (one address per state). */
export const DEFAULT_CARD_VIEW: CardView = "grid";

export const VIEW_PARAM = "view";

export function isCardView(value: string): value is CardView {
  return (CARD_VIEWS as readonly string[]).includes(value);
}

/** The view as stored in a query: only a non-default view is kept (`undefined` means the default grid). */
export function storedView(view: CardView | undefined): CardView | undefined {
  return view === DEFAULT_CARD_VIEW ? undefined : view;
}
