import { z } from "zod";
import { codePointLength, validateI18nText } from "./i18n.js";
import { hasJsonbUnsafeCharacters } from "./text-safety.js";
import { ATTRIBUTE_VALIDATION_DEFAULTS, TEXT_LIMITS } from "./limits.js";
import type {
  AttributeDefinition,
  AttributeInputType,
  AttributeLevel,
  LocaleConfig,
  ProductTypeDefinition,
} from "./types.js";

// ---------------------------------------------------------------------------
// Validation definitions (`attribute.validation`)
// ---------------------------------------------------------------------------

export type ParsedAttributeValidation =
  | { readonly inputType: "text"; readonly minLength: number; readonly maxLength: number }
  | {
      readonly inputType: "number";
      readonly min?: number;
      readonly max?: number;
      readonly integer: boolean;
      readonly maxDecimals: number;
    }
  | { readonly inputType: "boolean" }
  | { readonly inputType: "select" }
  | { readonly inputType: "multiselect"; readonly minItems: number; readonly maxItems: number }
  | { readonly inputType: "date"; readonly min?: string; readonly max?: string };

export type AttributeValidationIssueReason =
  "unknown_key" | "invalid_value" | "min_greater_than_max";

export interface AttributeValidationIssue {
  /** The offending `validation` key; empty when the whole value is not an object. */
  readonly key: string;
  readonly reason: AttributeValidationIssueReason;
}

export type ParseAttributeValidationResult =
  | { readonly ok: true; readonly value: ParsedAttributeValidation }
  | { readonly ok: false; readonly issues: readonly AttributeValidationIssue[] };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as `YYYY-MM-DD` (years 0001 to 9999). */
export function isIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) {
    return false;
  }
  // `Date.UTC` maps years 0 to 99 to 1900 to 1999, so set the year explicitly.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const isoDate = z.string().refine(isIsoCalendarDate);

const validationSchemas = {
  text: z.strictObject({
    min_length: z.number().int().min(0).optional(),
    max_length: z.number().int().min(1).optional(),
  }),
  number: z.strictObject({
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
    max_decimals: z.number().int().min(0).max(20).optional(),
  }),
  boolean: z.strictObject({}),
  select: z.strictObject({}),
  multiselect: z.strictObject({
    min_items: z.number().int().min(0).optional(),
    max_items: z.number().int().min(1).optional(),
  }),
  date: z.strictObject({ min: isoDate.optional(), max: isoDate.optional() }),
} as const;

function rangeIssue(
  min: number | string | undefined,
  max: number | string | undefined,
  key: string,
): AttributeValidationIssue[] {
  return min !== undefined && max !== undefined && min > max
    ? [{ key, reason: "min_greater_than_max" }]
    : [];
}

/**
 * Parses and checks the `validation` JSON of an attribute definition and applies the defaults of
 * ADR 0006 section 4. Unknown keys are rejected so a typo cannot silently disable a rule.
 */
export function parseAttributeValidation(
  inputType: AttributeInputType,
  validation: unknown,
): ParseAttributeValidationResult {
  const parsed = validationSchemas[inputType].safeParse(validation);
  if (!parsed.success) {
    const issues: AttributeValidationIssue[] = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) {
          issues.push({ key, reason: "unknown_key" });
        }
      } else {
        issues.push({ key: String(issue.path[0] ?? ""), reason: "invalid_value" });
      }
    }
    return { ok: false, issues };
  }

  const data: Readonly<Record<string, unknown>> = parsed.data;
  const defaults = ATTRIBUTE_VALIDATION_DEFAULTS;
  switch (inputType) {
    case "text": {
      const minLength = numberOr(data["min_length"], defaults.minLength);
      const maxLength = numberOr(data["max_length"], defaults.maxLength);
      const issues = rangeIssue(minLength, maxLength, "min_length");
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, value: { inputType, minLength, maxLength } };
    }
    case "number": {
      const min = optionalNumber(data["min"]);
      const max = optionalNumber(data["max"]);
      const issues = rangeIssue(min, max, "min");
      return issues.length > 0
        ? { ok: false, issues }
        : {
            ok: true,
            value: {
              inputType,
              min,
              max,
              integer: data["integer"] === true,
              maxDecimals: numberOr(data["max_decimals"], defaults.maxDecimals),
            },
          };
    }
    case "multiselect": {
      const minItems = numberOr(data["min_items"], defaults.minItems);
      const maxItems = numberOr(data["max_items"], defaults.maxItems);
      const issues = rangeIssue(minItems, maxItems, "min_items");
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, value: { inputType, minItems, maxItems } };
    }
    case "date": {
      const min = optionalString(data["min"]);
      const max = optionalString(data["max"]);
      const issues = rangeIssue(min, max, "min");
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, value: { inputType, min, max } };
    }
    case "boolean":
    case "select":
      return { ok: true, value: { inputType } };
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

export type AttributeValueErrorReason =
  | "values_not_an_object"
  | "values_too_large"
  | "unknown_attribute"
  | "null_value"
  | "required"
  | "invalid_definition"
  | "invalid_type"
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_characters"
  | "locale_not_allowed"
  | "default_locale_missing"
  | "not_integer"
  | "too_many_decimals"
  | "below_min"
  | "above_max"
  | "unknown_option"
  | "duplicate_option"
  | "too_few_items"
  | "too_many_items"
  | "invalid_date";

export interface AttributeValueError {
  /** The attribute code, or `null` when the whole values object is at fault. */
  readonly attributeCode: string | null;
  readonly reason: AttributeValueErrorReason;
  readonly locale?: string;
  /** The violated bound, for length, range and item-count reasons. */
  readonly limit?: number | string;
  /** The offending option code, for `unknown_option` and `duplicate_option`. */
  readonly value?: string;
}

export type AttributeValuesResult =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly AttributeValueError[] };

export interface ValidateAttributeValuesOptions extends LocaleConfig {
  /** Draft writes may omit required attributes; publish (and writes to active products) may not. */
  readonly mode: "draft" | "publish";
}

type ErrorDetail = Omit<AttributeValueError, "attributeCode">;

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Number of digits after the decimal point in the shortest round-trip representation. */
function countDecimals(value: number): number {
  const match = /^-?\d+(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (match === null) {
    // Unreachable for finite numbers; reject loudly rather than let a value pass unchecked.
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (match[1]?.length ?? 0) - Number(match[2] ?? 0));
}

function validateText(
  definition: AttributeDefinition,
  rules: { readonly minLength: number; readonly maxLength: number },
  value: unknown,
  locale: LocaleConfig,
): ErrorDetail[] {
  if (definition.isLocalized) {
    const result = validateI18nText(value, {
      defaultLocale: locale.defaultLocale,
      locales: locale.locales,
      minLength: rules.minLength,
      maxLength: rules.maxLength,
      required: true,
    });
    if (result.ok) {
      return [];
    }
    return result.errors.map((error): ErrorDetail => {
      const reason: AttributeValueErrorReason =
        error.reason === "required"
          ? "empty"
          : error.reason === "not_an_object" || error.reason === "not_a_string"
            ? "invalid_type"
            : error.reason;
      return {
        reason,
        ...(error.locale !== undefined && { locale: error.locale }),
        ...(error.limit !== undefined && { limit: error.limit }),
      };
    });
  }
  if (typeof value !== "string") {
    return [{ reason: "invalid_type" }];
  }
  if (value.trim().length === 0) {
    return [{ reason: "empty" }];
  }
  if (hasJsonbUnsafeCharacters(value)) {
    return [{ reason: "invalid_characters" }];
  }
  const length = codePointLength(value);
  if (length < rules.minLength) {
    return [{ reason: "too_short", limit: rules.minLength }];
  }
  if (length > rules.maxLength) {
    return [{ reason: "too_long", limit: rules.maxLength }];
  }
  return [];
}

function validateNumber(
  rules: Extract<ParsedAttributeValidation, { inputType: "number" }>,
  value: unknown,
): ErrorDetail[] {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return [{ reason: "invalid_type" }];
  }
  const errors: ErrorDetail[] = [];
  if (rules.integer) {
    if (!Number.isInteger(value)) {
      errors.push({ reason: "not_integer" });
    }
  } else if (countDecimals(value) > rules.maxDecimals) {
    errors.push({ reason: "too_many_decimals", limit: rules.maxDecimals });
  }
  if (rules.min !== undefined && value < rules.min) {
    errors.push({ reason: "below_min", limit: rules.min });
  }
  if (rules.max !== undefined && value > rules.max) {
    errors.push({ reason: "above_max", limit: rules.max });
  }
  return errors;
}

function validateMultiselect(
  definition: AttributeDefinition,
  rules: Extract<ParsedAttributeValidation, { inputType: "multiselect" }>,
  value: unknown,
): ErrorDetail[] {
  if (!Array.isArray(value) || value.some((item: unknown) => typeof item !== "string")) {
    return [{ reason: "invalid_type" }];
  }
  const codes: readonly string[] = value;
  const allowed = new Set(definition.options.map((option) => option.code));
  const errors: ErrorDetail[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    if (!allowed.has(code)) {
      errors.push({ reason: "unknown_option", value: code });
    } else if (seen.has(code)) {
      errors.push({ reason: "duplicate_option", value: code });
    }
    seen.add(code);
  }
  if (codes.length < rules.minItems) {
    errors.push({ reason: "too_few_items", limit: rules.minItems });
  }
  if (codes.length > rules.maxItems) {
    errors.push({ reason: "too_many_items", limit: rules.maxItems });
  }
  return errors;
}

function validateDate(
  rules: Extract<ParsedAttributeValidation, { inputType: "date" }>,
  value: unknown,
): ErrorDetail[] {
  if (typeof value !== "string") {
    return [{ reason: "invalid_type" }];
  }
  if (!isIsoCalendarDate(value)) {
    return [{ reason: "invalid_date" }];
  }
  const errors: ErrorDetail[] = [];
  // ISO dates with four-digit years compare correctly as strings.
  if (rules.min !== undefined && value < rules.min) {
    errors.push({ reason: "below_min", limit: rules.min });
  }
  if (rules.max !== undefined && value > rules.max) {
    errors.push({ reason: "above_max", limit: rules.max });
  }
  return errors;
}

function validateValue(
  definition: AttributeDefinition,
  value: unknown,
  locale: LocaleConfig,
): ErrorDetail[] {
  const parsed = parseAttributeValidation(definition.inputType, definition.validation);
  if (!parsed.ok) {
    return [{ reason: "invalid_definition" }];
  }
  const rules = parsed.value;
  switch (rules.inputType) {
    case "text":
      return validateText(definition, rules, value, locale);
    case "number":
      return validateNumber(rules, value);
    case "boolean":
      return typeof value === "boolean" ? [] : [{ reason: "invalid_type" }];
    case "select":
      if (typeof value !== "string") {
        return [{ reason: "invalid_type" }];
      }
      return definition.options.some((option) => option.code === value)
        ? []
        : [{ reason: "unknown_option", value }];
    case "multiselect":
      return validateMultiselect(definition, rules, value);
    case "date":
      return validateDate(rules, value);
  }
}

/**
 * Validates the `attributes` JSONB of a product (`level: "product"`) or a variant against the
 * attributes its product type assigns at that level (ADR 0006 section 4). Returns every error.
 */
export function validateAttributeValues(
  productType: ProductTypeDefinition,
  level: AttributeLevel,
  values: unknown,
  options: ValidateAttributeValuesOptions,
): AttributeValuesResult {
  if (!isPlainObject(values)) {
    return { ok: false, errors: [{ attributeCode: null, reason: "values_not_an_object" }] };
  }
  const assignments = productType.attributes.filter((assignment) => assignment.level === level);
  const byCode = new Map(assignments.map((assignment) => [assignment.attribute.code, assignment]));
  const errors: AttributeValueError[] = [];

  for (const [code, value] of Object.entries(values)) {
    const assignment = byCode.get(code);
    if (assignment === undefined) {
      errors.push({ attributeCode: code, reason: "unknown_attribute" });
    } else if (value === null || value === undefined) {
      errors.push({ attributeCode: code, reason: "null_value" });
    } else {
      for (const detail of validateValue(assignment.attribute, value, options)) {
        errors.push({ attributeCode: code, ...detail });
      }
    }
  }

  if (options.mode === "publish") {
    for (const assignment of assignments) {
      if (assignment.isRequired && !Object.hasOwn(values, assignment.attribute.code)) {
        errors.push({ attributeCode: assignment.attribute.code, reason: "required" });
      }
    }
  }

  // Every value passed its type check above, so it is shallow (strings, numbers, booleans, flat arrays and
  // maps of strings) and serializing it is safe. Stringifying first would overflow the stack on a value nested
  // tens of thousands of levels deep.
  if (
    errors.length === 0 &&
    utf8ByteLength(JSON.stringify(values)) > TEXT_LIMITS.attributesJsonBytes
  ) {
    errors.push({
      attributeCode: null,
      reason: "values_too_large",
      limit: TEXT_LIMITS.attributesJsonBytes,
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
