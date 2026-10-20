import type {
  AdminProductTypeDetail,
  AttributeInputType,
  JsonObject,
  JsonValue,
  LocalizedText,
  ProblemDetails,
  ProductTypeAttributeLevel,
  UpdateAdminProductBody,
} from "@fluxkit/api-client";
import { diffForPatch, jsonEqual } from "../../lib/diff-for-patch";
import type { FormErrors } from "../../lib/form-errors";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import type { FormIssues } from "../catalog-dictionaries/form-rules";
import {
  localeMapFromValues,
  localeValuesFrom,
  resolveLocalized,
  type LocaleValues,
} from "../catalog-dictionaries/locale-text";

/**
 * The product's attribute form, GENERATED from the product type (ADR 0002 "forms generated from attribute metadata",
 * ADR 0006 section 4, AGENTS.md 2.3): one field per product-level assignment of the type, typed by the definition's
 * `inputType`, `isLocalized`, `unit`, `validation` and options. No attribute code is known to this code. Variant-level
 * attributes belong to the variants (step 6b). Pure; tested first and compared with core's `validateAttributeValues`.
 *
 * The API replaces all product-level values on a PATCH with `attributes` (`docs/api/catalog.md`, no partial update), so
 * the body is the whole map: an attribute the admin did not touch keeps its stored JSON exactly, a value for a code the
 * type no longer assigns is kept as it is (the server decides about it), an emptied field leaves its key out ("not set").
 */

/** Core's `ATTRIBUTE_VALIDATION_DEFAULTS` (compared in the spec; core is not in the bundle). */
export const ATTRIBUTE_DEFAULTS = {
  minLength: 1,
  maxLength: 1000,
  maxDecimals: 3,
  minItems: 1,
  maxItems: 50,
} as const;

export type AttributeRules =
  | { inputType: "text"; minLength: number; maxLength: number }
  | { inputType: "number"; min?: number; max?: number; integer: boolean; maxDecimals: number }
  | { inputType: "boolean" }
  | { inputType: "select" }
  | { inputType: "multiselect"; minItems: number; maxItems: number }
  | { inputType: "date"; min?: string; max?: string };

export interface AttributeFieldSpec {
  code: string;
  name: LocalizedText;
  description: LocalizedText | null;
  inputType: AttributeInputType;
  isLocalized: boolean;
  unit: string | null;
  isRequired: boolean;
  isInternal: boolean;
  /** Select and multiselect choices, by position then code. */
  options: { code: string; label: LocalizedText }[];
  /** `null` when the stored `validation` is not one the API accepts: the form checks nothing, the server answers. */
  rules: AttributeRules | null;
}

export type AttributeFieldValue =
  | { kind: "text"; text: string }
  | { kind: "locales"; values: LocaleValues }
  | { kind: "codes"; codes: string[] };

/** By attribute code. */
export type AttributeFormValues = Readonly<Record<string, AttributeFieldValue>>;

// ------------------------------------------------------------------------------------------------ rules

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Core's `isIsoCalendarDate`: a real calendar date written as `YYYY-MM-DD` (years 0001 to 9999). */
export function isIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const ALLOWED_KEYS: Record<AttributeInputType, readonly string[]> = {
  text: ["min_length", "max_length"],
  number: ["min", "max", "integer", "max_decimals"],
  boolean: [],
  select: [],
  multiselect: ["min_items", "max_items"],
  date: ["min", "max"],
};

function isWhole(value: JsonValue | undefined, minimum: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

/** The validation of a definition with core's defaults, or `null` when core would refuse it (`invalid_definition`). */
export function parseRules(
  inputType: AttributeInputType,
  validation: JsonObject,
): AttributeRules | null {
  if (Object.keys(validation).some((key) => !ALLOWED_KEYS[inputType].includes(key))) return null;
  const get = (key: string): JsonValue | undefined => validation[key];
  const optionalNumber = (key: string) => {
    const value = get(key);
    return value === undefined ? undefined : typeof value === "number" ? value : null;
  };
  switch (inputType) {
    case "text": {
      const min = get("min_length");
      const max = get("max_length");
      if ((min !== undefined && !isWhole(min, 0)) || (max !== undefined && !isWhole(max, 1)))
        return null;
      const minLength = typeof min === "number" ? min : ATTRIBUTE_DEFAULTS.minLength;
      const maxLength = typeof max === "number" ? max : ATTRIBUTE_DEFAULTS.maxLength;
      return minLength > maxLength ? null : { inputType, minLength, maxLength };
    }
    case "number": {
      const min = optionalNumber("min");
      const max = optionalNumber("max");
      const integer = get("integer");
      const decimals = get("max_decimals");
      if (min === null || max === null) return null;
      if (integer !== undefined && typeof integer !== "boolean") return null;
      if (decimals !== undefined && !(isWhole(decimals, 0) && (decimals as number) <= 20))
        return null;
      if (min !== undefined && max !== undefined && min > max) return null;
      return {
        inputType,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        integer: integer === true,
        maxDecimals: typeof decimals === "number" ? decimals : ATTRIBUTE_DEFAULTS.maxDecimals,
      };
    }
    case "multiselect": {
      const min = get("min_items");
      const max = get("max_items");
      if ((min !== undefined && !isWhole(min, 0)) || (max !== undefined && !isWhole(max, 1)))
        return null;
      const minItems = typeof min === "number" ? min : ATTRIBUTE_DEFAULTS.minItems;
      const maxItems = typeof max === "number" ? max : ATTRIBUTE_DEFAULTS.maxItems;
      return minItems > maxItems ? null : { inputType, minItems, maxItems };
    }
    case "date": {
      const min = get("min");
      const max = get("max");
      const date = (value: JsonValue | undefined) =>
        value === undefined || (typeof value === "string" && isIsoCalendarDate(value));
      if (!date(min) || !date(max)) return null;
      if (typeof min === "string" && typeof max === "string" && min > max) return null;
      return {
        inputType,
        ...(typeof min === "string" ? { min } : {}),
        ...(typeof max === "string" ? { max } : {}),
      };
    }
    case "boolean":
    case "select":
      return { inputType };
  }
}

/**
 * One field per assignment of the type at one level, by assignment position then code: `product` for the product's
 * Attributes tab, `variant` for a variant's form (step 6b). A variant-level attribute never shows on the product.
 */
export function attributeFieldSpecs(
  type: AdminProductTypeDetail,
  level: ProductTypeAttributeLevel = "product",
): AttributeFieldSpec[] {
  return type.attributes
    .filter((assignment) => assignment.level === level)
    .sort(
      (left, right) =>
        left.position - right.position || left.attributeCode.localeCompare(right.attributeCode),
    )
    .map((assignment) => {
      const definition = assignment.attribute;
      return {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        inputType: definition.inputType,
        isLocalized: definition.inputType === "text" && definition.isLocalized,
        unit: definition.unit,
        isRequired: assignment.isRequired,
        isInternal: definition.isInternal,
        options: [...definition.options]
          .sort(
            (left, right) => left.position - right.position || left.code.localeCompare(right.code),
          )
          .map((entry) => ({ code: entry.code, label: entry.label })),
        rules: parseRules(definition.inputType, definition.validation),
      };
    });
}

// ----------------------------------------------------------------------------------------------- values

function textOf(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isTextMap(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The form's values from the product's stored `attributes`. */
export function attributeFormFrom(
  specs: readonly AttributeFieldSpec[],
  stored: JsonObject,
  locales: readonly string[],
): AttributeFormValues {
  const values: Record<string, AttributeFieldValue> = {};
  for (const spec of specs) {
    const value = stored[spec.code];
    if (spec.isLocalized) {
      const map: LocalizedText = {};
      if (isTextMap(value)) {
        for (const [locale, text] of Object.entries(value))
          if (typeof text === "string") map[locale] = text;
      }
      values[spec.code] = { kind: "locales", values: localeValuesFrom(map, locales) };
    } else if (spec.inputType === "multiselect") {
      values[spec.code] = {
        kind: "codes",
        codes: Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [],
      };
    } else {
      values[spec.code] = { kind: "text", text: textOf(value) };
    }
  }
  return values;
}

/**
 * A stored value as short text for a table cell (the Variants table): a localized text in the UI language with
 * fallback, a choice by its label, several choices joined, a number with its unit, yes or no as a message; `""` for
 * "not set". A stored choice that is no longer an option shows its code.
 */
export function attributeDisplay(
  spec: AttributeFieldSpec,
  value: JsonValue | undefined,
  uiLocale: string,
  defaultLocale: string,
): string | MessageDescriptor {
  if (value === undefined || value === null) return "";
  const label = (code: string) => {
    const found = spec.options.find((entry) => entry.code === code);
    return found === undefined
      ? code
      : resolveLocalized(found.label, uiLocale, defaultLocale) || code;
  };
  if (typeof value === "boolean") {
    return { key: value ? "products.attributes.yes" : "products.attributes.no" };
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? label(item) : textOf(item))).join(", ");
  }
  if (isTextMap(value)) {
    const map: LocalizedText = {};
    for (const [locale, text] of Object.entries(value))
      if (typeof text === "string") map[locale] = text;
    return resolveLocalized(map, uiLocale, defaultLocale);
  }
  if (typeof value === "number")
    return spec.unit === null ? String(value) : `${value} ${spec.unit}`;
  return spec.inputType === "select" ? label(value) : value;
}

export function setText(
  values: AttributeFormValues,
  code: string,
  text: string,
): AttributeFormValues {
  return { ...values, [code]: { kind: "text", text } };
}

export function setLocale(
  values: AttributeFormValues,
  code: string,
  locale: string,
  text: string,
): AttributeFormValues {
  const current = values[code];
  const map = current?.kind === "locales" ? current.values : {};
  return { ...values, [code]: { kind: "locales", values: { ...map, [locale]: text } } };
}

export function setCodes(
  values: AttributeFormValues,
  code: string,
  codes: string[],
): AttributeFormValues {
  return { ...values, [code]: { kind: "codes", codes: [...codes] } };
}

/** Adds a choice at the end (the stored order of the others stays) or removes it. */
export function toggleCode(
  values: AttributeFormValues,
  code: string,
  choice: string,
): AttributeFormValues {
  const current = values[code];
  const codes = current?.kind === "codes" ? current.codes : [];
  return setCodes(
    values,
    code,
    codes.includes(choice) ? codes.filter((item) => item !== choice) : [...codes, choice],
  );
}

// ---------------------------------------------------------------------------------------------- checks

const NUMBER_TEXT = /^-?\d+(?:\.\d+)?$/;

/** Digits after the decimal point of the number as JSON writes it (core's `countDecimals`). */
function countDecimals(value: number): number {
  const match = /^-?\d+(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (match === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, (match[1]?.length ?? 0) - Number(match[2] ?? 0));
}

function codePoints(text: string): number {
  return [...text].length;
}

const issueOf = (key: string, values?: MessageDescriptor["values"]): MessageDescriptor =>
  values === undefined
    ? { key: `products.attributeIssue.${key}` }
    : { key: `products.attributeIssue.${key}`, values };

function textLengthIssue(
  text: string,
  rules: { minLength: number; maxLength: number },
): MessageDescriptor | null {
  const length = codePoints(text);
  if (length < rules.minLength) return issueOf("tooShort", { min: rules.minLength });
  if (length > rules.maxLength) return issueOf("tooLong", { max: rules.maxLength });
  return null;
}

export interface AttributeCheckOptions {
  defaultLocale: string;
  locales: readonly string[];
  /** `publish` (a write to an active product) also requires the required attributes; a draft may stay incomplete. */
  mode: "draft" | "publish";
}

function isEmpty(value: AttributeFieldValue | undefined): boolean {
  if (value === undefined) return true;
  switch (value.kind) {
    case "text":
      return value.text.trim() === "";
    case "locales":
      return Object.values(value.values).every((text) => text.trim() === "");
    case "codes":
      return value.codes.length === 0;
  }
}

/**
 * Early feedback by the definition's rules, keyed by the API's error path (`attributes.<code>`, `attributes.<code>.<locale>`);
 * the first issue of each field. An empty field is "not set" and only a problem when the attribute is required and the
 * mode is `publish`. The server checks again and decides.
 */
export function validateAttributeForm(
  specs: readonly AttributeFieldSpec[],
  values: AttributeFormValues,
  options: AttributeCheckOptions,
): FormIssues {
  const issues: FormIssues = {};
  for (const spec of specs) {
    const path = `attributes.${spec.code}`;
    const value = values[spec.code];
    if (isEmpty(value)) {
      if (spec.isRequired && options.mode === "publish")
        issues[path] = describeFieldError("required");
      continue;
    }
    const rules = spec.rules;
    if (rules === null || value === undefined) continue;
    if (value.kind === "locales") {
      if (rules.inputType !== "text") continue;
      for (const locale of options.locales) {
        const text = (value.values[locale] ?? "").trim();
        if (text === "") continue;
        const problem = textLengthIssue(text, rules);
        if (problem !== null && issues[`${path}.${locale}`] === undefined)
          issues[`${path}.${locale}`] = problem;
      }
      if ((value.values[options.defaultLocale] ?? "").trim() === "") {
        issues[`${path}.${options.defaultLocale}`] ??= describeFieldError("default_locale_missing");
      }
      continue;
    }
    if (value.kind === "codes") {
      if (rules.inputType !== "multiselect") continue;
      const allowed = new Set(spec.options.map((entry) => entry.code));
      if (value.codes.some((code) => !allowed.has(code)))
        issues[path] = describeFieldError("invalid_value");
      else if (value.codes.length < rules.minItems)
        issues[path] = issueOf("tooFewItems", { min: rules.minItems });
      else if (value.codes.length > rules.maxItems)
        issues[path] = issueOf("tooManyItems", { max: rules.maxItems });
      continue;
    }
    const text = value.text.trim();
    const problem = textIssue(spec, rules, text);
    if (problem !== null) issues[path] = problem;
  }
  return issues;
}

function textIssue(
  spec: AttributeFieldSpec,
  rules: AttributeRules,
  text: string,
): MessageDescriptor | null {
  switch (rules.inputType) {
    case "text":
      return textLengthIssue(text, rules);
    case "number": {
      if (!NUMBER_TEXT.test(text)) return issueOf("notANumber");
      const number = Number(text);
      if (!Number.isFinite(number)) return issueOf("notANumber");
      if (rules.integer && !Number.isInteger(number)) return issueOf("notInteger");
      if (!rules.integer && countDecimals(number) > rules.maxDecimals) {
        return issueOf("tooManyDecimals", { max: rules.maxDecimals });
      }
      if (rules.min !== undefined && number < rules.min)
        return issueOf("belowMin", { min: rules.min });
      if (rules.max !== undefined && number > rules.max)
        return issueOf("aboveMax", { max: rules.max });
      return null;
    }
    case "boolean":
      return text === "true" || text === "false" ? null : describeFieldError("invalid_value");
    case "select":
      return spec.options.some((entry) => entry.code === text)
        ? null
        : describeFieldError("invalid_value");
    case "date":
      if (!isIsoCalendarDate(text)) return issueOf("invalidDate");
      if (rules.min !== undefined && text < rules.min)
        return issueOf("dateBeforeMin", { min: rules.min });
      if (rules.max !== undefined && text > rules.max)
        return issueOf("dateAfterMax", { max: rules.max });
      return null;
    case "multiselect":
      return null;
  }
}

// ------------------------------------------------------------------------------------------------- body

/** The JSON the API stores for one field, or `undefined` for "not set". Only called for checked values. */
function jsonOf(
  spec: AttributeFieldSpec,
  value: AttributeFieldValue,
  locales: readonly string[],
): JsonValue | undefined {
  switch (value.kind) {
    case "locales": {
      const map = localeMapFromValues(value.values, locales);
      return Object.keys(map).length === 0 ? undefined : map;
    }
    case "codes":
      return value.codes.length === 0 ? undefined : [...value.codes];
    case "text": {
      const text = value.text.trim();
      if (text === "") return undefined;
      switch (spec.inputType) {
        case "number":
          return Number(text);
        case "boolean":
          return text === "true";
        default:
          return text;
      }
    }
  }
}

/**
 * `PATCH /admin/products/{id}` of the Attributes tab: `{}` when nothing changed, else `{attributes}` with the WHOLE
 * product-level map (the API has no partial update of attributes). A field the admin did not change keeps the stored
 * JSON as it is (so `12.50` written elsewhere, a locale no longer configured, or an order of choices stays untouched).
 */
export function attributesPatchBody(
  specs: readonly AttributeFieldSpec[],
  initial: AttributeFormValues,
  current: AttributeFormValues,
  stored: JsonObject,
  locales: readonly string[],
): Pick<UpdateAdminProductBody, "attributes"> {
  const next: JsonObject = {};
  const known = new Set(specs.map((spec) => spec.code));
  for (const spec of specs) {
    const before = initial[spec.code];
    const after = current[spec.code];
    if (after === undefined || jsonEqual(before, after)) {
      const kept = stored[spec.code];
      if (kept !== undefined) next[spec.code] = kept;
      continue;
    }
    const json = jsonOf(spec, after, locales);
    if (json !== undefined) next[spec.code] = json;
  }
  for (const [code, value] of Object.entries(stored)) {
    if (!known.has(code)) next[code] = value;
  }
  return diffForPatch({ attributes: stored }, { attributes: next });
}

/** Whether the form differs from the stored values (the unsaved-changes guard). */
export function attributesDirty(
  initial: AttributeFormValues,
  current: AttributeFormValues,
): boolean {
  return !jsonEqual(initial, current);
}

// ------------------------------------------------------------------------------------------ server errors

/** Core's attribute value reasons (`AttributeValueErrorReason`); each has a message in `products.attributeReason.*`. */
export const ATTRIBUTE_REASONS = [
  "values_not_an_object",
  "values_too_large",
  "unknown_attribute",
  "null_value",
  "required",
  "invalid_definition",
  "invalid_type",
  "empty",
  "too_short",
  "too_long",
  "invalid_characters",
  "locale_not_allowed",
  "default_locale_missing",
  "not_integer",
  "too_many_decimals",
  "below_min",
  "above_max",
  "unknown_option",
  "duplicate_option",
  "too_few_items",
  "too_many_items",
  "invalid_date",
] as const;

export function attributeReason(code: string): MessageDescriptor {
  return (ATTRIBUTE_REASONS as readonly string[]).includes(code)
    ? { key: `products.attributeReason.${code}` }
    : describeFieldError(code);
}

/** The field names of the form: the API's paths of every attribute (and locale of a localized one). */
export function attributeFieldNames(
  specs: readonly AttributeFieldSpec[],
  locales: readonly string[],
): string[] {
  return specs.flatMap((spec) =>
    spec.isLocalized
      ? [`attributes.${spec.code}`, ...locales.map((locale) => `attributes.${spec.code}.${locale}`)]
      : [`attributes.${spec.code}`],
  );
}

/**
 * A refused attribute PATCH on the form: `400` errors at `attributes.<code>[.<locale>]` go on that attribute's field with
 * the attribute reason's message; any other path (the whole map, an attribute the form does not show, another field) and
 * a problem without field errors go to the summary. Nothing is dropped.
 */
export function attributeErrorsFromProblem(
  problem: ProblemDetails,
  specs: readonly AttributeFieldSpec[],
  locales: readonly string[],
): FormErrors<string> {
  const names = new Set(attributeFieldNames(specs, locales));
  const fields: Partial<Record<string, MessageDescriptor>> = {};
  const other: MessageDescriptor[] = [];
  if (problem.errors === undefined || problem.errors.length === 0) {
    return { fields, other: [describeProblem(problem.status, problem)] };
  }
  for (const error of problem.errors) {
    const isAttribute = error.path === "attributes" || error.path.startsWith("attributes.");
    const descriptor = isAttribute ? attributeReason(error.code) : describeFieldError(error.code);
    if (names.has(error.path)) fields[error.path] ??= descriptor;
    else other.push(descriptor);
  }
  return { fields, other };
}
