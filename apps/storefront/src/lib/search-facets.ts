import type { SearchFacet, SearchFacetValue, SearchSort } from "@fluxkit/api-client";
import type { Translator } from "@fluxkit/ui";
import { minorUnitsToInput } from "./search-money";
import {
  facetEntry,
  rangeOf,
  setPrice,
  setRange,
  toggleFacet,
  type SearchPrice,
  type SearchQuery,
} from "./search-query";

/**
 * What the facet panel shows, from the API's facets and the address. Pure: the components only lay it out. Nothing here
 * names a niche option or attribute: titles and labels are the API's data (AGENTS.md section 2.3); only the three fixed
 * keys (`brand`, `category`, `inStock`) and the words true and false are the shop's own, through i18n.
 */

const FIXED_FACET_KEYS = ["brand", "category", "inStock"];

export function facetTitle(t: Translator, facet: SearchFacet): string {
  if (facet.label !== null) return facet.label;
  return FIXED_FACET_KEYS.includes(facet.key) ? t(`search.facet.${facet.key}`) : facet.key;
}

export function facetValueLabel(
  t: Translator,
  facet: SearchFacet,
  value: SearchFacetValue,
): string {
  if (value.label !== null) return value.label;
  if (facet.kind === "boolean" && (value.code === "true" || value.code === "false")) {
    return facet.key === "inStock"
      ? t(`search.facet.inStock.${value.code}`)
      : t(`search.facet.${value.code}`);
  }
  return value.code;
}

/** The sorts to offer and the one in force. Relevance needs words; without them the API sorts newest first. */
export function sortChoices(query: SearchQuery): { options: SearchSort[]; selected: SearchSort } {
  const hasWords = query.q !== "";
  const options: SearchSort[] = hasWords
    ? ["relevance", "newest", "price_asc", "price_desc"]
    : ["newest", "price_asc", "price_desc"];
  const selected = query.sort ?? (hasWords ? "relevance" : "newest");
  return { options, selected };
}

/** The texts of the price boxes' placeholders: the cheapest and the dearest price of the result, in major units. */
export function priceBoxHints(
  price: { min: number; max: number } | null,
  exponent: number,
): { min: string; max: string } {
  return price === null
    ? { min: "", max: "" }
    : { min: minorUnitsToInput(price.min, exponent), max: minorUnitsToInput(price.max, exponent) };
}

export interface SelectedFilter {
  /**
   * Unique among the chips (the React key): `<facetKey>:<code>` for a value, `<facetKey>` for a range, `price`. The label is
   * not: two facets may share a title and a value label (review F6).
   */
  key: string;
  label: string;
  /** The query without this one filter: the address of the "remove" link. */
  remove: SearchQuery;
}

function endsText(t: Translator, min: string | null, max: string | null): string {
  if (min !== null && max !== null) return `${min}–${max}`;
  return min !== null ? `${t("search.facet.min")} ${min}` : `${t("search.facet.max")} ${max ?? ""}`;
}

/** Every chosen value, range and price as a removable chip. */
export function selectedFilters(input: {
  query: SearchQuery;
  facets: readonly SearchFacet[];
  t: Translator;
  currency: string;
  exponent: number;
}): SelectedFilter[] {
  const { query, facets, t } = input;
  const chips: SelectedFilter[] = [];
  for (const facet of facets) {
    const title = facetTitle(t, facet);
    if (facet.kind === "range") {
      const range = rangeOf(query, facet.key);
      if (range !== null) {
        chips.push({
          key: facet.key,
          label: `${title}: ${endsText(t, range.min === "" ? null : range.min, range.max === "" ? null : range.max)}`,
          remove: setRange(query, facet.key, null, null),
        });
      }
      continue;
    }
    for (const value of facet.values) {
      if (!value.selected) continue;
      chips.push({
        key: facetEntry(facet.key, value.code),
        label: `${title}: ${facetValueLabel(t, facet, value)}`,
        remove: toggleFacet(query, facet.key, value.code),
      });
    }
  }
  if (query.price !== null) {
    const price: SearchPrice = query.price;
    chips.push({
      key: "price",
      label: `${t("search.facet.price", { currency: input.currency })}: ${endsText(
        t,
        price.min === null ? null : minorUnitsToInput(price.min, input.exponent),
        price.max === null ? null : minorUnitsToInput(price.max, input.exponent),
      )}`,
      remove: setPrice(query, null),
    });
  }
  return chips;
}

export interface FormFailureText {
  messageKey: string;
  /** The `name` of the box to focus, `null` when none is to blame. */
  field: string | null;
}

/** The message and the box for a `reason` of `parseSearchForm`, so the form can say what is wrong before it navigates. */
export function describeFormFailure(reason: string): FormFailureText {
  switch (reason) {
    case "price_min":
      return { messageKey: "searchForm.error.priceMin", field: "priceMin" };
    case "price_max":
      return { messageKey: "searchForm.error.priceMax", field: "priceMax" };
    case "price_order":
      return { messageKey: "searchForm.error.priceOrder", field: "priceMin" };
    default:
      if (reason.startsWith("range:")) {
        return { messageKey: "searchForm.error.range", field: `rmin.${reason.slice(6)}` };
      }
      return { messageKey: "searchForm.error.title", field: null };
  }
}

/**
 * What a product card may claim while variant-level filters are on (review SQ-03, 2026-11-02). Filters operate on
 * variants and group results by product (AGENTS.md 2.3; the index holds one document per variant, ADR 0034), but a list
 * item is the PRODUCT: `GET /store/search` returns its lowest price and its best availability, and nothing about which
 * variants matched (`docs/api/search.md`, "response"; a field for that is a contract change, not made). So:
 * - `null`: no variant-level filter; the card shows the product's own price and availability.
 * - `availability`: what the availability filter says about EVERY matching variant (`inStock:true` alone: in stock;
 *   `inStock:false` alone: out of stock), else `null` and the card says that price and stock depend on the option.
 * - `linkQuery`: the options the filters pin to exactly one value, as the product page's `?opt.<code>=<value>`
 *   (`lib/variant-matcher.ts`), so the card opens on a matching variant.
 */
export interface CardMatch {
  availability: "in_stock" | "out_of_stock" | null;
  linkQuery: string;
}

const OPTION_FACET_PREFIX = "opt.";

export function cardMatch(
  query: Pick<SearchQuery, "facets" | "price">,
  facets: readonly Pick<SearchFacet, "key" | "level">[],
): CardMatch | null {
  const variantKeys = new Set(
    facets.filter((facet) => facet.level === "variant").map((facet) => facet.key),
  );
  const byKey = new Map<string, string[]>();
  for (const entry of query.facets) {
    const colon = entry.indexOf(":");
    const key = entry.slice(0, colon);
    byKey.set(key, [...(byKey.get(key) ?? []), entry.slice(colon + 1)]);
  }
  const variantFiltered =
    query.price !== null ||
    [...byKey.keys()].some(
      (key) => key === "inStock" || key.startsWith(OPTION_FACET_PREFIX) || variantKeys.has(key),
    );
  if (!variantFiltered) return null;
  const stock = byKey.get("inStock") ?? [];
  const only = stock.length === 1 ? stock[0] : undefined;
  const availability = only === "true" ? "in_stock" : only === "false" ? "out_of_stock" : null;
  const link = new URLSearchParams();
  for (const [key, values] of byKey) {
    if (key.startsWith(OPTION_FACET_PREFIX) && values.length === 1) {
      link.append(key, values[0] as string);
    }
  }
  return { availability, linkQuery: link.toString() };
}
