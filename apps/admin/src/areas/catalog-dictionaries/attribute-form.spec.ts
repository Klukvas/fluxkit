import type { AdminAttribute, JsonObject } from "@fluxkit/api-client";
import { CATALOG_LIMITS, TEXT_LIMITS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_FLAGS,
  ATTRIBUTE_INPUT_TYPES,
  UNIT_MAX_LENGTH,
  applyFlag,
  attributeCreateBody,
  attributeFormFrom,
  attributePatchBody,
  changeInputType,
  emptyAttributeForm,
  flagDisabled,
  validateAttributeForm,
  validationFromJson,
  validationToJson,
  type AttributeFormValues,
} from "./attribute-form";

const locales = ["uk", "en"];
const options = { defaultLocale: "uk", locales };

function attribute(overrides: Partial<AdminAttribute> = {}): AdminAttribute {
  return {
    id: "a1",
    code: "length",
    name: { uk: "Довжина", en: "Length" },
    description: null,
    inputType: "number",
    isLocalized: false,
    unit: "cm",
    validation: { min: 1, max: 10, integer: true },
    isFilterable: true,
    isSearchable: false,
    isVisibleOnStorefront: true,
    isComparable: false,
    isSortable: true,
    isInternal: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function filled(overrides: Partial<AttributeFormValues> = {}): AttributeFormValues {
  return {
    ...emptyAttributeForm(locales),
    code: "material",
    name: { uk: "Матеріал", en: "" },
    ...overrides,
  };
}

describe("limits copied from the API", () => {
  it("match core", () => {
    expect(UNIT_MAX_LENGTH).toBe(TEXT_LIMITS.unit);
    expect(CATALOG_LIMITS.maxOptionsPerAttribute).toBe(500);
  });

  it("lists exactly the six flags the API names", () => {
    expect([...ATTRIBUTE_FLAGS]).toEqual([
      "isFilterable",
      "isSearchable",
      "isVisibleOnStorefront",
      "isComparable",
      "isSortable",
      "isInternal",
    ]);
    expect([...ATTRIBUTE_INPUT_TYPES]).toEqual([
      "text",
      "number",
      "boolean",
      "select",
      "multiselect",
      "date",
    ]);
  });
});

describe("emptyAttributeForm", () => {
  it("starts as the API's defaults: a localized text, visible on the storefront, no other flag", () => {
    const form = emptyAttributeForm(locales);
    expect(form.inputType).toBe("text");
    expect(form.isLocalized).toBe(true);
    expect(form.flags).toEqual({
      isFilterable: false,
      isSearchable: false,
      isVisibleOnStorefront: true,
      isComparable: false,
      isSortable: false,
      isInternal: false,
    });
    expect(form.name).toEqual({ uk: "", en: "" });
  });
});

describe("changeInputType", () => {
  it("resets what belongs to the old type: validation, unit, and the flags the new type cannot have", () => {
    const form = filled({
      inputType: "number",
      unit: "cm",
      validation: { min: "1" },
      flags: { ...emptyAttributeForm(locales).flags, isFilterable: true, isSortable: true },
    });
    const next = changeInputType(form, "text");
    expect(next.inputType).toBe("text");
    expect(next.unit).toBe("");
    expect(next.validation).toEqual({});
    expect(next.flags.isFilterable).toBe(false);
    expect(next.flags.isSortable).toBe(false);
    expect(next.isLocalized).toBe(true);
  });

  it("makes only text localized", () => {
    expect(changeInputType(filled(), "select").isLocalized).toBe(false);
    expect(changeInputType(changeInputType(filled(), "date"), "text").isLocalized).toBe(true);
  });

  it("keeps the flags the new type can have", () => {
    const form = filled({
      inputType: "number",
      flags: { ...emptyAttributeForm(locales).flags, isFilterable: true, isSortable: true },
    });
    const next = changeInputType(form, "select");
    expect(next.flags.isFilterable).toBe(true);
    expect(next.flags.isSortable).toBe(false);
  });
});

describe("flags", () => {
  it("disables filterable for text and date, and sortable for everything but number and date", () => {
    expect(flagDisabled(filled({ inputType: "text" }), "isFilterable")).toBe(true);
    expect(flagDisabled(filled({ inputType: "date" }), "isFilterable")).toBe(true);
    for (const type of ["select", "multiselect", "boolean", "number"] as const) {
      expect(flagDisabled(filled({ inputType: type }), "isFilterable"), type).toBe(false);
    }
    expect(flagDisabled(filled({ inputType: "number" }), "isSortable")).toBe(false);
    expect(flagDisabled(filled({ inputType: "date" }), "isSortable")).toBe(false);
    expect(flagDisabled(filled({ inputType: "text" }), "isSortable")).toBe(true);
    expect(flagDisabled(filled({ inputType: "select" }), "isSortable")).toBe(true);
  });

  it("an internal attribute cannot have a public flag: they are turned off and disabled, internal stays enabled", () => {
    const form = filled({
      inputType: "number",
      flags: {
        isFilterable: true,
        isSearchable: true,
        isVisibleOnStorefront: true,
        isComparable: true,
        isSortable: true,
        isInternal: false,
      },
    });
    const internal = applyFlag(form, "isInternal", true);
    expect(internal.flags).toEqual({
      isFilterable: false,
      isSearchable: false,
      isVisibleOnStorefront: false,
      isComparable: false,
      isSortable: false,
      isInternal: true,
    });
    for (const flag of ATTRIBUTE_FLAGS) {
      expect(flagDisabled(internal, flag), flag).toBe(flag !== "isInternal");
    }
    // Turning it off again does not switch the public flags back on by itself.
    expect(applyFlag(internal, "isInternal", false).flags.isVisibleOnStorefront).toBe(false);
  });

  it("applyFlag ignores a flag that is disabled", () => {
    const form = filled({ inputType: "text" });
    expect(applyFlag(form, "isSortable", true).flags.isSortable).toBe(false);
    const internal = applyFlag(form, "isInternal", true);
    expect(applyFlag(internal, "isSearchable", true).flags.isSearchable).toBe(false);
  });

  it("sets an ordinary flag", () => {
    expect(applyFlag(filled(), "isSearchable", true).flags.isSearchable).toBe(true);
  });
});

describe("validationFromJson and validationToJson", () => {
  it("reads and writes the keys of each input type, with the API's snake_case names", () => {
    const text: JsonObject = { min_length: 2, max_length: 40 };
    expect(validationToJson("text", validationFromJson("text", text))).toEqual({
      ok: true,
      value: text,
    });
    const number: JsonObject = { min: -1.5, max: 10, integer: true, max_decimals: 2 };
    expect(validationToJson("number", validationFromJson("number", number))).toEqual({
      ok: true,
      value: number,
    });
    const multi: JsonObject = { min_items: 0, max_items: 3 };
    expect(validationToJson("multiselect", validationFromJson("multiselect", multi))).toEqual({
      ok: true,
      value: multi,
    });
    const date: JsonObject = { min: "2020-01-01", max: "2030-12-31" };
    expect(validationToJson("date", validationFromJson("date", date))).toEqual({
      ok: true,
      value: date,
    });
  });

  it("has no keys for boolean and select, and drops keys that do not belong to the type", () => {
    expect(validationToJson("boolean", { min: "1" })).toEqual({ ok: true, value: {} });
    expect(validationToJson("select", {})).toEqual({ ok: true, value: {} });
    expect(validationFromJson("text", { min: 1, min_length: 3 })).toEqual({ min_length: "3" });
  });

  it("omits an empty field and a false 'integer'", () => {
    expect(validationToJson("number", { min: "", max: "", integer: "false" })).toEqual({
      ok: true,
      value: {},
    });
  });

  it("refuses text that is not a number, not a whole number, or not a date, key by key", () => {
    const bad = validationToJson("number", { min: "abc", max_decimals: "1.5" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual(["max_decimals", "min"]);
      expect(bad.errors["min"]?.key).toBe("dict.validation.invalidNumber");
      expect(bad.errors["max_decimals"]?.key).toBe("dict.validation.invalidInteger");
    }
    const date = validationToJson("date", { min: "2020-02-30" });
    expect(date.ok).toBe(false);
    if (!date.ok) expect(date.errors["min"]?.key).toBe("dict.validation.invalidDate");
  });

  it("refuses values outside the API's bounds (max_length at least 1, max_decimals at most 20)", () => {
    const text = validationToJson("text", { max_length: "0" });
    expect(text.ok).toBe(false);
    const decimals = validationToJson("number", { max_decimals: "21" });
    expect(decimals.ok).toBe(false);
    if (!decimals.ok)
      expect(decimals.errors["max_decimals"]?.key).toBe("dict.validation.outOfRange");
  });

  it("refuses a minimum above the maximum, on the maximum's field", () => {
    const number = validationToJson("number", { min: "5", max: "2" });
    expect(number.ok).toBe(false);
    if (!number.ok) expect(number.errors["max"]?.key).toBe("dict.validation.rangeOrder");
    const date = validationToJson("date", { min: "2025-01-01", max: "2024-01-01" });
    expect(date.ok).toBe(false);
    const equal = validationToJson("number", { min: "2", max: "2" });
    expect(equal.ok).toBe(true);
  });

  it("accepts the numbers the API accepts: signs, decimals, no exponent", () => {
    expect(validationToJson("number", { min: "-0.5", max: "1000" }).ok).toBe(true);
    expect(validationToJson("number", { min: "1e3" }).ok).toBe(false);
    expect(validationToJson("number", { min: " 1" }).ok).toBe(false);
  });
});

describe("validateAttributeForm", () => {
  it("requires the default locale of the name, a valid code on create, and nothing else", () => {
    expect(validateAttributeForm(filled(), "create", options)).toEqual({});
    const issues = validateAttributeForm(
      filled({ code: "Bad Code", name: { uk: " ", en: "x" } }),
      "create",
      options,
    );
    expect(issues["code"]?.key).toBe("dict.error.codeFormat");
    expect(issues["name.uk"]?.key).toBe("errors.reason.default_locale_missing");
  });

  it("does not check the code in edit mode (it cannot change)", () => {
    expect(validateAttributeForm(filled({ code: "" }), "edit", options)).toEqual({});
  });

  it("limits the unit and allows it for number only", () => {
    const long = validateAttributeForm(
      filled({ inputType: "number", unit: "x".repeat(UNIT_MAX_LENGTH + 1) }),
      "create",
      options,
    );
    expect(long["unit"]?.key).toBe("dict.error.unitTooLong");
    expect(
      validateAttributeForm(
        filled({ inputType: "number", unit: "x".repeat(UNIT_MAX_LENGTH) }),
        "create",
        options,
      ),
    ).toEqual({});
  });

  it("reports validation errors under the API's path (validation.min_length)", () => {
    const issues = validateAttributeForm(
      filled({ validation: { min_length: "-1" } }),
      "create",
      options,
    );
    expect(issues["validation.min_length"]?.key).toBe("dict.validation.invalidInteger");
  });
});

describe("attributeCreateBody", () => {
  it("sends the code, the name map, the input type and every flag by its API name", () => {
    expect(attributeCreateBody(filled(), options.locales)).toEqual({
      code: "material",
      name: { uk: "Матеріал" },
      inputType: "text",
      isLocalized: true,
      validation: {},
      isFilterable: false,
      isSearchable: false,
      isVisibleOnStorefront: true,
      isComparable: false,
      isSortable: false,
      isInternal: false,
    });
  });

  it("adds the description and the unit only when they have a value, and the typed validation", () => {
    const body = attributeCreateBody(
      filled({
        inputType: "number",
        isLocalized: false,
        description: { uk: "Опис", en: "" },
        unit: " kg ",
        validation: { min: "0", integer: "true" },
      }),
      locales,
    );
    expect(body.description).toEqual({ uk: "Опис" });
    expect(body.unit).toBe("kg");
    expect(body.validation).toEqual({ min: 0, integer: true });
    const plain = attributeCreateBody(filled(), locales);
    expect("description" in plain).toBe(false);
    expect("unit" in plain).toBe(false);
  });
});

describe("attributePatchBody", () => {
  const initial = attributeFormFrom(attribute(), locales);

  it("is empty when nothing changed", () => {
    expect(attributePatchBody(initial, structuredClone(initial), locales)).toEqual({});
  });

  it("is empty for a form that was only loaded and rebuilt (no spurious fields)", () => {
    expect(attributePatchBody(initial, attributeFormFrom(attribute(), locales), locales)).toEqual(
      {},
    );
  });

  it("sends only the flag that changed", () => {
    const next = applyFlag(initial, "isSearchable", true);
    expect(attributePatchBody(initial, next, locales)).toEqual({ isSearchable: true });
  });

  it("sends the whole name map when one locale changed, and never the code, input type or isLocalized", () => {
    const next = { ...initial, name: { ...initial.name, en: "Len" } };
    expect(attributePatchBody(initial, next, locales)).toEqual({
      name: { uk: "Довжина", en: "Len" },
    });
    const patch = attributePatchBody(initial, { ...next, code: "changed" }, locales);
    expect("code" in patch).toBe(false);
    expect("inputType" in patch).toBe(false);
    expect("isLocalized" in patch).toBe(false);
  });

  it("clears the unit and the description with null", () => {
    const withDescription = attributeFormFrom(attribute({ description: { uk: "Опис" } }), locales);
    const next = { ...withDescription, unit: "", description: { uk: "", en: "" } };
    expect(attributePatchBody(withDescription, next, locales)).toEqual({
      unit: null,
      description: null,
    });
  });

  it("sends the whole validation object when one key changed", () => {
    const next = { ...initial, validation: { ...initial.validation, max: "20" } };
    expect(attributePatchBody(initial, next, locales)).toEqual({
      validation: { min: 1, max: 20, integer: true },
    });
  });

  it("turning an attribute internal sends the flags that the form switched off, together", () => {
    const next = applyFlag(initial, "isInternal", true);
    expect(attributePatchBody(initial, next, locales)).toEqual({
      isInternal: true,
      isFilterable: false,
      isSortable: false,
      isVisibleOnStorefront: false,
    });
  });
});
