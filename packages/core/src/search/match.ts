import type { SearchAttributeFieldValue, SearchFilterDocument } from "./document.js";
import type { FacetSpec } from "./facets.js";
import { attributeField, optionField } from "./fields.js";
import type { NumberRange, SearchSelection } from "./filter.js";

/*
 * Which variant documents a selection matches, evaluated in memory with the semantics of the engine filter that
 * `buildSearchFilter` writes for the same selection (ADR 0034): values of one facet are alternatives (`IN`), facets narrow
 * each other (`AND`), an array field matches when one of its elements does, a missing field never matches, range ends
 * are inclusive. The store uses it to name the matching variants of a hit from CURRENT Postgres facts
 * (`buildSearchFilterDocuments`), so prices and stock never come from the index. A spec in the API compares it with the
 * engine on the same data. Pure.
 */

function anyOf(field: unknown, values: readonly string[]): boolean {
  if (Array.isArray(field)) {
    return field.some((entry) => typeof entry === "string" && values.includes(entry));
  }
  return typeof field === "string" && values.includes(field);
}

function inRange(field: unknown, range: NumberRange): boolean {
  if (typeof field !== "number") {
    return false;
  }
  return (
    (range.min === undefined || field >= range.min) &&
    (range.max === undefined || field <= range.max)
  );
}

function fieldOf(
  document: SearchFilterDocument,
  name: string,
): SearchAttributeFieldValue | undefined {
  return (document as Readonly<Record<string, SearchAttributeFieldValue | undefined>>)[name];
}

/** Whether one variant document fits every selected facet and the price range. The empty selection matches. */
export function matchesSearchSelection(
  document: SearchFilterDocument,
  selection: SearchSelection,
): boolean {
  if (selection.brands !== undefined && selection.brands.length > 0) {
    if (!anyOf(document.brand, selection.brands)) return false;
  }
  if (selection.categories !== undefined && selection.categories.length > 0) {
    if (!anyOf(document.categories, selection.categories)) return false;
  }
  if (selection.inStock !== undefined && document.inStock !== selection.inStock) {
    return false;
  }
  for (const [code, values] of Object.entries(selection.options ?? {})) {
    if (values.length > 0 && !anyOf(fieldOf(document, optionField(code)), values)) {
      return false;
    }
  }
  for (const [code, chosen] of Object.entries(selection.attributes ?? {})) {
    const field = fieldOf(document, attributeField(code));
    if (chosen.kind === "values") {
      if (chosen.values.length > 0 && !anyOf(field, chosen.values)) return false;
    } else if (chosen.kind === "boolean") {
      if (field !== chosen.value) return false;
    } else if (!inRange(field, chosen)) {
      return false;
    }
  }
  if (selection.price !== undefined && !inRange(document.price, selection.price)) {
    return false;
  }
  return true;
}

/**
 * Whether a selection narrows the VARIANTS of a product: `inStock`, a price range, an option, or an attribute whose facet
 * is variant-level (an attribute without a known facet counts as variant-level, the safe side). Brand, category and
 * product-level attributes are the same on every variant, so they never single out variants.
 */
export function hasVariantLevelSelection(
  selection: SearchSelection,
  specs: readonly FacetSpec[],
): boolean {
  if (selection.inStock !== undefined || selection.price !== undefined) {
    return true;
  }
  if (Object.values(selection.options ?? {}).some((values) => values.length > 0)) {
    return true;
  }
  return Object.entries(selection.attributes ?? {}).some(([code, chosen]) => {
    if (chosen.kind === "values" && chosen.values.length === 0) {
      return false;
    }
    const spec = specs.find((entry) => entry.key === `attr.${code}`);
    return spec === undefined || spec.level === "variant";
  });
}
