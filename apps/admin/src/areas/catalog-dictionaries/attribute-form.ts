import type {
  AdminAttribute,
  AttributeInputType,
  CreateAdminAttributeBody,
  JsonObject,
  UpdateAdminAttributeBody,
} from "@fluxkit/api-client";
import { diffForPatch } from "../../lib/diff-for-patch";
import { describeFieldError, type MessageDescriptor } from "../../lib/problem-messages";
import { CODE_PATTERN, type FormIssues } from "./form-rules";
import {
  hasDefaultLocale,
  localeMapFromValues,
  localeValuesFrom,
  optionalLocaleMap,
  type LocaleValues,
} from "./locale-text";

/**
 * The attribute form as a pure model (tests first): what the form holds, which controls the input type allows, how
 * typed `validation` fields become the API's JSON, and how the request bodies are built. The server stays the authority;
 * these rules (copied from core's `normalizeAttributeDefinitionInput`) only give early feedback and keep the admin from
 * picking a combination the API refuses.
 */

export const ATTRIBUTE_INPUT_TYPES = [
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
  "date",
] as const satisfies readonly AttributeInputType[];

/** The six behaviour flags, by the API's field names (AGENTS.md 2.3). */
export const ATTRIBUTE_FLAGS = [
  "isFilterable",
  "isSearchable",
  "isVisibleOnStorefront",
  "isComparable",
  "isSortable",
  "isInternal",
] as const;
export type AttributeFlag = (typeof ATTRIBUTE_FLAGS)[number];

/** `TEXT_LIMITS.unit` of core (compared with core in the spec; core is not imported into the bundle). */
export const UNIT_MAX_LENGTH = 16;

const FILTERABLE_TYPES: readonly AttributeInputType[] = [
  "select",
  "multiselect",
  "boolean",
  "number",
];
const SORTABLE_TYPES: readonly AttributeInputType[] = ["number", "date"];

export type ValidationFieldKind = "integer" | "number" | "date" | "boolean";

export interface ValidationFieldSpec {
  /** The key in the API's `validation` object (snake_case). */
  key: string;
  kind: ValidationFieldKind;
  min?: number;
  max?: number;
  /** The key of the other end of a range this key must not be above (checked on the upper field). */
  notBelow?: string;
}

/** The `validation` keys of each input type (core `attribute-values.ts`); the API rejects unknown keys. */
export const VALIDATION_FIELDS: Record<AttributeInputType, readonly ValidationFieldSpec[]> = {
  text: [
    { key: "min_length", kind: "integer", min: 0 },
    { key: "max_length", kind: "integer", min: 1, notBelow: "min_length" },
  ],
  number: [
    { key: "min", kind: "number" },
    { key: "max", kind: "number", notBelow: "min" },
    { key: "integer", kind: "boolean" },
    { key: "max_decimals", kind: "integer", min: 0, max: 20 },
  ],
  boolean: [],
  select: [],
  multiselect: [
    { key: "min_items", kind: "integer", min: 0 },
    { key: "max_items", kind: "integer", min: 1, notBelow: "min_items" },
  ],
  date: [
    { key: "min", kind: "date" },
    { key: "max", kind: "date", notBelow: "min" },
  ],
};

/** Typed validation fields as text, by the API's key (`"true"` for a checked boolean). */
export type ValidationValues = Record<string, string>;

export interface AttributeFormValues {
  /** Only used on create: a code never changes. */
  code: string;
  name: LocaleValues;
  description: LocaleValues;
  inputType: AttributeInputType;
  isLocalized: boolean;
  unit: string;
  validation: ValidationValues;
  flags: Record<AttributeFlag, boolean>;
}

export function emptyAttributeForm(locales: readonly string[]): AttributeFormValues {
  return {
    code: "",
    name: localeValuesFrom(null, locales),
    description: localeValuesFrom(null, locales),
    inputType: "text",
    isLocalized: true,
    unit: "",
    validation: {},
    flags: {
      isFilterable: false,
      isSearchable: false,
      isVisibleOnStorefront: true,
      isComparable: false,
      isSortable: false,
      isInternal: false,
    },
  };
}

export function validationFromJson(
  inputType: AttributeInputType,
  validation: JsonObject,
): ValidationValues {
  const values: ValidationValues = {};
  for (const field of VALIDATION_FIELDS[inputType]) {
    const value = validation[field.key];
    if (value === undefined || value === null) continue;
    values[field.key] = String(value);
  }
  return values;
}

export function attributeFormFrom(
  attribute: AdminAttribute,
  locales: readonly string[],
): AttributeFormValues {
  return {
    code: attribute.code,
    name: localeValuesFrom(attribute.name, locales),
    description: localeValuesFrom(attribute.description, locales),
    inputType: attribute.inputType,
    isLocalized: attribute.isLocalized,
    unit: attribute.unit ?? "",
    validation: validationFromJson(attribute.inputType, attribute.validation),
    flags: {
      isFilterable: attribute.isFilterable,
      isSearchable: attribute.isSearchable,
      isVisibleOnStorefront: attribute.isVisibleOnStorefront,
      isComparable: attribute.isComparable,
      isSortable: attribute.isSortable,
      isInternal: attribute.isInternal,
    },
  };
}

// --------------------------------------------------------------- what a type allows

export function unitAllowed(inputType: AttributeInputType): boolean {
  return inputType === "number";
}

export function localizedAllowed(inputType: AttributeInputType): boolean {
  return inputType === "text";
}

function flagAllowedForType(inputType: AttributeInputType, flag: AttributeFlag): boolean {
  if (flag === "isFilterable") return FILTERABLE_TYPES.includes(inputType);
  if (flag === "isSortable") return SORTABLE_TYPES.includes(inputType);
  return true;
}

/** True when the checkbox must be disabled: the type cannot have the flag, or an internal attribute cannot be public. */
export function flagDisabled(values: AttributeFormValues, flag: AttributeFlag): boolean {
  if (!flagAllowedForType(values.inputType, flag)) return true;
  return values.flags.isInternal && flag !== "isInternal";
}

/** Picks another input type (create only): what belongs to the old type is reset, only text is localized. */
export function changeInputType(
  values: AttributeFormValues,
  inputType: AttributeInputType,
): AttributeFormValues {
  const flags = { ...values.flags };
  for (const flag of ATTRIBUTE_FLAGS) {
    if (!flagAllowedForType(inputType, flag)) flags[flag] = false;
  }
  return {
    ...values,
    inputType,
    isLocalized: localizedAllowed(inputType),
    unit: unitAllowed(inputType) ? values.unit : "",
    validation: {},
    flags,
  };
}

/**
 * Sets one flag. A disabled flag is ignored. Turning `isInternal` on turns the public flags off (the API refuses an
 * internal attribute that is visible, filterable, searchable, comparable or sortable); turning it off leaves them off.
 */
export function applyFlag(
  values: AttributeFormValues,
  flag: AttributeFlag,
  checked: boolean,
): AttributeFormValues {
  if (flagDisabled(values, flag)) return values;
  const flags = { ...values.flags, [flag]: checked };
  if (flag === "isInternal" && checked) {
    for (const other of ATTRIBUTE_FLAGS) if (other !== "isInternal") flags[other] = false;
  }
  return { ...values, flags };
}

// ------------------------------------------------------------------ validation JSON

const INTEGER = /^\d{1,15}$/;
const NUMBER = /^-?\d{1,15}(\.\d{1,15})?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(text: string): boolean {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export type ValidationResult =
  { ok: true; value: JsonObject } | { ok: false; errors: Record<string, MessageDescriptor> };

/**
 * The typed fields as the API's `validation` JSON: an empty field is left out (the API applies its default), a false
 * 'integer' too. A bad field is an error on that key; a minimum above the maximum is an error on the maximum.
 */
export function validationToJson(
  inputType: AttributeInputType,
  values: Readonly<Record<string, string | undefined>>,
): ValidationResult {
  const value: JsonObject = {};
  const bounds: Record<string, number | string> = {};
  const errors: Record<string, MessageDescriptor> = {};
  for (const field of VALIDATION_FIELDS[inputType]) {
    const text = values[field.key] ?? "";
    if (field.kind === "boolean") {
      if (text === "true") value[field.key] = true;
      continue;
    }
    if (text === "") continue;
    if (field.kind === "date") {
      if (!isCalendarDate(text)) errors[field.key] = { key: "dict.validation.invalidDate" };
      else {
        value[field.key] = text;
        bounds[field.key] = text;
      }
      continue;
    }
    if (!(field.kind === "integer" ? INTEGER : NUMBER).test(text)) {
      errors[field.key] = {
        key:
          field.kind === "integer"
            ? "dict.validation.invalidInteger"
            : "dict.validation.invalidNumber",
      };
      continue;
    }
    const number = Number(text);
    if (
      (field.min !== undefined && number < field.min) ||
      (field.max !== undefined && number > field.max)
    ) {
      errors[field.key] = {
        key: "dict.validation.outOfRange",
        values: { min: field.min ?? "", max: field.max ?? "" },
      };
      continue;
    }
    value[field.key] = number;
    bounds[field.key] = number;
  }
  for (const field of VALIDATION_FIELDS[inputType]) {
    if (field.notBelow === undefined || errors[field.key] !== undefined) continue;
    const high = bounds[field.key];
    const low = bounds[field.notBelow];
    if (high !== undefined && low !== undefined && low > high) {
      errors[field.key] = { key: "dict.validation.rangeOrder" };
    }
  }
  return Object.keys(errors).length === 0 ? { ok: true, value } : { ok: false, errors };
}

// ------------------------------------------------------------------- form checks

export interface AttributeFormOptions {
  defaultLocale: string;
  locales: readonly string[];
}

/**
 * Checks the browser can make before sending (early feedback; the server decides): the code on create, the name in the
 * default locale, the unit length, the typed validation. Keys are the API's `errors[].path` (`name.uk`,
 * `validation.min_length`), so a server answer and a local one land on the same field.
 */
export function validateAttributeForm(
  values: AttributeFormValues,
  mode: "create" | "edit",
  options: AttributeFormOptions,
): FormIssues {
  const issues: FormIssues = {};
  if (mode === "create" && !CODE_PATTERN.test(values.code)) {
    issues["code"] = { key: "dict.error.codeFormat" };
  }
  if (!hasDefaultLocale(values.name, options.defaultLocale)) {
    issues[`name.${options.defaultLocale}`] = describeFieldError("default_locale_missing");
  }
  if (Array.from(values.unit.trim()).length > UNIT_MAX_LENGTH) {
    issues["unit"] = { key: "dict.error.unitTooLong", values: { max: UNIT_MAX_LENGTH } };
  }
  const validation = validationToJson(values.inputType, values.validation);
  if (!validation.ok) {
    for (const [key, descriptor] of Object.entries(validation.errors)) {
      issues[`validation.${key}`] = descriptor;
    }
  }
  return issues;
}

// ------------------------------------------------------------------- request bodies

function validationJsonOf(values: AttributeFormValues): JsonObject {
  const result = validationToJson(values.inputType, values.validation);
  if (!result.ok)
    throw new Error("The validation fields were not checked before building the body.");
  return result.value;
}

/** The `POST /admin/attributes` body. Call after `validateAttributeForm` returned no issue. */
export function attributeCreateBody(
  values: AttributeFormValues,
  locales: readonly string[],
): CreateAdminAttributeBody {
  const description = optionalLocaleMap(values.description, locales);
  const unit = values.unit.trim();
  return {
    code: values.code,
    name: localeMapFromValues(values.name, locales),
    inputType: values.inputType,
    isLocalized: values.isLocalized,
    validation: validationJsonOf(values),
    ...(description === undefined ? {} : { description }),
    ...(unit === "" ? {} : { unit }),
    ...values.flags,
  };
}

/** The patchable fields as the API holds them; `inputType`, `isLocalized` and `code` never change, so they are not here. */
function patchableFields(values: AttributeFormValues, locales: readonly string[]) {
  return {
    name: localeMapFromValues(values.name, locales),
    description: optionalLocaleMap(values.description, locales) ?? null,
    unit: values.unit.trim() === "" ? null : values.unit.trim(),
    validation: validationJsonOf(values),
    ...values.flags,
  };
}

/** The `PATCH /admin/attributes/{id}` body: only the fields that differ from `initial`. Call after validation. */
export function attributePatchBody(
  initial: AttributeFormValues,
  current: AttributeFormValues,
  locales: readonly string[],
): UpdateAdminAttributeBody {
  return diffForPatch(patchableFields(initial, locales), patchableFields(current, locales));
}
