import { describe, expect, it } from "vitest";
import {
  defaultIsLocalized,
  normalizeAttributeDefinitionInput,
  type AttributeDefinitionInput,
} from "./attribute-defaults.js";
import { deepFreeze } from "./test-support.js";
import type { AttributeInputType } from "./types.js";

const INPUT_TYPES: readonly AttributeInputType[] = [
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
  "date",
];

function errorsOf(input: AttributeDefinitionInput): readonly { field: string; reason: string }[] {
  const result = normalizeAttributeDefinitionInput(input);
  return result.ok ? [] : result.errors;
}

describe("defaultIsLocalized", () => {
  it.each(INPUT_TYPES)("is %s -> only true for text", (inputType) => {
    expect(defaultIsLocalized(inputType)).toBe(inputType === "text");
  });
});

describe("normalizeAttributeDefinitionInput defaults", () => {
  it("localizes text by default and applies the flag defaults", () => {
    expect(normalizeAttributeDefinitionInput({ inputType: "text" })).toEqual({
      ok: true,
      value: {
        inputType: "text",
        isLocalized: true,
        unit: null,
        isFilterable: false,
        isSearchable: false,
        isVisibleOnStorefront: true,
        isComparable: false,
        isSortable: false,
        isInternal: false,
      },
    });
  });

  it("does not localize other types by default", () => {
    const result = normalizeAttributeDefinitionInput({ inputType: "number", unit: "mm" });
    expect(result.ok && result.value.isLocalized).toBe(false);
    expect(result.ok && result.value.unit).toBe("mm");
  });

  it("allows an explicit non-localized text attribute", () => {
    const result = normalizeAttributeDefinitionInput({ inputType: "text", isLocalized: false });
    expect(result.ok && result.value.isLocalized).toBe(false);
  });

  it("hides an internal attribute from the storefront by default", () => {
    const result = normalizeAttributeDefinitionInput({ inputType: "text", isInternal: true });
    expect(result.ok && result.value.isVisibleOnStorefront).toBe(false);
    expect(result.ok && result.value.isInternal).toBe(true);
  });

  it("accepts every allowed flag combination per type", () => {
    const valid: readonly AttributeDefinitionInput[] = [
      { inputType: "number", isFilterable: true, isSortable: true, isComparable: true, unit: "g" },
      { inputType: "date", isSortable: true },
      { inputType: "select", isFilterable: true, isSearchable: true },
      { inputType: "multiselect", isFilterable: true },
      { inputType: "boolean", isFilterable: true },
      { inputType: "text", isSearchable: true, isComparable: true },
      { inputType: "text", isInternal: true, isVisibleOnStorefront: false },
    ];
    for (const input of valid) {
      expect(normalizeAttributeDefinitionInput(input).ok).toBe(true);
    }
  });
});

describe("normalizeAttributeDefinitionInput errors", () => {
  it.each(["text", "boolean", "select", "multiselect", "date"] as const)(
    "rejects a unit on a %s attribute",
    (inputType) => {
      expect(errorsOf({ inputType, unit: "kg" })).toContainEqual({
        field: "unit",
        reason: "unit_requires_number",
      });
    },
  );

  it("treats a null unit as no unit", () => {
    expect(errorsOf({ inputType: "text", unit: null })).toEqual([]);
  });

  it("rejects an empty or overlong unit", () => {
    expect(errorsOf({ inputType: "number", unit: "" })).toContainEqual({
      field: "unit",
      reason: "unit_empty",
    });
    expect(errorsOf({ inputType: "number", unit: "x".repeat(17) })).toContainEqual({
      field: "unit",
      reason: "unit_too_long",
    });
    expect(errorsOf({ inputType: "number", unit: "x".repeat(16) })).toEqual([]);
  });

  it.each(["number", "boolean", "select", "multiselect", "date"] as const)(
    "rejects isLocalized on a %s attribute",
    (inputType) => {
      expect(errorsOf({ inputType, isLocalized: true })).toContainEqual({
        field: "isLocalized",
        reason: "localized_requires_text",
      });
    },
  );

  it.each(["text", "boolean", "select", "multiselect"] as const)(
    "rejects sortable on a %s attribute",
    (inputType) => {
      expect(errorsOf({ inputType, isSortable: true })).toContainEqual({
        field: "isSortable",
        reason: "sortable_requires_number_or_date",
      });
    },
  );

  it.each(["text", "date"] as const)("rejects filterable on a %s attribute", (inputType) => {
    expect(errorsOf({ inputType, isFilterable: true })).toContainEqual({
      field: "isFilterable",
      reason: "filterable_requires_selectable_type",
    });
  });

  it.each([
    "isVisibleOnStorefront",
    "isFilterable",
    "isSearchable",
    "isComparable",
    "isSortable",
  ] as const)("rejects an internal attribute with %s", (flag) => {
    expect(errorsOf({ inputType: "number", isInternal: true, [flag]: true })).toContainEqual({
      field: flag,
      reason: "internal_cannot_be_public",
    });
  });

  it("reports every problem at once", () => {
    const errors = errorsOf({
      inputType: "text",
      unit: "kg",
      isSortable: true,
      isFilterable: true,
    });
    expect(errors.map((error) => error.field).sort()).toEqual([
      "isFilterable",
      "isSortable",
      "unit",
    ]);
  });
});

describe("normalizeAttributeDefinitionInput purity", () => {
  it("does not mutate frozen input and returns equal results", () => {
    const input = deepFreeze({ inputType: "number" as const, unit: "g", isFilterable: true });
    expect(normalizeAttributeDefinitionInput(input)).toEqual(
      normalizeAttributeDefinitionInput(input),
    );
  });
});
