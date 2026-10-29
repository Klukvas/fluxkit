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
