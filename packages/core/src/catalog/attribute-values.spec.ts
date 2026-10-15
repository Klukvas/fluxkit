import { describe, expect, it } from "vitest";
import {
  parseAttributeValidation,
  validateAttributeValues,
  type AttributeValueError,
} from "./attribute-values.js";
import { deepFreeze } from "./test-support.js";
import type {
  AttributeDefinition,
  AttributeInputType,
  AttributeLevel,
  ProductTypeDefinition,
} from "./types.js";

const locales = { defaultLocale: "uk", locales: ["uk", "en"] } as const;

function attribute(
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

function productType(
  ...assignments: readonly [AttributeDefinition, AttributeLevel, boolean?][]
): ProductTypeDefinition {
  return {
    code: "test_type",
    allowedOptionCodes: [],
    attributes: assignments.map(([definition, level, isRequired]) => ({
      attribute: definition,
      level,
      isRequired: isRequired ?? false,
    })),
  };
}

function validate(
  definition: AttributeDefinition,
  value: unknown,
  mode: "draft" | "publish" = "draft",
) {
  return validateAttributeValues(
    productType([definition, "product"]),
    "product",
    { [definition.code]: value },
    { mode, ...locales },
  );
}

function errorsOf(result: ReturnType<typeof validate>): readonly AttributeValueError[] {
  if (result.ok) {
    throw new Error("expected validation to fail");
  }
  return result.errors;
}

function expectError(
  definition: AttributeDefinition,
  value: unknown,
  expected: Omit<AttributeValueError, "attributeCode">,
) {
  expect(errorsOf(validate(definition, value))).toEqual([
    { attributeCode: definition.code, ...expected },
  ]);
}

describe("keys", () => {
  const material = attribute("material", "select", { options: [{ code: "cotton" }] });
  const weight = attribute("weight_g", "number");
  const type = productType([material, "product"], [weight, "variant"]);

  it("accepts an empty object and a valid object", () => {
    expect(validateAttributeValues(type, "product", {}, { mode: "draft", ...locales })).toEqual({
      ok: true,
    });
    expect(
      validateAttributeValues(type, "product", { material: "cotton" }, { mode: "draft", ...locales }),
    ).toEqual({ ok: true });
  });

  it("rejects a key that is not an assigned attribute code", () => {
    expect(
      validateAttributeValues(type, "product", { colour: "red" }, { mode: "draft", ...locales }),
    ).toEqual({ ok: false, errors: [{ attributeCode: "colour", reason: "unknown_attribute" }] });
  });

  it("rejects a key assigned at the other level", () => {
    expect(
      validateAttributeValues(type, "product", { weight_g: 5 }, { mode: "draft", ...locales }),
    ).toEqual({ ok: false, errors: [{ attributeCode: "weight_g", reason: "unknown_attribute" }] });
    expect(
      validateAttributeValues(type, "variant", { material: "cotton" }, { mode: "draft", ...locales }),
    ).toEqual({ ok: false, errors: [{ attributeCode: "material", reason: "unknown_attribute" }] });
  });

  it("rejects null and undefined values: not set means the key is absent", () => {
    for (const value of [null, undefined]) {
      expect(
        validateAttributeValues(type, "product", { material: value }, { mode: "draft", ...locales }),
      ).toEqual({ ok: false, errors: [{ attributeCode: "material", reason: "null_value" }] });
    }
  });

  it("reports an unknown key as unknown even when its value is null", () => {
    expect(
      validateAttributeValues(type, "product", { other: null }, { mode: "draft", ...locales }),
    ).toEqual({ ok: false, errors: [{ attributeCode: "other", reason: "unknown_attribute" }] });
  });

  it("rejects a values container that is not a plain object", () => {
    for (const values of [null, undefined, [], "x", 5]) {
      expect(validateAttributeValues(type, "product", values, { mode: "draft", ...locales })).toEqual({
        ok: false,
        errors: [{ attributeCode: null, reason: "values_not_an_object" }],
      });
    }
  });

  it("rejects an attributes object above 64 KB", () => {
    const note = attribute("note", "text", { validation: { max_length: 100000 } });
    const result = validateAttributeValues(
      productType([note, "product"]),
      "product",
      { note: "a".repeat(70000) },
      { mode: "draft", ...locales },
    );
    expect(result).toEqual({
      ok: false,
      errors: [{ attributeCode: null, reason: "values_too_large", limit: 65536 }],
    });
  });
});

describe("required attributes", () => {
  const sku = attribute("model", "text");
  const type = productType([sku, "product", true]);

  it("allows a missing required attribute in draft mode", () => {
    expect(validateAttributeValues(type, "product", {}, { mode: "draft", ...locales })).toEqual({
      ok: true,
    });
  });

  it("reports a missing required attribute in publish mode", () => {
    expect(validateAttributeValues(type, "product", {}, { mode: "publish", ...locales })).toEqual({
      ok: false,
      errors: [{ attributeCode: "model", reason: "required" }],
    });
  });

  it("does not require attributes assigned at the other level", () => {
    expect(validateAttributeValues(type, "variant", {}, { mode: "publish", ...locales })).toEqual({
      ok: true,
    });
  });

  it("does not require optional attributes in publish mode", () => {
    const optional = productType([sku, "product", false]);
    expect(
      validateAttributeValues(optional, "product", {}, { mode: "publish", ...locales }),
    ).toEqual({ ok: true });
  });

  it("still validates a present value in draft mode", () => {
    expect(
      validateAttributeValues(type, "product", { model: 5 }, { mode: "draft", ...locales }),
    ).toEqual({ ok: false, errors: [{ attributeCode: "model", reason: "invalid_type" }] });
  });

  it("treats null as null_value, not as missing, in both modes", () => {
    for (const mode of ["draft", "publish"] as const) {
      expect(
        validateAttributeValues(type, "product", { model: null }, { mode, ...locales }),
      ).toEqual({ ok: false, errors: [{ attributeCode: "model", reason: "null_value" }] });
    }
  });

  it("rejects a blank required text in publish mode", () => {
    expect(
      validateAttributeValues(type, "product", { model: "  " }, { mode: "publish", ...locales }),
    ).toEqual({ ok: false, errors: [{ attributeCode: "model", reason: "empty" }] });
  });
});

describe("text (plain)", () => {
  const model = attribute("model", "text");

  it("accepts a string", () => {
    expect(validate(model, "SUP-7781")).toEqual({ ok: true });
  });

  it("rejects non-strings", () => {
    for (const value of [5, true, {}, ["a"], { uk: "a" }]) {
      expectError(model, value, { reason: "invalid_type" });
    }
  });

  it("rejects blank strings", () => {
    expectError(model, "", { reason: "empty" });
    expectError(model, "   ", { reason: "empty" });
  });

  it("applies the default length 1..1000", () => {
    expect(validate(model, "a".repeat(1000))).toEqual({ ok: true });
    expectError(model, "a".repeat(1001), { reason: "too_long", limit: 1000 });
  });

  it("applies min_length and max_length", () => {
    const limited = attribute("code", "text", { validation: { min_length: 3, max_length: 5 } });
    expect(validate(limited, "abc")).toEqual({ ok: true });
    expect(validate(limited, "abcde")).toEqual({ ok: true });
    expectError(limited, "ab", { reason: "too_short", limit: 3 });
    expectError(limited, "abcdef", { reason: "too_long", limit: 5 });
  });
});

describe("text (localized)", () => {
  const care = attribute("care", "text", { isLocalized: true, validation: { max_length: 10 } });

  it("accepts a map with the default locale", () => {
    expect(validate(care, { uk: "Прати", en: "Wash" })).toEqual({ ok: true });
  });

  it("rejects a plain string", () => {
    expectError(care, "Прати", { reason: "invalid_type" });
  });

  it("rejects a map for a non-localized attribute", () => {
    expectError(attribute("model", "text"), { uk: "x" }, { reason: "invalid_type" });
  });

  it("requires the default locale", () => {
    expectError(care, { en: "Wash" }, { reason: "default_locale_missing", locale: "uk" });
  });

  it("rejects locales that are not configured", () => {
    expectError(care, { uk: "Прати", de: "Waschen" }, { reason: "locale_not_allowed", locale: "de" });
  });

  it("applies max_length per locale", () => {
    expectError(care, { uk: "Прати", en: "x".repeat(11) }, {
      reason: "too_long",
      locale: "en",
      limit: 10,
    });
  });

  it("applies min_length per locale", () => {
    const min = attribute("care", "text", { isLocalized: true, validation: { min_length: 4 } });
    expectError(min, { uk: "Прати", en: "Was" }, { reason: "too_short", locale: "en", limit: 4 });
  });

  it("rejects an empty map and a blank locale", () => {
    expectError(care, {}, { reason: "empty" });
    expectError(care, { uk: " " }, { reason: "empty", locale: "uk" });
  });
});

describe("number", () => {
  const length = attribute("length_mm", "number", { unit: "mm" });

  it("accepts integers, decimals, zero and negatives", () => {
    for (const value of [0, 100, -5, 1.5, 1.234]) {
      expect(validate(length, value)).toEqual({ ok: true });
    }
  });

  it("rejects non-numbers, including numeric strings and a value with a unit", () => {
    for (const value of ["5", "5 mm", true, [], {}]) {
      expectError(length, value, { reason: "invalid_type" });
    }
  });

  it("rejects NaN and Infinity", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectError(length, value, { reason: "invalid_type" });
    }
  });

  it("applies min and max inclusively", () => {
    const ranged = attribute("rating", "number", { validation: { min: 1, max: 5 } });
    expect(validate(ranged, 1)).toEqual({ ok: true });
    expect(validate(ranged, 5)).toEqual({ ok: true });
    expectError(ranged, 0.999, { reason: "below_min", limit: 1 });
    expectError(ranged, 5.001, { reason: "above_max", limit: 5 });
  });

  it("applies integer", () => {
    const whole = attribute("pieces", "number", { validation: { integer: true } });
    expect(validate(whole, 3)).toEqual({ ok: true });
    expect(validate(whole, 3.0)).toEqual({ ok: true });
    expectError(whole, 3.5, { reason: "not_integer" });
  });

  it("allows 3 decimals by default", () => {
    expect(validate(length, 1.234)).toEqual({ ok: true });
    expectError(length, 1.2345, { reason: "too_many_decimals", limit: 3 });
  });

  it("applies max_decimals, including 0 and exponent notation", () => {
    const none = attribute("n", "number", { validation: { max_decimals: 0 } });
    expect(validate(none, 12)).toEqual({ ok: true });
    expectError(none, 12.5, { reason: "too_many_decimals", limit: 0 });
    const many = attribute("n", "number", { validation: { max_decimals: 8 } });
    expect(validate(many, 1e-7)).toEqual({ ok: true });
    expectError(attribute("n", "number"), 1e-7, { reason: "too_many_decimals", limit: 3 });
    expect(validate(attribute("n", "number"), 1e21)).toEqual({ ok: true });
  });
});

describe("boolean", () => {
  const organic = attribute("organic", "boolean");

  it("accepts true and false", () => {
    expect(validate(organic, true)).toEqual({ ok: true });
    expect(validate(organic, false)).toEqual({ ok: true });
  });

  it("rejects everything else", () => {
    for (const value of ["true", "false", 0, 1, {}, []]) {
      expectError(organic, value, { reason: "invalid_type" });
    }
  });
});

describe("select", () => {
  const material = attribute("material", "select", {
    options: [{ code: "cotton" }, { code: "linen" }],
  });

  it("accepts an option code", () => {
    expect(validate(material, "linen")).toEqual({ ok: true });
  });

  it("rejects an unknown option code (case-sensitive)", () => {
    expectError(material, "wool", { reason: "unknown_option", value: "wool" });
    expectError(material, "Cotton", { reason: "unknown_option", value: "Cotton" });
  });

  it("rejects non-strings and arrays", () => {
    for (const value of [5, true, ["cotton"], { code: "cotton" }]) {
      expectError(material, value, { reason: "invalid_type" });
    }
  });

  it("rejects everything when the attribute has no options", () => {
    expectError(attribute("empty", "select"), "x", { reason: "unknown_option", value: "x" });
  });
});

describe("multiselect", () => {
  const season = attribute("season", "multiselect", {
    options: [{ code: "spring" }, { code: "summer" }, { code: "autumn" }],
  });

  it("accepts unique option codes and keeps the given order", () => {
    expect(validate(season, ["summer", "spring"])).toEqual({ ok: true });
  });

  it("rejects non-arrays and non-string items", () => {
    expectError(season, "spring", { reason: "invalid_type" });
    expectError(season, ["spring", 5], { reason: "invalid_type" });
  });

  it("rejects unknown codes and reports each one", () => {
    expect(errorsOf(validate(season, ["spring", "x", "y"]))).toEqual([
      { attributeCode: "season", reason: "unknown_option", value: "x" },
      { attributeCode: "season", reason: "unknown_option", value: "y" },
    ]);
  });

  it("rejects duplicates", () => {
    expectError(season, ["spring", "summer", "spring"], {
      reason: "duplicate_option",
      value: "spring",
    });
  });

  it("requires at least one item by default", () => {
    expectError(season, [], { reason: "too_few_items", limit: 1 });
  });

  it("applies min_items and max_items", () => {
    const limited = attribute("season", "multiselect", {
      options: [{ code: "a" }, { code: "b" }, { code: "c" }],
      validation: { min_items: 2, max_items: 2 },
    });
    expect(validate(limited, ["a", "b"])).toEqual({ ok: true });
    expectError(limited, ["a"], { reason: "too_few_items", limit: 2 });
    expectError(limited, ["a", "b", "c"], { reason: "too_many_items", limit: 2 });
  });

  it("allows an empty array when min_items is 0", () => {
    const optional = attribute("season", "multiselect", { validation: { min_items: 0 } });
    expect(validate(optional, [])).toEqual({ ok: true });
  });
});

describe("date", () => {
  const released = attribute("released_on", "date");

  it("accepts real calendar dates, including a leap day", () => {
    for (const value of ["2026-10-15", "2024-02-29", "0001-01-01", "9999-12-31"]) {
      expect(validate(released, value)).toEqual({ ok: true });
    }
  });

  it("rejects impossible dates", () => {
    for (const value of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "0000-01-01"]) {
      expectError(released, value, { reason: "invalid_date" });
    }
  });

  it("rejects other formats and non-strings", () => {
    for (const value of ["2026-1-1", "2026/01/01", "01.01.2026", "2026-01-01T00:00:00Z", " 2026-01-01"]) {
      expectError(released, value, { reason: "invalid_date" });
    }
    for (const value of [20260101, new Date(0), true]) {
      expectError(released, value, { reason: "invalid_type" });
    }
  });

  it("applies min and max inclusively", () => {
    const ranged = attribute("d", "date", { validation: { min: "2026-01-01", max: "2026-12-31" } });
    expect(validate(ranged, "2026-01-01")).toEqual({ ok: true });
    expect(validate(ranged, "2026-12-31")).toEqual({ ok: true });
    expectError(ranged, "2025-12-31", { reason: "below_min", limit: "2026-01-01" });
    expectError(ranged, "2027-01-01", { reason: "above_max", limit: "2026-12-31" });
  });
});

describe("invalid attribute definitions fail loudly", () => {
  it("reports invalid_definition instead of silently using defaults", () => {
    const broken = attribute("model", "text", { validation: { min_length: "three" } });
    expectError(broken, "abc", { reason: "invalid_definition" });
  });
});

describe("parseAttributeValidation", () => {
  it("applies defaults per input type", () => {
    expect(parseAttributeValidation("text", {})).toEqual({
      ok: true,
      value: { inputType: "text", minLength: 1, maxLength: 1000 },
    });
    expect(parseAttributeValidation("number", {})).toEqual({
      ok: true,
      value: { inputType: "number", integer: false, maxDecimals: 3 },
    });
    expect(parseAttributeValidation("multiselect", {})).toEqual({
      ok: true,
      value: { inputType: "multiselect", minItems: 1, maxItems: 50 },
    });
    expect(parseAttributeValidation("date", {})).toEqual({
      ok: true,
      value: { inputType: "date" },
    });
    expect(parseAttributeValidation("boolean", {})).toEqual({
      ok: true,
      value: { inputType: "boolean" },
    });
    expect(parseAttributeValidation("select", {})).toEqual({
      ok: true,
      value: { inputType: "select" },
    });
  });

  it("reads snake_case keys", () => {
    expect(
      parseAttributeValidation("number", { min: 1, max: 9, integer: true, max_decimals: 0 }),
    ).toEqual({
      ok: true,
      value: { inputType: "number", min: 1, max: 9, integer: true, maxDecimals: 0 },
    });
  });

  it("rejects unknown keys and keys of another input type", () => {
    expect(parseAttributeValidation("text", { pattern: ".*" })).toEqual({
      ok: false,
      issues: [{ key: "pattern", reason: "unknown_key" }],
    });
    expect(parseAttributeValidation("boolean", { min: 1 })).toEqual({
      ok: false,
      issues: [{ key: "min", reason: "unknown_key" }],
    });
  });

  it("rejects values of the wrong type or range", () => {
    expect(parseAttributeValidation("number", { min: "1" })).toEqual({
      ok: false,
      issues: [{ key: "min", reason: "invalid_value" }],
    });
    expect(parseAttributeValidation("text", { max_length: 0 })).toEqual({
      ok: false,
      issues: [{ key: "max_length", reason: "invalid_value" }],
    });
    expect(parseAttributeValidation("date", { min: "2026-02-30" })).toEqual({
      ok: false,
      issues: [{ key: "min", reason: "invalid_value" }],
    });
  });

  it("rejects an inverted range", () => {
    expect(parseAttributeValidation("number", { min: 5, max: 1 })).toEqual({
      ok: false,
      issues: [{ key: "min", reason: "min_greater_than_max" }],
    });
    expect(parseAttributeValidation("text", { min_length: 5, max_length: 1 })).toEqual({
      ok: false,
      issues: [{ key: "min_length", reason: "min_greater_than_max" }],
    });
    expect(parseAttributeValidation("multiselect", { min_items: 3, max_items: 1 })).toEqual({
      ok: false,
      issues: [{ key: "min_items", reason: "min_greater_than_max" }],
    });
    expect(
      parseAttributeValidation("date", { min: "2026-12-31", max: "2026-01-01" }),
    ).toEqual({ ok: false, issues: [{ key: "min", reason: "min_greater_than_max" }] });
  });

  it("rejects a validation that is not an object", () => {
    expect(parseAttributeValidation("text", null)).toEqual({
      ok: false,
      issues: [{ key: "", reason: "invalid_value" }],
    });
  });
});

describe("aggregation and purity", () => {
  const model = attribute("model", "text");
  const pieces = attribute("pieces", "number", { validation: { integer: true } });
  const season = attribute("season", "multiselect", { options: [{ code: "spring" }] });
  const required = attribute("brand_line", "text");
  const type = productType(
    [model, "product"],
    [pieces, "product"],
    [season, "product"],
    [required, "product", true],
  );

  it("returns all errors at once, provided keys first then missing required attributes", () => {
    const result = validateAttributeValues(
      type,
      "product",
      { pieces: 1.5, model: 5, season: ["x"], extra: 1 },
      { mode: "publish", ...locales },
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { attributeCode: "pieces", reason: "not_integer" },
        { attributeCode: "model", reason: "invalid_type" },
        { attributeCode: "season", reason: "unknown_option", value: "x" },
        { attributeCode: "extra", reason: "unknown_attribute" },
        { attributeCode: "brand_line", reason: "required" },
      ],
    });
  });

  it("does not throw and does not mutate frozen input; repeated calls are equal", () => {
    const frozenType = deepFreeze(type);
    const values = deepFreeze({ pieces: 2, model: "m", season: ["spring"], brand_line: "x" });
    const options = deepFreeze({ mode: "publish" as const, ...locales, locales: [...locales.locales] });
    const first = validateAttributeValues(frozenType, "product", values, options);
    const second = validateAttributeValues(frozenType, "product", values, options);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual(first);
    expect(values).toEqual({ pieces: 2, model: "m", season: ["spring"], brand_line: "x" });
  });

  it("validates frozen invalid input without throwing", () => {
    const values = deepFreeze({ pieces: "x", model: null, nested: { a: [1] } });
    const options = { mode: "draft" as const, ...locales };
    expect(() => validateAttributeValues(deepFreeze(type), "product", values, options)).not.toThrow();
  });
});
