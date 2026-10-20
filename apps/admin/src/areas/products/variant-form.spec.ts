import type { AdminProduct, AdminVariant, ProblemDetails } from "@fluxkit/api-client";
import {
  SKU_PATTERN as CORE_SKU_PATTERN,
  TEXT_LIMITS,
  normalizeSku as coreNormalizeSku,
  validateSku,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  BARCODE_MAX_LENGTH,
  SKU_MAX_LENGTH,
  SKU_PATTERN,
  activeToggle,
  combinationTaken,
  defaultBlock,
  deleteBlock,
  newVariantValues,
  normalizeSku,
  skuIssue,
  validateVariantCreate,
  validateVariantForm,
  variantCreateBody,
  variantErrorsFromProblem,
  variantFormFrom,
  variantPatchBody,
} from "./variant-form";

function variant(id: string, overrides: Partial<AdminVariant> = {}): AdminVariant {
  return {
    id,
    sku: `SKU-${id.toUpperCase()}`,
    barcode: null,
    title: null,
    optionSignature: "",
    isDefault: false,
    isActive: true,
    trackInventory: true,
    allowBackorder: false,
    attributes: {},
    position: 0,
    optionValues: [],
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

const value = (optionId: string, optionValueId: string) => ({
  optionId,
  optionCode: `code_${optionId}`,
  optionValueId,
  valueCode: `code_${optionValueId}`,
});

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "p",
    productTypeId: "t",
    brandId: null,
    slug: "p",
    title: { uk: "П" },
    description: null,
    status: "draft",
    attributes: {},
    publishedAt: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    categories: [],
    media: [],
    options: [
      {
        optionId: "B",
        optionCode: "code_B",
        position: 0,
        values: [
          { optionValueId: "b1", valueCode: "code_b1", position: 0 },
          { optionValueId: "b2", valueCode: "code_b2", position: 1 },
        ],
      },
      {
        optionId: "A",
        optionCode: "code_A",
        position: 1,
        values: [{ optionValueId: "a1", valueCode: "code_a1", position: 0 }],
      },
    ],
    variants: [
      variant("v1", { isDefault: true, optionValues: [value("B", "b1"), value("A", "a1")] }),
      variant("v2", { optionValues: [value("B", "b2"), value("A", "a1")], isActive: false }),
    ],
    ...overrides,
  };
}

describe("SKU rules, copied from core and compared with it", () => {
  it("normalizes like core: trim and ASCII upper case only", () => {
    for (const raw of [" ab-1 ", "abc.def_9", "ß-straße", "ﬁle", "Ab Cd", "", "   "]) {
      expect(normalizeSku(raw), raw).toBe(coreNormalizeSku(raw));
    }
    expect(normalizeSku("  sku-a1 ")).toBe("SKU-A1");
    expect(SKU_PATTERN.source).toBe(CORE_SKU_PATTERN.source);
    expect(SKU_MAX_LENGTH).toBe(TEXT_LIMITS.sku);
    expect(BARCODE_MAX_LENGTH).toBe(TEXT_LIMITS.barcode);
  });

  it("refuses what core refuses, with core's reason", () => {
    for (const raw of ["", "  ", "a".repeat(65), "-abc", "ab c", "ab/c", "аб", "ok-1", "A.B_C-9"]) {
      const core = validateSku(raw);
      expect(skuIssue(raw), raw).toEqual(core.ok ? null : { key: `errors.reason.${core.reason}` });
    }
  });
});

describe("the variant edit form", () => {
  const stored = variant("v1", { sku: "SKU-1", barcode: "4006381333931", allowBackorder: true });

  it("starts from the stored variant", () => {
    expect(variantFormFrom(stored)).toEqual({
      sku: "SKU-1",
      barcode: "4006381333931",
      isActive: true,
      trackInventory: true,
      allowBackorder: true,
    });
    expect(variantFormFrom(variant("x")).barcode).toBe("");
  });

  it("checks the SKU and the barcode length", () => {
    const values = variantFormFrom(stored);
    expect(validateVariantForm(values)).toEqual({});
    expect(validateVariantForm({ ...values, sku: "bad sku" })["sku"]).toEqual({
      key: "errors.reason.invalid_format",
    });
    expect(validateVariantForm({ ...values, barcode: "9".repeat(65) })["barcode"]).toEqual({
      key: "errors.reason.too_long",
    });
  });

  it("PATCHes only what changed: nothing, a normalized SKU, a cleared barcode, one flag", () => {
    const values = variantFormFrom(stored);
    expect(variantPatchBody(stored, values)).toEqual({});
    expect(variantPatchBody(stored, { ...values, sku: " sku-1 " })).toEqual({});
    expect(variantPatchBody(stored, { ...values, sku: "sku-2" })).toEqual({ sku: "SKU-2" });
    expect(variantPatchBody(stored, { ...values, barcode: "  " })).toEqual({ barcode: null });
    expect(variantPatchBody(stored, { ...values, barcode: " 123 " })).toEqual({ barcode: "123" });
    expect(variantPatchBody(stored, { ...values, allowBackorder: false })).toEqual({
      allowBackorder: false,
    });
    expect(variantPatchBody(stored, { ...values, isActive: false, trackInventory: false })).toEqual(
      { isActive: false, trackInventory: false },
    );
  });

  it("merges the variant attribute body when the attributes changed", () => {
    expect(
      variantPatchBody(stored, variantFormFrom(stored), { attributes: { per_variant: 3 } }),
    ).toEqual({ attributes: { per_variant: 3 } });
    expect(variantPatchBody(stored, variantFormFrom(stored), {})).toEqual({});
  });
});

describe("creating a variant by hand (draft products)", () => {
  it("starts with no values chosen, active, stock tracked as the type says", () => {
    expect(newVariantValues(product(), true)).toEqual({
      valueIds: { B: "", A: "" },
      sku: "",
      barcode: "",
      isActive: true,
      trackInventory: true,
      allowBackorder: false,
    });
    expect(newVariantValues(product(), false).trackInventory).toBe(false);
  });

  it("needs one value per option, refuses a combination that already has a variant, checks a typed SKU", () => {
    const empty = newVariantValues(product(), true);
    const issues = validateVariantCreate(empty, product());
    expect(issues["optionValueIds.B"]).toEqual({ key: "errors.reason.required" });
    expect(issues["optionValueIds.A"]).toEqual({ key: "errors.reason.required" });
    const taken = { ...empty, valueIds: { B: "b2", A: "a1" } };
    expect(validateVariantCreate(taken, product())["optionValueIds"]).toEqual({
      key: "products.variants.combinationTaken",
    });
    expect(combinationTaken(product(), ["a1", "b2"])).toBe(true);
    expect(combinationTaken(product({ variants: [] }), ["a1", "b2"])).toBe(false);
    const fresh = { ...empty, valueIds: { B: "b2", A: "a1" } };
    const free = product({ variants: [product().variants[0] as AdminVariant] });
    expect(validateVariantCreate(fresh, free)).toEqual({});
    expect(validateVariantCreate({ ...fresh, sku: "no spaces" }, free)["sku"]).toEqual({
      key: "errors.reason.invalid_format",
    });
  });

  it("sends the values in the product's option order, a SKU only when typed, every flag", () => {
    const values = { ...newVariantValues(product(), true), valueIds: { A: "a1", B: "b2" } };
    expect(variantCreateBody(values, product())).toEqual({
      optionValueIds: ["b2", "a1"],
      isActive: true,
      trackInventory: true,
      allowBackorder: false,
    });
    expect(
      variantCreateBody({ ...values, sku: " new-1 ", barcode: " 12 " }, product()),
    ).toMatchObject({ sku: "NEW-1", barcode: "12" });
  });
});

describe("row actions (hints; the API decides)", () => {
  const draft = product();
  const live = product({ status: "active" });
  const [first, second] = draft.variants as [AdminVariant, AdminVariant];

  it("delete: draft only, never the default, never the last variant", () => {
    expect(deleteBlock(draft, second)).toBeNull();
    expect(deleteBlock(draft, first)).toBe("default_variant");
    expect(deleteBlock(live, second)).toBe("product_not_draft");
    expect(deleteBlock(product({ status: "archived" }), second)).toBe("product_not_draft");
    const alone = variant("solo");
    expect(deleteBlock(product({ variants: [alone] }), alone)).toBe("last_variant");
  });

  it("make default: not the default already; on a live product only an active variant", () => {
    expect(defaultBlock(draft, first)).toBe("already_default");
    expect(defaultBlock(draft, second)).toBeNull();
    expect(defaultBlock(live, second)).toBe("default_variant_inactive");
    expect(defaultBlock(live, { ...second, isActive: true })).toBeNull();
  });

  it("switch on or off: a live product keeps its default and one active variant on", () => {
    expect(activeToggle(draft, first)).toEqual({ next: false, block: null });
    expect(activeToggle(live, first)).toEqual({ next: false, block: "default_variant_inactive" });
    expect(activeToggle(live, second)).toEqual({ next: true, block: null });
    const onlyActive = variant("x", { isActive: true });
    const other = variant("d", { isDefault: true, isActive: true });
    const liveTwo = product({ status: "active", variants: [other, onlyActive] });
    expect(activeToggle(liveTwo, onlyActive)).toEqual({ next: false, block: null });
    const lone = product({
      status: "active",
      variants: [variant("d", { isDefault: true, isActive: false }), onlyActive],
    });
    expect(activeToggle(lone, onlyActive)).toEqual({ next: false, block: "no_active_variant" });
  });
});

describe("a refused variant save on the form", () => {
  const fields = ["sku", "barcode", "attributes.per_variant", "attributes.note.uk"];
  const base = { type: "about:blank", title: "x", detail: "x" };

  it("puts a duplicate SKU (409 conflict on sku) on the SKU field", () => {
    const problem: ProblemDetails = { ...base, status: 409, code: "conflict", field: "sku" };
    expect(variantErrorsFromProblem(problem, 409, fields)).toEqual({
      fields: { sku: { key: "errors.code.conflict" } },
      other: [],
    });
  });

  it("puts attribute errors on the attribute with the attribute reason, other paths on their field or the summary", () => {
    const problem: ProblemDetails = {
      ...base,
      status: 400,
      code: "validation_failed",
      errors: [
        { path: "attributes.per_variant", code: "required" },
        { path: "attributes.note.uk", code: "too_long" },
        { path: "sku", code: "invalid_format" },
        { path: "attributes.unknown", code: "unknown_attribute" },
      ],
    };
    expect(variantErrorsFromProblem(problem, 400, fields)).toEqual({
      fields: {
        "attributes.per_variant": { key: "products.attributeReason.required" },
        "attributes.note.uk": { key: "products.attributeReason.too_long" },
        sku: { key: "errors.reason.invalid_format" },
      },
      other: [{ key: "products.attributeReason.unknown_attribute" }],
    });
  });

  it("explains a rule (price_missing, default_variant_inactive) in the summary", () => {
    const problem: ProblemDetails = {
      ...base,
      status: 409,
      code: "rule_violation",
      rule: "price_missing",
    };
    expect(variantErrorsFromProblem(problem, 409, fields)).toEqual({
      fields: {},
      other: [{ key: "errors.reason.price_missing" }],
    });
  });
});
