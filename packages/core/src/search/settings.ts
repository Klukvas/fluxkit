import { deriveFacetSpecs } from "./facets.js";
import type { SearchAttributeAssignment } from "./facets.js";
import {
  DISPLAYED_FIELDS,
  FIXED_FILTERABLE_FIELDS,
  SEARCHABLE_FIELDS,
  SEARCH_FIELDS,
  SORTABLE_FIELDS,
} from "./fields.js";
import { SEARCH_DOCUMENT_VERSION, SEARCH_LIMITS } from "./limits.js";
import { normalizeSearchWords } from "./query.js";

export interface IndexSettings {
  readonly searchableAttributes: readonly string[];
  readonly filterableAttributes: readonly string[];
  readonly sortableAttributes: readonly string[];
  readonly displayedAttributes: readonly string[];
  readonly typoTolerance: {
    readonly enabled: boolean;
    readonly disableOnAttributes: readonly string[];
    readonly disableOnNumbers: boolean;
  };
  readonly pagination: { readonly maxTotalHits: number };
  readonly faceting: { readonly maxValuesPerFacet: number };
  /** Every term maps to the other terms of its group(s). */
  readonly synonyms: Readonly<Record<string, readonly string[]>>;
  readonly localizedAttributes: readonly {
    readonly attributePatterns: readonly string[];
    readonly locales: readonly string[];
  }[];
}

export interface IndexSettingsInput {
  readonly locale: string;
  /** The shop currency; a different one needs a rebuild because the price field changes meaning. */
  readonly currency: string;
  /** Codes of the options of all product types (each becomes an `opt_<code>` filter). */
  readonly options: readonly { readonly code: string }[];
  /** Attribute assignments of all product types. */
  readonly attributes: readonly SearchAttributeAssignment[];
  /** Admin-managed synonym groups of this locale. */
  readonly synonymGroups: readonly (readonly string[])[];
}

export interface DerivedIndexSettings {
  readonly settings: IndexSettings;
  /** Changes whenever `settings` changes; a different hash is applied to the live index in place. */
  readonly settingsHash: string;
  /** Changes when the documents themselves change meaning (document version, currency, locale): a different key needs a rebuild. */
  readonly rebuildKey: string;
}

const LANGUAGE_TAGS: Readonly<Record<string, string>> = { uk: "ukr", en: "eng" };

function synonymsOf(groups: readonly (readonly string[])[]): Record<string, string[]> {
  const related = new Map<string, Set<string>>();
  for (const group of groups) {
    const terms = [...new Set(group.map((term) => normalizeSearchWords(term).join(" ")))].filter(
      (term) => term !== "",
    );
    if (terms.length < 2) {
      continue;
    }
    for (const term of terms) {
      const others = related.get(term) ?? new Set<string>();
      for (const other of terms) {
        if (other !== term) {
          others.add(other);
        }
      }
      related.set(term, others);
    }
  }
  const result: Record<string, string[]> = {};
  for (const term of [...related.keys()].sort()) {
    result[term] = [...(related.get(term) ?? [])].sort();
  }
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** cyrb53, a small non-cryptographic 53-bit string hash. It only detects "the settings changed", it protects nothing. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0");
}

/**
 * The index settings of one locale, derived from the catalog definitions (ADR 0034 decision 2) so adding an option or a
 * filterable attribute needs no code change. Only public, filterable attributes become filters; nothing about an
 * internal attribute appears. No `distinctAttribute`: a request can not switch it off again, so `distinct` is sent per
 * request (spike S1, E1).
 */
export function deriveIndexSettings(input: IndexSettingsInput): DerivedIndexSettings {
  const specs = deriveFacetSpecs({ options: input.options, attributes: input.attributes });
  const dynamicFilters = specs
    .map((spec) => spec.field)
    .filter((field) => !FIXED_FILTERABLE_FIELDS.includes(field));
  const tag = LANGUAGE_TAGS[input.locale.toLowerCase().split("-")[0] ?? ""];
  const settings: IndexSettings = {
    searchableAttributes: SEARCHABLE_FIELDS,
    filterableAttributes: [...FIXED_FILTERABLE_FIELDS, ...dynamicFilters],
    sortableAttributes: SORTABLE_FIELDS,
    displayedAttributes: DISPLAYED_FIELDS,
    typoTolerance: {
      enabled: true,
      // SKUs and stems must match exactly; numbers (sizes, models) too.
      disableOnAttributes: [SEARCH_FIELDS.sku, SEARCH_FIELDS.stems, SEARCH_FIELDS.stems5],
      disableOnNumbers: true,
    },
    pagination: { maxTotalHits: SEARCH_LIMITS.maxTotalHits },
    faceting: { maxValuesPerFacet: SEARCH_LIMITS.maxFacetValuesPerFacet },
    synonyms: synonymsOf(input.synonymGroups),
    localizedAttributes: tag === undefined ? [] : [{ attributePatterns: ["*"], locales: [tag] }],
  };
  return {
    settings,
    settingsHash: hash53(stableJson(settings)),
    rebuildKey: `${SEARCH_DOCUMENT_VERSION}:${input.currency}:${input.locale}`,
  };
}
