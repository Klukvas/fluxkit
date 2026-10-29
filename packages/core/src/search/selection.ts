import type { FacetSpec } from "./facets.js";
import type { AttributeSelection, NumberRange, SearchSelection } from "./filter.js";
import { SEARCH_LIMITS } from "./limits.js";
import { MAX_FILTER_NUMBER, isSlugValue, isUuidValue, isValueCode } from "./patterns.js";

export type SelectionErrorReason =
  | "malformed"
  | "unknown_facet_key"
  | "invalid_value"
  | "invalid_range"
  | "too_many_values"
  | "too_many_groups";

export interface SelectionError {
  readonly reason: SelectionErrorReason;
  /** The offending request parameter, for the error message. */
  readonly param: string;
}

export type SelectionResult =
  | { readonly ok: true; readonly selection: SearchSelection }
  | { readonly ok: false; readonly error: SelectionError };

export interface SelectionParams {
  /** Repeated `f=<facetKey>:<value>`. */
  readonly f?: readonly string[];
  /** `price=<min>..<max>`, either end optional. */
  readonly price?: string;
}

const PRICE_RANGE = /^(\d+)?\.\.(\d+)?$/;
const ATTRIBUTE_RANGE = /^(-?\d+(?:\.\d+)?)?\.\.(-?\d+(?:\.\d+)?)?$/;

function parseRange(text: string, pattern: RegExp, integersOnly: boolean): NumberRange | null {
  const match = pattern.exec(text);
  if (match === null) {
    return null;
  }
  const [, low, high] = match;
  const min = low === undefined ? undefined : Number(low);
  const max = high === undefined ? undefined : Number(high);
  if (min === undefined && max === undefined) {
    return null;
  }
  for (const end of [min, max]) {
    if (
      end !== undefined &&
      (Math.abs(end) > MAX_FILTER_NUMBER || (integersOnly && !Number.isSafeInteger(end)))
    ) {
      return null;
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    return null;
  }
  return { ...(min !== undefined && { min }), ...(max !== undefined && { max }) };
}

/**
 * Turns the request parameters of a search into a typed selection (ADR 0033 decision 10). Every `f` value is
 * `<facetKey>:<value>` and its key must be one of the facets of the index (`specs`): an unknown key is an error, never
 * ignored. The value must fit the kind of its facet (slug, uuid, code, `true`/`false`, number range). Nothing here is
 * trusted further than its shape; `buildSearchFilter` still quotes every value.
 */
export function parseSelectionParams(
  params: SelectionParams,
  specs: readonly FacetSpec[],
): SelectionResult {
  const fail = (reason: SelectionErrorReason, param: string): SelectionResult => ({
    ok: false,
    error: { reason, param },
  });
  const entries = params.f ?? [];
  if (entries.length > SEARCH_LIMITS.maxSelectionValues) {
    return fail("too_many_values", "f");
  }
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const brands: string[] = [];
  const categories: string[] = [];
  const options: Record<string, string[]> = {};
  const attributes: Record<string, AttributeSelection> = {};
  let inStock: boolean | undefined;
  const groups = new Set<string>();
  const push = (list: string[], value: string): void => {
    if (!list.includes(value)) {
      list.push(value);
    }
  };

  for (const param of entries) {
    const colon = param.indexOf(":");
    if (colon <= 0 || colon === param.length - 1) {
      return fail("malformed", param);
    }
    const key = param.slice(0, colon);
    const value = param.slice(colon + 1);
    const spec = byKey.get(key);
    if (spec === undefined) {
      return fail("unknown_facet_key", param);
    }
    groups.add(key);
    if (spec.kind === "slug" || spec.kind === "uuid" || spec.kind === "code") {
      const valid =
        spec.kind === "slug"
          ? isSlugValue(value)
          : spec.kind === "uuid"
            ? isUuidValue(value)
            : isValueCode(value);
      if (!valid) {
        return fail("invalid_value", param);
      }
      if (key === "brand") {
        push(brands, value);
      } else if (key === "category") {
        push(categories, value);
      } else if (key.startsWith("opt.")) {
        push((options[key.slice(4)] ??= []), value);
      } else {
        const code = key.slice(5);
        const known = attributes[code];
        const values = known?.kind === "values" ? [...known.values] : [];
        push(values, value);
        attributes[code] = { kind: "values", values };
      }
    } else if (spec.kind === "boolean") {
      if (value !== "true" && value !== "false") {
        return fail("invalid_value", param);
      }
      if (key === "inStock") {
        if (inStock !== undefined) {
          return fail("invalid_value", param);
        }
        inStock = value === "true";
      } else {
        const code = key.slice(5);
        if (attributes[code] !== undefined) {
          return fail("invalid_value", param);
        }
        attributes[code] = { kind: "boolean", value: value === "true" };
      }
    } else {
      const code = key.slice(5);
      if (attributes[code] !== undefined) {
        return fail("invalid_value", param);
      }
      const range = parseRange(value, ATTRIBUTE_RANGE, false);
      if (range === null) {
        return fail("invalid_range", param);
      }
      attributes[code] = { kind: "range", ...range };
    }
  }

  let price: NumberRange | undefined;
  if (params.price !== undefined) {
    const range = parseRange(params.price, PRICE_RANGE, true);
    if (range === null) {
      return fail("invalid_range", "price");
    }
    price = range;
    groups.add("price");
  }
  if (groups.size > SEARCH_LIMITS.maxSelectedGroups) {
    return fail("too_many_groups", "f");
  }

  return {
    ok: true,
    selection: {
      ...(brands.length > 0 && { brands }),
      ...(categories.length > 0 && { categories }),
      ...(inStock !== undefined && { inStock }),
      ...(Object.keys(options).length > 0 && { options }),
      ...(Object.keys(attributes).length > 0 && { attributes }),
      ...(price !== undefined && { price }),
    },
  };
}
