import type { SearchQuery } from "./search-query";

/**
 * Pure rules of the mobile layout (plan 2026-11-03-storefront-mobile-ux.md): when the product page's sticky buy bar shows,
 * what it says about the chosen variant, how many filters the "Filters (N)" control counts, which facet groups start open,
 * and where Tab goes at the edges of the filter sheet. No DOM here; the components wire them.
 */

/**
 * The buy bar shows while the inline "Add to cart" button is out of view and the footer is not in view (the bar must not
 * cover it). `null`: not observed yet, so the bar stays hidden and never flashes on load.
 */
export function buyBarShown(view: { ctaInView: boolean | null; footerInView: boolean }): boolean {
  return view.ctaInView === false && !view.footerInView;
}

interface SummaryProduct {
  options: readonly { code: string; values: readonly { code: string; name: string }[] }[];
}

/** The chosen values' names in the options' order joined by the locale's `separator` ("Blue, M"); unknown choices are left out. */
export function selectionSummary(
  product: SummaryProduct,
  selection: Readonly<Record<string, string>>,
  separator: string,
): string {
  return product.options
    .map((option) => {
      if (!Object.hasOwn(selection, option.code)) return null;
      return option.values.find((value) => value.code === selection[option.code])?.name ?? null;
    })
    .filter((name): name is string => name !== null)
    .join(separator);
}

function facetKeyOf(entry: string): string {
  const colon = entry.indexOf(":");
  return colon === -1 ? entry : entry.slice(0, colon);
}

/** Chosen values plus a price range, without the facets the page decides itself (a category page's category). */
export function selectedFilterCount(
  query: SearchQuery,
  hiddenFacetKeys: readonly string[],
): number {
  const values = query.facets.filter((entry) => !hiddenFacetKeys.includes(facetKeyOf(entry)));
  return values.length + (query.price === null ? 0 : 1);
}

/** The groups that start open: the first `firstOpen` and every one with a choice (a ticked value or a range in the address). */
export function openFacetKeys(
  facets: readonly { key: string; values: readonly { selected: boolean }[] }[],
  query: SearchQuery,
  firstOpen: number,
): Set<string> {
  const chosen = new Set(query.facets.map(facetKeyOf));
  return new Set(
    facets
      .filter(
        (facet, index) =>
          index < firstOpen ||
          chosen.has(facet.key) ||
          facet.values.some((value) => value.selected),
      )
      .map((facet) => facet.key),
  );
}

/**
 * Where Tab must go inside a modal sheet with `count` focusable controls when the focus is on `current` (-1: outside the
 * sheet): the index to focus when the focus would leave it, or `null` to let the browser move it.
 */
export function nextTrapIndex(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (current === -1) return backwards ? count - 1 : 0;
  if (!backwards && current === count - 1) return 0;
  if (backwards && current === 0) return count - 1;
  return null;
}
