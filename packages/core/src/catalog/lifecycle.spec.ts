import { describe, expect, it } from "vitest";
import {
  canHardDelete,
  canTransition,
  publishPreconditions,
  type PublishViolation,
} from "./lifecycle.js";
import { deepFreeze } from "./test-support.js";
import type {
  AttributeDefinition,
  AttributeInputType,
  ProductSnapshot,
  ProductStatus,
  ProductTypeDefinition,
  VariantSnapshot,
} from "./types.js";

const config = { defaultLocale: "uk", locales: ["uk", "en"] } as const;

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

const clothing: ProductTypeDefinition = {
  code: "clothing",
  allowedOptionCodes: ["color", "size"],
  attributes: [
    {
      attribute: attribute("material", "select", {
        options: [{ code: "cotton" }, { code: "linen" }],
      }),
      level: "product",
      isRequired: true,
    },
    {
      attribute: attribute("care", "text", { isLocalized: true }),
      level: "product",
      isRequired: false,
    },
    {
      attribute: attribute("weight_g", "number", { unit: "g" }),
      level: "variant",
      isRequired: true,
    },
    {
      attribute: attribute("supplier_code", "text", {
        isInternal: true,
        isVisibleOnStorefront: false,
      }),
      level: "variant",
      isRequired: false,
    },
  ],
};

const handTool: ProductTypeDefinition = {
  code: "hand_tool",
  allowedOptionCodes: [],
  attributes: [
    {
      attribute: attribute("tip_type", "select", { options: [{ code: "ph2" }] }),
      level: "product",
      isRequired: true,
    },
  ],
};

function variant(overrides: Partial<VariantSnapshot> = {}): VariantSnapshot {
  return {
    sku: "FUTBOLKA-BASIC-RED-S",
    isDefault: true,
    isActive: true,
    optionSignature: "color=red;size=s",
    optionValues: [
      { optionCode: "color", valueCode: "red" },
      { optionCode: "size", valueCode: "s" },
    ],
    attributes: { weight_g: 180 },
    ...overrides,
  };
}

const blackVariant = variant({
  sku: "FUTBOLKA-BASIC-BLACK-S",
  isDefault: false,
  optionSignature: "color=black;size=s",
  optionValues: [
    { optionCode: "color", valueCode: "black" },
    { optionCode: "size", valueCode: "s" },
  ],
});

function product(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    status: "draft",
    slug: "futbolka-basic",
    title: { uk: "Футболка Basic", en: "Basic T-shirt" },
    publishedAt: null,
    attributes: { material: "cotton" },
    optionCodes: ["color", "size"],
    variants: [variant(), blackVariant],
    ...overrides,
  };
}

function check(snapshot: ProductSnapshot, type: ProductTypeDefinition = clothing) {
  return publishPreconditions(snapshot, type, config);
}

function codes(violations: readonly PublishViolation[]): string[] {
  return violations.map((violation) => violation.code);
}

describe("canTransition (ADR 0006 section 6)", () => {
  const allowed: readonly (readonly [ProductStatus, ProductStatus])[] = [
    ["draft", "active"],
    ["active", "draft"],
    ["draft", "archived"],
    ["active", "archived"],
    ["archived", "draft"],
  ];
  const forbidden: readonly (readonly [ProductStatus, ProductStatus])[] = [
    ["archived", "active"],
    ["draft", "draft"],
    ["active", "active"],
    ["archived", "archived"],
  ];

  it.each(allowed)("%s -> %s is allowed", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(forbidden)("%s -> %s is forbidden", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("covers every ordered pair of statuses exactly once", () => {
    expect(allowed.length + forbidden.length).toBe(9);
  });
});

describe("canHardDelete", () => {
  it("allows a product that was never published", () => {
    expect(canHardDelete({ publishedAt: null })).toBe(true);
  });

  it("forbids a product that was ever published, even if it is a draft again", () => {
    expect(canHardDelete({ publishedAt: "2026-10-15T10:00:00.000Z" })).toBe(false);
  });
});

describe("publishPreconditions", () => {
  it("returns no violations for a complete product", () => {
    expect(check(product())).toEqual([]);
  });

  it("accepts a simple product with one default variant and no options", () => {
    const simple = product({
      optionCodes: [],
      attributes: { tip_type: "ph2" },
      variants: [
        variant({ sku: "VYKRUTKA-PH2-100", optionSignature: "", optionValues: [], attributes: {} }),
      ],
    });
    expect(check(simple, handTool)).toEqual([]);
  });

  describe("title and slug", () => {
    it("requires a title in the default locale", () => {
      expect(check(product({ title: { en: "Basic T-shirt" } }))).toEqual([
        { code: "title_invalid", reason: "default_locale_missing", locale: "uk" },
      ]);
    });

    it("rejects a missing, blank or oversized title", () => {
      expect(codes(check(product({ title: null })))).toEqual(["title_invalid"]);
      expect(check(product({ title: { uk: " " } }))).toEqual([
        { code: "title_invalid", reason: "empty", locale: "uk" },
      ]);
      expect(check(product({ title: { uk: "x".repeat(256) } }))).toEqual([
        { code: "title_invalid", reason: "too_long", locale: "uk" },
      ]);
    });

    it("requires a slug in the valid format", () => {
      expect(check(product({ slug: "" }))).toEqual([{ code: "slug_missing" }]);
      expect(check(product({ slug: "Bad Slug" }))).toEqual([
        { code: "slug_invalid", reason: "invalid_format" },
      ]);
    });
  });

  describe("variants", () => {
    it("requires at least one variant", () => {
      expect(codes(check(product({ variants: [] })))).toEqual(["no_variants"]);
    });

    it("requires exactly one default variant", () => {
      expect(
        codes(check(product({ variants: [variant({ isDefault: false }), blackVariant] }))),
      ).toEqual(["no_default_variant"]);
      expect(
        codes(check(product({ variants: [variant(), { ...blackVariant, isDefault: true }] }))),
      ).toEqual(["multiple_default_variants", "multiple_default_variants"]);
    });

    it("requires the default variant to be active", () => {
      expect(check(product({ variants: [variant({ isActive: false }), blackVariant] }))).toEqual([
        { code: "default_variant_inactive", variantIndex: 0 },
      ]);
    });

    it("requires at least one active variant", () => {
      const inactive = product({
        variants: [variant({ isActive: false }), { ...blackVariant, isActive: false }],
      });
      expect(codes(check(inactive))).toEqual(["default_variant_inactive", "no_active_variant"]);
    });

    it("requires option coverage", () => {
      const partial = product({
        variants: [
          variant({
            optionSignature: "color=red",
            optionValues: [{ optionCode: "color", valueCode: "red" }],
          }),
        ],
      });
      expect(check(partial)).toEqual([
        { code: "missing_option_value", variantIndex: 0, optionCode: "size" },
      ]);
    });

    it("requires unique option signatures and consistent signatures", () => {
      expect(
        check(product({ variants: [variant(), { ...variant(), sku: "OTHER", isDefault: false }] })),
      ).toEqual([
        { code: "duplicate_option_signature", variantIndex: 1, signature: "color=red;size=s" },
      ]);
      expect(check(product({ variants: [variant({ optionSignature: "color=red" })] }))).toEqual([
        { code: "signature_mismatch", variantIndex: 0, signature: "color=red" },
      ]);
    });

    it("requires a valid, stored-form SKU on every variant", () => {
      const result = check(product({ variants: [variant(), { ...blackVariant, sku: "bad sku" }] }));
      expect(result).toEqual([
        { code: "variant_sku_invalid", variantIndex: 1, reason: "invalid_format" },
      ]);
      expect(
        codes(check(product({ variants: [variant({ sku: "lower" }), blackVariant] }))),
      ).toEqual(["variant_sku_invalid"]);
      expect(codes(check(product({ variants: [variant({ sku: "" }), blackVariant] })))).toEqual([
        "variant_sku_invalid",
      ]);
      expect(
        check(product({ variants: [variant({ sku: "A".repeat(65) }), blackVariant] })),
      ).toEqual([{ code: "variant_sku_invalid", variantIndex: 0, reason: "too_long" }]);
    });

    it("rejects a SKU used twice inside the product", () => {
      expect(
        check(product({ variants: [variant(), { ...blackVariant, sku: variant().sku }] })),
      ).toEqual([{ code: "duplicate_sku", variantIndex: 1 }]);
    });
  });

  describe("attributes", () => {
    it("requires product-level required attributes", () => {
      expect(check(product({ attributes: {} }))).toEqual([
        {
          code: "attribute_invalid",
          level: "product",
          attributeCode: "material",
          reason: "required",
        },
      ]);
    });

    it("requires variant-level required attributes on every variant", () => {
      const result = check(product({ variants: [variant(), { ...blackVariant, attributes: {} }] }));
      expect(result).toEqual([
        {
          code: "attribute_invalid",
          level: "variant",
          variantIndex: 1,
          attributeCode: "weight_g",
          reason: "required",
        },
      ]);
    });

    it("does not require variant-level required attributes on an inactive variant", () => {
      // A variant that was generated for a live product stays inactive until its attributes are filled.
      const inactive = { ...blackVariant, isActive: false, attributes: {} };
      expect(check(product({ variants: [variant(), inactive] }))).toEqual([]);
    });

    it("still rejects invalid values and unknown keys on an inactive variant", () => {
      const inactive = { ...blackVariant, isActive: false, attributes: { weight_g: "heavy" } };
      expect(check(product({ variants: [variant(), inactive] }))).toEqual([
        {
          code: "attribute_invalid",
          level: "variant",
          variantIndex: 1,
          attributeCode: "weight_g",
          reason: "invalid_type",
        },
      ]);
    });

    it("reports invalid values and unknown keys at both levels", () => {
      const result = check(
        product({
          attributes: { material: "wool", colour: "red" },
          variants: [variant({ attributes: { weight_g: "heavy" } }), blackVariant],
        }),
      );
      expect(result).toEqual([
        {
          code: "attribute_invalid",
          level: "product",
          attributeCode: "material",
          reason: "unknown_option",
        },
        {
          code: "attribute_invalid",
          level: "product",
          attributeCode: "colour",
          reason: "unknown_attribute",
        },
        {
          code: "attribute_invalid",
          level: "variant",
          variantIndex: 0,
          attributeCode: "weight_g",
          reason: "invalid_type",
        },
      ]);
    });

    it("carries the locale of a localized text error", () => {
      const result = check(product({ attributes: { material: "cotton", care: { en: "Wash" } } }));
      expect(result).toEqual([
        {
          code: "attribute_invalid",
          level: "product",
          attributeCode: "care",
          reason: "default_locale_missing",
          locale: "uk",
        },
      ]);
    });
  });

  describe("options", () => {
    it("requires the product's options to be allowed by its type", () => {
      const result = check(product({ optionCodes: ["color", "size", "width"] }));
      expect(result).toContainEqual({ code: "option_not_allowed", optionCode: "width" });
    });

    it("rejects any option on a type that allows none", () => {
      const result = check(product({ attributes: { tip_type: "ph2" } }), handTool);
      expect(result).toContainEqual({ code: "option_not_allowed", optionCode: "color" });
      expect(result).toContainEqual({ code: "option_not_allowed", optionCode: "size" });
    });
  });

  it("returns every violation at once", () => {
    const broken = product({
      slug: "",
      title: {},
      attributes: {},
      optionCodes: ["color", "width"],
      variants: [
        variant({ sku: "bad sku", isActive: false, attributes: {} }),
        variant({ sku: "bad sku", attributes: {} }),
      ],
    });
    const result = check(broken);
    const found = new Set(codes(result));
    for (const expected of [
      "title_invalid",
      "slug_missing",
      "multiple_default_variants",
      "missing_option_value",
      "unexpected_option_value",
      "duplicate_option_signature",
      "default_variant_inactive",
      "variant_sku_invalid",
      "duplicate_sku",
      "attribute_invalid",
      "option_not_allowed",
    ]) {
      expect(found.has(expected), expected).toBe(true);
    }
    expect(result.length).toBeGreaterThanOrEqual(11);
  });

  it("is deterministic and does not mutate frozen input", () => {
    const snapshot = deepFreeze(product({ attributes: {}, slug: "" }));
    const type = deepFreeze(clothing);
    const frozenConfig = deepFreeze({ defaultLocale: "uk", locales: ["uk", "en"] });
    const first = publishPreconditions(snapshot, type, frozenConfig);
    const second = publishPreconditions(snapshot, type, frozenConfig);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});
