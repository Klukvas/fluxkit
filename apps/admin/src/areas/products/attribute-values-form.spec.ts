import type {
  AdminAttributeWithOptions,
  AdminProductTypeAttribute,
  AdminProductTypeDetail,
  AttributeInputType,
  JsonObject,
  ProblemDetails,
} from "@fluxkit/api-client";
import {
  ATTRIBUTE_VALIDATION_DEFAULTS,
  isIsoCalendarDate as coreIsIsoCalendarDate,
  validateAttributeValues,
  type ProductTypeDefinition,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_DEFAULTS,
  attributeErrorsFromProblem,
  attributeFieldSpecs,
  attributeFormFrom,
  attributesPatchBody,
  isIsoCalendarDate,
  setCodes,
  setLocale,
  setText,
  toggleCode,
  validateAttributeForm,
  type AttributeFieldSpec,
  type AttributeFormValues,
} from "./attribute-values-form";

const locale = { defaultLocale: "uk", locales: ["uk", "en"] };
let sequence = 0;

function attribute(
  code: string,
  inputType: AttributeInputType,
  overrides: Partial<AdminAttributeWithOptions> = {},
): AdminAttributeWithOptions {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    code,
    name: { uk: `${code} uk`, en: `${code} en` },
    description: null,
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
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-19T10:00:00.000Z",
    options: [],
    ...overrides,
  };
}

function option(code: string, position: number) {
  return {
    id: `opt-${code}`,
    attributeId: "a",
    code,
    label: { uk: `${code}-uk`, en: `${code}-en` },
    position,
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-19T10:00:00.000Z",
  };
}

function assign(
  definition: AdminAttributeWithOptions,
  options: { level?: "product" | "variant"; isRequired?: boolean; position?: number } = {},
): AdminProductTypeAttribute {
  return {
    productTypeId: "type",
    attributeId: definition.id,
    attributeCode: definition.code,
    level: options.level ?? "product",
    isRequired: options.isRequired ?? false,
    position: options.position ?? 0,
    createdAt: "2026-10-19T10:00:00.000Z",
    attribute: definition,
  };
}

/** A product type with one attribute of every input type (invented codes: the form never knows a niche field). */
function sampleType(): AdminProductTypeDetail {
  return {
    id: "type",
    code: "sample_type",
    name: { uk: "Тип", en: "Type" },
    requiresShipping: true,
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-19T10:00:00.000Z",
    options: [],
    attributes: [
      assign(attribute("note", "text", { isLocalized: true, validation: { max_length: 20 } }), {
        position: 2,
      }),
      assign(attribute("model_code", "text", { validation: { min_length: 3, max_length: 8 } }), {
        position: 1,
        isRequired: true,
      }),
      assign(
        attribute("length_value", "number", {
          unit: "mm",
          validation: { min: 1, max: 500, max_decimals: 1 },
        }),
        { position: 3 },
      ),
      assign(attribute("pieces", "number", { validation: { integer: true } }), { position: 4 }),
      assign(attribute("flag_one", "boolean"), { position: 5, isRequired: true }),
      assign(
        attribute("finish", "select", {
          options: [option("matte", 2), option("gloss", 1)],
        }),
        { position: 6 },
      ),
      assign(
        attribute("tags", "multiselect", {
          options: [option("t1", 1), option("t2", 2), option("t3", 3)],
          validation: { min_items: 1, max_items: 2 },
        }),
        { position: 7 },
      ),
      assign(attribute("release_on", "date", { validation: { min: "2020-01-01" } }), {
        position: 8,
      }),
      assign(attribute("secret_ref", "text", { isInternal: true, isVisibleOnStorefront: false }), {
        position: 9,
      }),
      assign(attribute("per_variant", "number"), { level: "variant", position: 0 }),
    ],
  };
}

/** The same type in core's shape, so the form's checks can be compared with the API's own rules. */
function coreType(type: AdminProductTypeDetail): ProductTypeDefinition {
  return {
    code: type.code,
    allowedOptionCodes: [],
    attributes: type.attributes.map((assignment) => ({
      level: assignment.level,
      isRequired: assignment.isRequired,
      attribute: {
        ...assignment.attribute,
        validation: assignment.attribute.validation,
        options: assignment.attribute.options.map((entry) => ({ code: entry.code })),
      },
    })),
  };
}

const type = sampleType();
const specs = attributeFieldSpecs(type);
const spec = (code: string) => specs.find((entry) => entry.code === code) as AttributeFieldSpec;

describe("generated attribute fields", () => {
  it("are the product-level assignments only, by position, with the definition's metadata", () => {
    expect(specs.map((entry) => entry.code)).toEqual([
      "model_code",
      "note",
      "length_value",
      "pieces",
      "flag_one",
      "finish",
      "tags",
      "release_on",
      "secret_ref",
    ]);
    expect(specs.some((entry) => entry.code === "per_variant")).toBe(false);
    expect(spec("model_code").isRequired).toBe(true);
    expect(spec("length_value").unit).toBe("mm");
    expect(spec("secret_ref").isInternal).toBe(true);
    expect(spec("note").isLocalized).toBe(true);
  });

  it("list select options by position, with their labels", () => {
    expect(spec("finish").options.map((entry) => entry.code)).toEqual(["gloss", "matte"]);
    expect(spec("finish").options[0]?.label).toEqual({ uk: "gloss-uk", en: "gloss-en" });
  });

  it("apply core's validation defaults", () => {
    expect(ATTRIBUTE_DEFAULTS).toEqual({ ...ATTRIBUTE_VALIDATION_DEFAULTS });
    expect(spec("model_code").rules).toEqual({ inputType: "text", minLength: 3, maxLength: 8 });
    expect(spec("note").rules).toEqual({ inputType: "text", minLength: 1, maxLength: 20 });
    expect(spec("length_value").rules).toEqual({
      inputType: "number",
      min: 1,
      max: 500,
      integer: false,
      maxDecimals: 1,
    });
    expect(spec("pieces").rules).toEqual({ inputType: "number", integer: true, maxDecimals: 3 });
    expect(spec("tags").rules).toEqual({ inputType: "multiselect", minItems: 1, maxItems: 2 });
    expect(spec("release_on").rules).toEqual({ inputType: "date", min: "2020-01-01" });
    expect(spec("flag_one").rules).toEqual({ inputType: "boolean" });
  });

  it("mark a definition whose validation the API would refuse (no local rules; the server answers)", () => {
    const broken = attributeFieldSpecs({
      ...type,
      attributes: [assign(attribute("odd", "text", { validation: { pattern: "x" } }))],
    });
    expect(broken[0]?.rules).toBeNull();
  });
});

describe("attribute form values", () => {
  const stored: JsonObject = {
    note: { uk: "Примітка", en: "Note" },
    model_code: "AB-12",
    length_value: 12.5,
    pieces: 3,
    flag_one: false,
    finish: "matte",
    tags: ["t2", "t1"],
    release_on: "2026-01-31",
  };
  const values = attributeFormFrom(specs, stored, locale.locales);

  it("are read from the stored values per input type", () => {
    expect(values).toEqual({
      model_code: { kind: "text", text: "AB-12" },
      note: { kind: "locales", values: { uk: "Примітка", en: "Note" } },
      length_value: { kind: "text", text: "12.5" },
      pieces: { kind: "text", text: "3" },
      flag_one: { kind: "text", text: "false" },
      finish: { kind: "text", text: "matte" },
      tags: { kind: "codes", codes: ["t2", "t1"] },
      release_on: { kind: "text", text: "2026-01-31" },
      secret_ref: { kind: "text", text: "" },
    });
  });

  it("change through small pure updates", () => {
    const changed = toggleCode(
      toggleCode(setLocale(setText(values, "model_code", "XY"), "note", "en", "Hi"), "tags", "t2"),
      "tags",
      "t3",
    );
    expect(changed.model_code).toEqual({ kind: "text", text: "XY" });
    expect(changed.note).toEqual({ kind: "locales", values: { uk: "Примітка", en: "Hi" } });
    expect(changed.tags).toEqual({ kind: "codes", codes: ["t1", "t3"] });
    expect(setCodes(values, "tags", []).tags).toEqual({ kind: "codes", codes: [] });
    expect(values.model_code).toEqual({ kind: "text", text: "AB-12" });
  });
});

describe("attribute form checks (per validation rule, compared with core)", () => {
  const empty = attributeFormFrom(specs, {}, locale.locales);
  const withText = (code: string, text: string) => setText(empty, code, text);
  const check = (values: AttributeFormValues, mode: "draft" | "publish" = "draft") =>
    validateAttributeForm(specs, values, { ...locale, mode });

  it("asks nothing of an empty draft, and requires the required attributes when the product is live", () => {
    expect(check(empty)).toEqual({});
    expect(check(empty, "publish")).toEqual({
      "attributes.model_code": { key: "errors.reason.required" },
      "attributes.flag_one": { key: "errors.reason.required" },
    });
  });

  it("checks text length (code points) and the default locale of a localized text", () => {
    expect(check(withText("model_code", "ab"))).toEqual({
      "attributes.model_code": { key: "products.attributeIssue.tooShort", values: { min: 3 } },
    });
    expect(check(withText("model_code", "abcdefghi"))).toEqual({
      "attributes.model_code": { key: "products.attributeIssue.tooLong", values: { max: 8 } },
    });
    expect(check(setLocale(empty, "note", "en", "only english"))).toEqual({
      "attributes.note.uk": { key: "errors.reason.default_locale_missing" },
    });
    expect(check(setLocale(empty, "note", "uk", "x".repeat(21)))).toEqual({
      "attributes.note.uk": { key: "products.attributeIssue.tooLong", values: { max: 20 } },
    });
  });

  it("checks numbers: format, integer, decimals, range", () => {
    expect(check(withText("length_value", "1,5"))).toEqual({
      "attributes.length_value": { key: "products.attributeIssue.notANumber" },
    });
    expect(check(withText("length_value", "1e3"))).toEqual({
      "attributes.length_value": { key: "products.attributeIssue.notANumber" },
    });
    expect(check(withText("length_value", "1.25"))).toEqual({
      "attributes.length_value": {
        key: "products.attributeIssue.tooManyDecimals",
        values: { max: 1 },
      },
    });
    expect(check(withText("length_value", "0.5"))).toEqual({
      "attributes.length_value": { key: "products.attributeIssue.belowMin", values: { min: 1 } },
    });
    expect(check(withText("length_value", "500.1"))).toEqual({
      "attributes.length_value": { key: "products.attributeIssue.aboveMax", values: { max: 500 } },
    });
    expect(check(withText("pieces", "2.5"))).toEqual({
      "attributes.pieces": { key: "products.attributeIssue.notInteger" },
    });
    expect(check(withText("length_value", "-0"))).toEqual({
      "attributes.length_value": { key: "products.attributeIssue.belowMin", values: { min: 1 } },
    });
    expect(check(withText("length_value", "12.50"))).toEqual({});
  });

  it("checks multiselect item counts and dates", () => {
    const three = toggleCode(
      toggleCode(toggleCode(empty, "tags", "t1"), "tags", "t2"),
      "tags",
      "t3",
    );
    expect(check(three)).toEqual({
      "attributes.tags": { key: "products.attributeIssue.tooManyItems", values: { max: 2 } },
    });
    expect(check(withText("release_on", "2026-02-30"))).toEqual({
      "attributes.release_on": { key: "products.attributeIssue.invalidDate" },
    });
    expect(check(withText("release_on", "2019-12-31"))).toEqual({
      "attributes.release_on": {
        key: "products.attributeIssue.dateBeforeMin",
        values: { min: "2020-01-01" },
      },
    });
  });

  it("refuses a select or boolean value that is not one of the choices", () => {
    expect(check(withText("finish", "shiny"))).toEqual({
      "attributes.finish": { key: "errors.reason.invalid_value" },
    });
    expect(check(withText("flag_one", "yes"))).toEqual({
      "attributes.flag_one": { key: "errors.reason.invalid_value" },
    });
  });

  it("agrees with core's validateAttributeValues on whether a body is valid", () => {
    const samples: AttributeFormValues[] = [
      empty,
      withText("model_code", "ab"),
      withText("model_code", "abcd"),
      setLocale(empty, "note", "en", "x"),
      setLocale(setLocale(empty, "note", "en", "x"), "note", "uk", "y"),
      withText("length_value", "1.25"),
      withText("length_value", "499.9"),
      withText("pieces", "2.5"),
      withText("pieces", "7"),
      withText("flag_one", "true"),
      withText("finish", "gloss"),
      toggleCode(empty, "tags", "t1"),
      toggleCode(toggleCode(toggleCode(empty, "tags", "t1"), "tags", "t2"), "tags", "t3"),
      withText("release_on", "2019-12-31"),
      withText("release_on", "2021-06-01"),
      withText("secret_ref", "SUP-1"),
    ];
    for (const mode of ["draft", "publish"] as const) {
      for (const sample of samples) {
        const local = check(sample, mode);
        const body = attributesPatchBody(specs, empty, sample, {}, locale.locales).attributes ?? {};
        const core = validateAttributeValues(coreType(type), "product", body, { ...locale, mode });
        expect(Object.keys(local).length === 0, JSON.stringify({ mode, body })).toBe(core.ok);
        if (!core.ok) {
          const corePaths = core.errors.map((error) =>
            ["attributes", error.attributeCode, error.locale].filter(Boolean).join("."),
          );
          expect(Object.keys(local).sort(), JSON.stringify(body)).toEqual(
            [...new Set(corePaths)].sort(),
          );
        }
      }
    }
  });

  it("uses the same calendar date rule as core", () => {
    for (const sample of [
      "2026-02-28",
      "2026-02-29",
      "2024-02-29",
      "0000-01-01",
      "2026-1-01",
      "x",
    ]) {
      expect(isIsoCalendarDate(sample), sample).toBe(coreIsIsoCalendarDate(sample));
    }
  });
});

describe("attributes PATCH body (the whole map: the API replaces product-level values)", () => {
  const stored: JsonObject = {
    model_code: "AB-12",
    length_value: 12.5,
    tags: ["t2", "t1"],
    note: { uk: "Примітка", en: "Note", de: "kept as stored" },
    retired_code: "kept",
  };
  const initial = attributeFormFrom(specs, stored, locale.locales);

  it("is empty when nothing changed, and keeps untouched values exactly as stored", () => {
    expect(attributesPatchBody(specs, initial, initial, stored, locale.locales)).toEqual({});
    const body = attributesPatchBody(
      specs,
      initial,
      setText(initial, "length_value", "13"),
      stored,
      locale.locales,
    );
    expect(body).toEqual({
      attributes: {
        model_code: "AB-12",
        length_value: 13,
        tags: ["t2", "t1"],
        note: { uk: "Примітка", en: "Note", de: "kept as stored" },
        retired_code: "kept",
      },
    });
  });

  it("writes each input type in the API's shape and leaves an emptied attribute out", () => {
    const edited = toggleCode(
      setText(
        setText(
          setText(
            setText(
              setLocale(setText(initial, "model_code", " "), "note", "en", " "),
              "flag_one",
              "true",
            ),
            "finish",
            "gloss",
          ),
          "release_on",
          "2026-03-01",
        ),
        "secret_ref",
        "  SUP-9 ",
      ),
      "tags",
      "t3",
    );
    expect(attributesPatchBody(specs, initial, edited, stored, locale.locales)).toEqual({
      attributes: {
        note: { uk: "Примітка" },
        length_value: 12.5,
        flag_one: true,
        finish: "gloss",
        tags: ["t2", "t1", "t3"],
        release_on: "2026-03-01",
        secret_ref: "SUP-9",
        retired_code: "kept",
      },
    });
  });
});

describe("400 attributes.<code> errors on the fields", () => {
  const problem = (errors: { path: string; code: string }[]): ProblemDetails => ({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "validation_failed",
    detail: "x",
    errors,
  });

  it("puts each error on its attribute (and locale), with the attribute reason's message", () => {
    const mapped = attributeErrorsFromProblem(
      problem([
        { path: "attributes.model_code", code: "too_short" },
        { path: "attributes.note.uk", code: "default_locale_missing" },
        { path: "attributes.length_value", code: "above_max" },
        { path: "attributes.tags", code: "unknown_option" },
        { path: "attributes", code: "values_too_large" },
        { path: "attributes.unknown_one", code: "unknown_attribute" },
        { path: "title.uk", code: "empty" },
      ]),
      specs,
      locale.locales,
    );
    expect(mapped.fields).toEqual({
      "attributes.model_code": { key: "products.attributeReason.too_short" },
      "attributes.note.uk": { key: "products.attributeReason.default_locale_missing" },
      "attributes.length_value": { key: "products.attributeReason.above_max" },
      "attributes.tags": { key: "products.attributeReason.unknown_option" },
    });
    expect(mapped.other).toEqual([
      { key: "products.attributeReason.values_too_large" },
      { key: "products.attributeReason.unknown_attribute" },
      { key: "errors.reason.empty" },
    ]);
  });

  it("falls back to the generic message with the code for a reason it does not know", () => {
    const mapped = attributeErrorsFromProblem(
      problem([{ path: "attributes.model_code", code: "brand_new_reason" }]),
      specs,
      locale.locales,
    );
    expect(mapped.fields["attributes.model_code"]).toEqual({
      key: "errors.generic",
      code: "brand_new_reason",
    });
  });

  it("explains a problem without field errors in the summary", () => {
    const mapped = attributeErrorsFromProblem(
      { type: "about:blank", title: "x", status: 409, code: "conflict", detail: "x" },
      specs,
      locale.locales,
    );
    expect(mapped).toEqual({ fields: {}, other: [{ key: "errors.code.conflict" }] });
  });
});
