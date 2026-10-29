import { attributeField, optionField } from "./fields.js";
import { SEARCH_LIMITS } from "./limits.js";
import {
  DECIMAL_PATTERN,
  MAX_FILTER_NUMBER,
  hasControlCharacter,
  isFieldCode,
  isSlugValue,
  isUuidValue,
  isValueCode,
} from "./patterns.js";

/** A selected range of numbers. Either end may be open, not both. */
export interface NumberRange {
  readonly min?: number;
  readonly max?: number;
}

export type AttributeSelection =
  | { readonly kind: "values"; readonly values: readonly string[] }
  | { readonly kind: "boolean"; readonly value: boolean }
  | ({ readonly kind: "range" } & NumberRange);

/**
 * What a shopper selected, already typed. Values inside one facet are alternatives (OR), facets narrow each other (AND).
 * Built from request parameters by `parseSelectionParams`; the engine filter string is built from it and from nothing else.
 */
export interface SearchSelection {
  /** Brand slugs. */
  readonly brands?: readonly string[];
  /** Category ids (a category matches its descendants because the index stores every ancestor). */
  readonly categories?: readonly string[];
  readonly inStock?: boolean;
  /** Option code to value codes. */
  readonly options?: Readonly<Record<string, readonly string[]>>;
  /** Attribute code to the selection. */
  readonly attributes?: Readonly<Record<string, AttributeSelection>>;
  /** Price range in minor units of the shop currency. */
  readonly price?: NumberRange;
}

export type SearchFilterErrorReason =
  "invalid_value" | "invalid_code" | "invalid_range" | "too_many_values" | "too_many_groups";

export class SearchFilterError extends Error {
  readonly reason: SearchFilterErrorReason;

  constructor(reason: SearchFilterErrorReason, message: string) {
    super(message);
    this.name = "SearchFilterError";
    this.reason = reason;
  }
}

/** A string literal of the engine's filter language: double quotes, backslash and double quote escaped. */
export function quoteFilterValue(value: string): string {
  if (hasControlCharacter(value)) {
    throw new SearchFilterError(
      "invalid_value",
      "A filter value must not contain control characters",
    );
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function numberLiteral(value: number): string {
  const text = String(value);
  if (
    !Number.isFinite(value) ||
    !DECIMAL_PATTERN.test(text) ||
    Math.abs(value) > MAX_FILTER_NUMBER
  ) {
    throw new SearchFilterError("invalid_range", "A range end must be a plain finite number");
  }
  return text;
}

function checkRange(range: NumberRange, integersOnly: boolean): void {
  const { min, max } = range;
  if (min === undefined && max === undefined) {
    throw new SearchFilterError("invalid_range", "A range needs at least one end");
  }
  for (const end of [min, max]) {
    if (end === undefined) {
      continue;
    }
    numberLiteral(end);
    if (integersOnly && (!Number.isSafeInteger(end) || end < 0)) {
      throw new SearchFilterError(
        "invalid_range",
        "A price range end must be a non-negative integer",
      );
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new SearchFilterError("invalid_range", "A range must not end before it starts");
  }
}

function rangeExpression(field: string, range: NumberRange): string {
  const parts: string[] = [];
  if (range.min !== undefined) {
    parts.push(`${field} >= ${numberLiteral(range.min)}`);
  }
  if (range.max !== undefined) {
    parts.push(`${field} <= ${numberLiteral(range.max)}`);
  }
  return parts.join(" AND ");
}

function valuesExpression(field: string, values: readonly string[]): string {
  const unique = [...new Set(values)];
  const literals = unique.map(quoteFilterValue);
  return literals.length === 1
    ? `${field} = ${literals[0]}`
    : `${field} IN [${literals.join(", ")}]`;
}

interface Group {
  readonly key: string;
  readonly expression: string;
  readonly valueCount: number;
}

function checkValues(values: readonly string[], valid: (value: string) => boolean): void {
  for (const value of values) {
    if (!valid(value)) {
      throw new SearchFilterError("invalid_value", "A filter value has the wrong shape");
    }
  }
}

function groupsOf(selection: SearchSelection): Group[] {
  const groups: Group[] = [];
  const valuesGroup = (
    key: string,
    field: string,
    values: readonly string[] | undefined,
    valid: (value: string) => boolean,
  ): void => {
    if (values === undefined || values.length === 0) {
      return;
    }
    checkValues(values, valid);
    const unique = [...new Set(values)];
    groups.push({ key, expression: valuesExpression(field, unique), valueCount: unique.length });
  };

  valuesGroup("brand", "brand", selection.brands, isSlugValue);
  valuesGroup("category", "categories", selection.categories, isUuidValue);
  if (selection.inStock !== undefined) {
    groups.push({ key: "inStock", expression: `inStock = ${selection.inStock}`, valueCount: 1 });
  }
  for (const code of Object.keys(selection.options ?? {}).sort()) {
    if (!isFieldCode(code)) {
      throw new SearchFilterError("invalid_code", "An option code has the wrong shape");
    }
    valuesGroup(`opt.${code}`, optionField(code), selection.options?.[code], isValueCode);
  }
  for (const code of Object.keys(selection.attributes ?? {}).sort()) {
    if (!isFieldCode(code)) {
      throw new SearchFilterError("invalid_code", "An attribute code has the wrong shape");
    }
    const chosen = selection.attributes?.[code];
    if (chosen === undefined) {
      continue;
    }
    const key = `attr.${code}`;
    const field = attributeField(code);
    if (chosen.kind === "values") {
      valuesGroup(key, field, chosen.values, isValueCode);
    } else if (chosen.kind === "boolean") {
      groups.push({ key, expression: `${field} = ${chosen.value}`, valueCount: 1 });
    } else {
      checkRange(chosen, false);
      groups.push({ key, expression: rangeExpression(field, chosen), valueCount: 1 });
    }
  }
  if (selection.price !== undefined) {
    checkRange(selection.price, true);
    groups.push({
      key: "price",
      expression: rangeExpression("price", selection.price),
      valueCount: 1,
    });
  }
  return groups;
}

/** The keys of the facets that have a selection, in filter order (`brand`, `category`, `inStock`, `opt.<code>`, `attr.<code>`, `price`). */
export function selectedGroupKeys(selection: SearchSelection): string[] {
  return groupsOf(selection).map((group) => group.key);
}

/**
 * The engine filter for a selection, or null when nothing is selected (ADR 0034 decision 3). The only way a filter string
 * is made: every value is checked against its shape (slug, uuid, code, number) and quoted, so client text can not change
 * the structure of the filter. `omit` leaves one group out, for the disjunctive facet queries.
 * Throws `SearchFilterError`; the API answers 400.
 */
export function buildSearchFilter(
  selection: SearchSelection,
  options: { readonly omit?: string } = {},
): string | null {
  const groups = groupsOf(selection);
  if (groups.length > SEARCH_LIMITS.maxSelectedGroups) {
    throw new SearchFilterError("too_many_groups", "Too many facets are selected");
  }
  if (groups.reduce((sum, group) => sum + group.valueCount, 0) > SEARCH_LIMITS.maxSelectionValues) {
    throw new SearchFilterError("too_many_values", "Too many values are selected");
  }
  const expressions = groups
    .filter((group) => group.key !== options.omit)
    .map((group) => group.expression);
  return expressions.length === 0 ? null : expressions.join(" AND ");
}
