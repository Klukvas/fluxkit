import { describe, expect, it } from "vitest";
import { ATTRIBUTE_VALIDATION_DEFAULTS, CATALOG_LIMITS, TEXT_LIMITS } from "./limits.js";

describe("CATALOG_LIMITS (ADR 0006 section 9)", () => {
  it("matches the accepted values", () => {
    expect(CATALOG_LIMITS).toEqual({
      maxOptionsPerProduct: 3,
      maxValuesPerProductOption: 30,
      maxVariantsPerProduct: 250,
      maxNewVariantsPerGenerate: 250,
      maxCategoryDepth: 5,
      maxAttributesPerProductType: 100,
      maxOptionsPerAttribute: 500,
      maxValuesPerOption: 500,
      defaultPageSize: 24,
      maxPageSize: 100,
      maxOffset: 10000,
    });
  });

  it("is frozen so a caller cannot change a limit at runtime", () => {
    expect(Object.isFrozen(CATALOG_LIMITS)).toBe(true);
    expect(Object.isFrozen(TEXT_LIMITS)).toBe(true);
    expect(Object.isFrozen(ATTRIBUTE_VALIDATION_DEFAULTS)).toBe(true);
  });
});

describe("TEXT_LIMITS", () => {
  it("matches the accepted values", () => {
    expect(TEXT_LIMITS).toEqual({
      code: 64,
      slug: 160,
      sku: 64,
      barcode: 64,
      url: 2048,
      title: 255,
      name: 255,
      label: 255,
      description: 20000,
      alt: 255,
      unit: 16,
      attributesJsonBytes: 65536,
    });
  });
});

describe("ATTRIBUTE_VALIDATION_DEFAULTS (ADR 0006 section 4)", () => {
  it("matches the documented defaults", () => {
    expect(ATTRIBUTE_VALIDATION_DEFAULTS).toEqual({
      minLength: 1,
      maxLength: 1000,
      maxDecimals: 3,
      minItems: 1,
      maxItems: 50,
    });
  });
});
