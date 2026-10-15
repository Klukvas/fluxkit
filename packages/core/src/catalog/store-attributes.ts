/**
 * Public (store API) view of attributes, ADR 0006 section 10. Allowlist: an attribute is exposed
 * only if its definition is `isVisibleOnStorefront && !isInternal`; unknown keys, hidden and
 * internal attributes are dropped. This is the one place that decides, so the API must not
 * serialize attribute values any other way.
 */
import { resolveText } from "./i18n.js";
import type {
  AttributeDefinition,
  AttributeOptionDefinition,
  AttributeValidation,
  AttributeValues,
  I18nText,
} from "./types.js";

export interface StoreLocale {
  readonly locale: string;
  readonly defaultLocale: string;
}

export interface PublicOptionValue {
  readonly code: string;
  readonly label: string;
}

export interface PublicNumberValue {
  readonly value: number;
  readonly unit: string | null;
}

export type PublicAttributeValue =
  string | boolean | PublicNumberValue | PublicOptionValue | readonly PublicOptionValue[];

export function isPublicAttribute(definition: AttributeDefinition): boolean {
  return definition.isVisibleOnStorefront && !definition.isInternal;
}

function isI18nText(value: unknown): value is I18nText {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function publicOption(option: AttributeOptionDefinition, context: StoreLocale): PublicOptionValue {
  // A missing label falls back to the code so the storefront never renders an empty string.
  return {
    code: option.code,
    label: resolveText(option.label, context.locale, context.defaultLocale) ?? option.code,
  };
}

function resolveValue(
  definition: AttributeDefinition,
  value: unknown,
  context: StoreLocale,
): PublicAttributeValue | undefined {
  switch (definition.inputType) {
    case "text":
      if (definition.isLocalized) {
        return isI18nText(value)
          ? resolveText(value, context.locale, context.defaultLocale)
          : undefined;
      }
      return typeof value === "string" ? value : undefined;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { value, unit: definition.unit }
        : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "date":
      return typeof value === "string" ? value : undefined;
    case "select": {
      const option = definition.options.find((candidate) => candidate.code === value);
      return option === undefined ? undefined : publicOption(option, context);
    }
    case "multiselect": {
      if (!Array.isArray(value)) {
        return undefined;
      }
      const chosen: unknown[] = value;
      const options = definition.options.filter((candidate) => chosen.includes(candidate.code));
      // Array.prototype.sort is stable, so options without a position keep the stored order.
      const ordered = options.sort(
        (left, right) =>
          (left.position ?? Number.POSITIVE_INFINITY) -
            (right.position ?? Number.POSITIVE_INFINITY) ||
          chosen.indexOf(left.code) - chosen.indexOf(right.code),
      );
      return ordered.length === 0
        ? undefined
        : ordered.map((option) => publicOption(option, context));
    }
  }
}

/**
 * The attribute values safe to show on the storefront, keyed by attribute code in definition order.
 * Stored values that do not fit their definition (a removed option, a wrong type) are left out
 * rather than passed through.
 */
export function selectPublicAttributes(
  definitions: readonly AttributeDefinition[],
  values: AttributeValues,
  context: StoreLocale,
): Readonly<Record<string, PublicAttributeValue>> {
  const result: Record<string, PublicAttributeValue> = {};
  for (const definition of definitions) {
    if (!isPublicAttribute(definition) || !Object.hasOwn(values, definition.code)) {
      continue;
    }
    const resolved = resolveValue(definition, values[definition.code], context);
    if (resolved !== undefined) {
      result[definition.code] = resolved;
    }
  }
  return result;
}

export interface PublicAttributeOption {
  readonly code: string;
  readonly label?: I18nText;
  readonly position?: number;
}

/** Attribute definition as the store API lists it: only the three public flags, never `isInternal`. */
export interface PublicAttributeDefinition {
  readonly code: string;
  readonly inputType: AttributeDefinition["inputType"];
  readonly isLocalized: boolean;
  readonly unit: string | null;
  readonly validation: AttributeValidation;
  readonly isFilterable: boolean;
  readonly isComparable: boolean;
  readonly isSortable: boolean;
  readonly options: readonly PublicAttributeOption[];
}

export function publicAttributeDefinitions(
  definitions: readonly AttributeDefinition[],
): readonly PublicAttributeDefinition[] {
  return definitions.filter(isPublicAttribute).map((definition) => ({
    code: definition.code,
    inputType: definition.inputType,
    isLocalized: definition.isLocalized,
    unit: definition.unit,
    validation: definition.validation,
    isFilterable: definition.isFilterable,
    isComparable: definition.isComparable,
    isSortable: definition.isSortable,
    options: definition.options.map((option) => ({
      code: option.code,
      ...(option.label !== undefined && { label: option.label }),
      ...(option.position !== undefined && { position: option.position }),
    })),
  }));
}
