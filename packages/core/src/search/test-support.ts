import type { AttributeDefinition, AttributeInputType, AttributeLevel } from "../catalog/index.js";
import type { SearchAttributeAssignment } from "./index.js";

/** A catalog attribute definition with the flags of a plain public attribute; override what a test needs. */
export function attribute(
  code: string,
  inputType: AttributeInputType,
  overrides: Partial<AttributeDefinition> = {},
): AttributeDefinition {
  return {
    code,
    inputType,
    isLocalized: false,
    unit: null,
    validation: {},
    isFilterable: false,
    isSearchable: false,
    isVisibleOnStorefront: true,
    isComparable: false,
    isSortable: false,
    isInternal: false,
    options: [],
    ...overrides,
  };
}

export function assignment(
  definition: AttributeDefinition,
  level: AttributeLevel = "product",
): SearchAttributeAssignment {
  return { definition, level };
}

export function selectAttribute(
  code: string,
  options: readonly string[],
  overrides: Partial<AttributeDefinition> = {},
): AttributeDefinition {
  return attribute(code, "select", {
    options: options.map((option) => ({ code: option, label: { uk: `${option} uk`, en: option } })),
    ...overrides,
  });
}
