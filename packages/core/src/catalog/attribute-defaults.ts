import { codePointLength } from "./i18n.js";
import { TEXT_LIMITS } from "./limits.js";
import type { AttributeInputType } from "./types.js";

/** Only free text can be translated; every other input type holds a language-neutral value. */
export function defaultIsLocalized(inputType: AttributeInputType): boolean {
  return inputType === "text";
}

/** The attribute fields a client may send when creating or changing a definition's flags. */
export interface AttributeDefinitionInput {
  readonly inputType: AttributeInputType;
  readonly isLocalized?: boolean;
  readonly unit?: string | null;
  readonly isFilterable?: boolean;
  readonly isSearchable?: boolean;
  readonly isVisibleOnStorefront?: boolean;
  readonly isComparable?: boolean;
  readonly isSortable?: boolean;
  readonly isInternal?: boolean;
}

export interface NormalizedAttributeDefinition {
  readonly inputType: AttributeInputType;
  readonly isLocalized: boolean;
  readonly unit: string | null;
  readonly isFilterable: boolean;
  readonly isSearchable: boolean;
  readonly isVisibleOnStorefront: boolean;
  readonly isComparable: boolean;
  readonly isSortable: boolean;
  readonly isInternal: boolean;
}

export type AttributeDefinitionField =
  | "unit"
  | "isLocalized"
  | "isFilterable"
  | "isSearchable"
  | "isVisibleOnStorefront"
  | "isComparable"
  | "isSortable";

export type AttributeDefinitionErrorReason =
  | "unit_empty"
  | "unit_too_long"
  | "unit_requires_number"
  | "localized_requires_text"
  | "sortable_requires_number_or_date"
  | "filterable_requires_selectable_type"
  | "internal_cannot_be_public";

export interface AttributeDefinitionError {
  readonly field: AttributeDefinitionField;
  readonly reason: AttributeDefinitionErrorReason;
}

export type NormalizeAttributeDefinitionResult =
  | { readonly ok: true; readonly value: NormalizedAttributeDefinition }
  | { readonly ok: false; readonly errors: readonly AttributeDefinitionError[] };

const FILTERABLE_TYPES: readonly AttributeInputType[] = [
  "select",
  "multiselect",
  "boolean",
  "number",
];
const SORTABLE_TYPES: readonly AttributeInputType[] = ["number", "date"];

/**
 * Applies the defaults of ADR 0006 section 2 (`attribute` row) and rejects the combinations the
 * database CHECK constraints forbid, so the API can answer 400 with per-field errors before the
 * database answers with a constraint violation.
 *
 * An internal attribute that does not say whether it is visible defaults to hidden: the database
 * default (`true`) would otherwise make the most common internal input invalid.
 */
export function normalizeAttributeDefinitionInput(
  input: AttributeDefinitionInput,
): NormalizeAttributeDefinitionResult {
  const { inputType } = input;
  const isInternal = input.isInternal ?? false;
  const value: NormalizedAttributeDefinition = {
    inputType,
    isLocalized: input.isLocalized ?? defaultIsLocalized(inputType),
    unit: input.unit ?? null,
    isFilterable: input.isFilterable ?? false,
    isSearchable: input.isSearchable ?? false,
    isVisibleOnStorefront: input.isVisibleOnStorefront ?? !isInternal,
    isComparable: input.isComparable ?? false,
    isSortable: input.isSortable ?? false,
    isInternal,
  };

  const errors: AttributeDefinitionError[] = [];
  if (value.unit !== null) {
    if (inputType !== "number") {
      errors.push({ field: "unit", reason: "unit_requires_number" });
    }
    if (value.unit.trim().length === 0) {
      errors.push({ field: "unit", reason: "unit_empty" });
    } else if (codePointLength(value.unit) > TEXT_LIMITS.unit) {
      errors.push({ field: "unit", reason: "unit_too_long" });
    }
  }
  if (value.isLocalized && inputType !== "text") {
    errors.push({ field: "isLocalized", reason: "localized_requires_text" });
  }
  if (value.isSortable && !SORTABLE_TYPES.includes(inputType)) {
    errors.push({ field: "isSortable", reason: "sortable_requires_number_or_date" });
  }
  if (value.isFilterable && !FILTERABLE_TYPES.includes(inputType)) {
    errors.push({ field: "isFilterable", reason: "filterable_requires_selectable_type" });
  }
  if (isInternal) {
    const publicFlags = [
      ["isVisibleOnStorefront", value.isVisibleOnStorefront],
      ["isFilterable", value.isFilterable],
      ["isSearchable", value.isSearchable],
      ["isComparable", value.isComparable],
      ["isSortable", value.isSortable],
    ] as const;
    for (const [field, enabled] of publicFlags) {
      if (enabled) {
        errors.push({ field, reason: "internal_cannot_be_public" });
      }
    }
  }
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}
