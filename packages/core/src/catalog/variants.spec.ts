import { describe, expect, it } from "vitest";
import { CATALOG_LIMITS } from "./limits.js";
import { deepFreeze } from "./test-support.js";
import type { OptionValuePair } from "./types.js";
import {
  checkExactlyOneDefault,
  checkOptionCoverage,
  checkSignatureConsistency,
  checkUniqueSignatures,
  checkVariantInvariants,
  computeOptionSignature,
  generateVariants,
  type GenerateVariantsOption,
  type VariantInvariantInput,
} from "./variants.js";

function pair(optionCode: string, valueCode: string): OptionValuePair {
  return { optionCode, valueCode };
}

function range(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

describe("computeOptionSignature", () => {
  it("is the empty string for a product without options", () => {
    expect(computeOptionSignature([])).toBe("");
  });

  it("joins code=value pairs with a semicolon", () => {
    expect(computeOptionSignature([pair("color", "red")])).toBe("color=red");
    expect(computeOptionSignature([pair("color", "red"), pair("size", "m")])).toBe(
      "color=red;size=m",
    );
  });

  it("sorts by option code, so reordering options changes nothing", () => {
    const sorted = computeOptionSignature([
      pair("color", "black"),
      pair("size", "42"),
      pair("width", "wide"),
    ]);
    expect(sorted).toBe("color=black;size=42;width=wide");
    expect(
      computeOptionSignature([pair("width", "wide"), pair("color", "black"), pair("size", "42")]),
    ).toBe(sorted);
  });

  it("sorts by code point, not by locale", () => {
    expect(computeOptionSignature([pair("b", "1"), pair("a_b", "1"), pair("a", "1")])).toBe(
      "a=1;a_b=1;b=1",
    );
  });

  it("does not mutate its input", () => {
    const input = deepFreeze([pair("size", "m"), pair("color", "red")]);
    expect(computeOptionSignature(input)).toBe("color=red;size=m");
    expect(input.map((entry) => entry.optionCode)).toEqual(["size", "color"]);
  });
});

describe("generateVariants", () => {
  const color: GenerateVariantsOption = { code: "color", valueCodes: ["red", "black"] };
  const size: GenerateVariantsOption = { code: "size", valueCodes: ["s", "m", "l"] };

  it("creates exactly one default variant for a product without options", () => {
    expect(generateVariants({ options: [], existingSignatures: new Set() })).toEqual({
      ok: true,
      variants: [{ optionValues: [], optionSignature: "", isDefault: true }],
    });
  });

  it("creates nothing for a product without options that already has its variant", () => {
    expect(generateVariants({ options: [], existingSignatures: new Set([""]) })).toEqual({
      ok: true,
      variants: [],
    });
  });

  it("creates one variant per value for a single option", () => {
    const result = generateVariants({ options: [color], existingSignatures: new Set() });
    expect(result).toEqual({
      ok: true,
      variants: [
        { optionValues: [pair("color", "red")], optionSignature: "color=red", isDefault: true },
        {
          optionValues: [pair("color", "black")],
          optionSignature: "color=black",
          isDefault: false,
        },
      ],
    });
  });

  it("creates the cartesian product in a deterministic order (first option outermost)", () => {
    const result = generateVariants({ options: [color, size], existingSignatures: new Set() });
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.variants.map((variant) => variant.optionSignature)).toEqual([
      "color=red;size=s",
      "color=red;size=m",
      "color=red;size=l",
      "color=black;size=s",
      "color=black;size=m",
      "color=black;size=l",
    ]);
    expect(result.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
    expect(result.variants[0]?.isDefault).toBe(true);
    expect(result.variants[0]?.optionValues).toEqual([pair("color", "red"), pair("size", "s")]);
  });

  it("keeps the signature sorted by code even when options are given in another order", () => {
    const result = generateVariants({
      options: [size, color],
      existingSignatures: new Set(),
    });
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.variants[0]?.optionValues).toEqual([pair("size", "s"), pair("color", "red")]);
    expect(result.variants[0]?.optionSignature).toBe("color=red;size=s");
  });

  it("generates only the missing combinations and marks none as default", () => {
    const existing = new Set(["color=red;size=s", "color=red;size=m", "color=red;size=l"]);
    const result = generateVariants({ options: [color, size], existingSignatures: existing });
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.variants.map((variant) => variant.optionSignature)).toEqual([
      "color=black;size=s",
      "color=black;size=m",
      "color=black;size=l",
    ]);
    expect(result.variants.some((variant) => variant.isDefault)).toBe(false);
  });

  it("generates nothing when every combination exists", () => {
    const existing = new Set(["color=red", "color=black"]);
    expect(generateVariants({ options: [color], existingSignatures: existing })).toEqual({
      ok: true,
      variants: [],
    });
  });

  it("adding one value generates only the new combinations", () => {
    const widened: GenerateVariantsOption = {
      code: "color",
      valueCodes: ["red", "black", "white"],
    };
    const existing = new Set([
      "color=red;size=s",
      "color=red;size=m",
      "color=red;size=l",
      "color=black;size=s",
      "color=black;size=m",
      "color=black;size=l",
    ]);
    const result = generateVariants({ options: [widened, size], existingSignatures: existing });
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.variants).toHaveLength(3);
    expect(result.variants.map((variant) => variant.optionSignature)).toEqual([
      "color=white;size=s",
      "color=white;size=m",
      "color=white;size=l",
    ]);
  });

  it("accepts the maximum of 3 options and 250 variants (10 x 5 x 5)", () => {
    const result = generateVariants({
      options: [
        { code: "a", valueCodes: range("v", 10) },
        { code: "b", valueCodes: range("v", 5) },
        { code: "c", valueCodes: range("v", 5) },
      ],
      existingSignatures: new Set(),
    });
    expect(result.ok && result.variants.length).toBe(250);
  });

  it("accepts the scenario of 3 x 5 x 2 = 30 variants", () => {
    const result = generateVariants({
      options: [
        { code: "color", valueCodes: range("c", 3) },
        { code: "size", valueCodes: range("s", 5) },
        { code: "width", valueCodes: range("w", 2) },
      ],
      existingSignatures: new Set(),
    });
    expect(result.ok && result.variants.length).toBe(30);
  });

  describe("refusals (nothing is partially generated)", () => {
    it("refuses more than 3 options", () => {
      const options = ["a", "b", "c", "d"].map((code) => ({ code, valueCodes: ["x"] }));
      expect(generateVariants({ options, existingSignatures: new Set() })).toEqual({
        ok: false,
        errors: [{ reason: "too_many_options", limit: 3, actual: 4 }],
      });
    });

    it("refuses an option with an empty value list", () => {
      expect(
        generateVariants({
          options: [color, { code: "size", valueCodes: [] }],
          existingSignatures: new Set(),
        }),
      ).toEqual({ ok: false, errors: [{ reason: "empty_value_list", optionCode: "size" }] });
    });

    it("refuses more than 30 values for one option", () => {
      expect(
        generateVariants({
          options: [{ code: "size", valueCodes: range("s", 31) }],
          existingSignatures: new Set(),
        }),
      ).toEqual({
        ok: false,
        errors: [{ reason: "too_many_values", optionCode: "size", limit: 30, actual: 31 }],
      });
    });

    it("refuses duplicate option codes and duplicate value codes", () => {
      expect(
        generateVariants({
          options: [color, { code: "color", valueCodes: ["x"] }],
          existingSignatures: new Set(),
        }),
      ).toEqual({ ok: false, errors: [{ reason: "duplicate_option", optionCode: "color" }] });
      expect(
        generateVariants({
          options: [{ code: "color", valueCodes: ["red", "red"] }],
          existingSignatures: new Set(),
        }),
      ).toEqual({
        ok: false,
        errors: [{ reason: "duplicate_value", optionCode: "color", valueCode: "red" }],
      });
    });

    it("reports every structural error at once", () => {
      const result = generateVariants({
        options: [
          { code: "a", valueCodes: [] },
          { code: "b", valueCodes: range("v", 31) },
          { code: "c", valueCodes: ["x"] },
          { code: "d", valueCodes: ["x"] },
        ],
        existingSignatures: new Set(),
      });
      expect(result).toEqual({
        ok: false,
        errors: [
          { reason: "too_many_options", limit: 3, actual: 4 },
          { reason: "empty_value_list", optionCode: "a" },
          { reason: "too_many_values", optionCode: "b", limit: 30, actual: 31 },
        ],
      });
    });

    it("refuses a call that would create more than 250 new variants (30 x 30 x 30)", () => {
      expect(
        generateVariants({
          options: [
            { code: "a", valueCodes: range("v", 30) },
            { code: "b", valueCodes: range("v", 30) },
            { code: "c", valueCodes: range("v", 30) },
          ],
          existingSignatures: new Set(),
        }),
      ).toEqual({
        ok: false,
        errors: [{ reason: "too_many_new_variants", limit: 250, actual: 27000 }],
      });
    });

    it("refuses 251 variants", () => {
      expect(
        generateVariants({
          options: [{ code: "a", valueCodes: range("v", 251) }],
          existingSignatures: new Set(),
          limits: { maxValuesPerProductOption: 1000 },
        }),
      ).toEqual({
        ok: false,
        errors: [{ reason: "too_many_new_variants", limit: 250, actual: 251 }],
      });
    });

    it("refuses when existing plus new variants exceed the per-product total", () => {
      const existing = new Set(range("legacy", 245).map((name) => `old=${name}`));
      expect(
        generateVariants({
          options: [{ code: "size", valueCodes: range("s", 10) }],
          existingSignatures: existing,
        }),
      ).toEqual({
        ok: false,
        errors: [{ reason: "too_many_variants_total", limit: 250, actual: 255 }],
      });
    });

    it("accepts a result that lands exactly on the per-product total", () => {
      const existing = new Set(range("legacy", 245).map((name) => `old=${name}`));
      const result = generateVariants({
        options: [{ code: "size", valueCodes: range("s", 5) }],
        existingSignatures: existing,
      });
      expect(result.ok && result.variants.length).toBe(5);
    });

    it("honours custom limits", () => {
      expect(
        generateVariants({
          options: [color, size],
          existingSignatures: new Set(),
          limits: { maxNewVariantsPerGenerate: 5 },
        }),
      ).toEqual({
        ok: false,
        errors: [{ reason: "too_many_new_variants", limit: 5, actual: 6 }],
      });
      expect(
        generateVariants({
          options: [color, size],
          existingSignatures: new Set(),
          limits: { maxOptionsPerProduct: 1 },
        }),
      ).toEqual({ ok: false, errors: [{ reason: "too_many_options", limit: 1, actual: 2 }] });
    });

    it("uses the shared ADR limits by default", () => {
      expect(CATALOG_LIMITS.maxOptionsPerProduct).toBe(3);
      expect(CATALOG_LIMITS.maxValuesPerProductOption).toBe(30);
    });
  });

  it("is deterministic and does not mutate frozen input or the existing set", () => {
    const options = deepFreeze([
      { code: "color", valueCodes: ["red", "black"] },
      { code: "size", valueCodes: ["s", "m"] },
    ]);
    const existing = new Set(["color=red;size=s"]);
    const first = generateVariants({ options, existingSignatures: existing });
    const second = generateVariants({ options, existingSignatures: existing });
    expect(second).toEqual(first);
    expect([...existing]).toEqual(["color=red;size=s"]);
    expect(first.ok && first.variants).toHaveLength(3);
  });
});

describe("variant invariants", () => {
  const red: VariantInvariantInput = {
    isDefault: true,
    optionSignature: "color=red",
    optionValues: [pair("color", "red")],
  };
  const black: VariantInvariantInput = {
    isDefault: false,
    optionSignature: "color=black",
    optionValues: [pair("color", "black")],
  };
  const simple: VariantInvariantInput = { isDefault: true, optionSignature: "", optionValues: [] };

  describe("checkExactlyOneDefault", () => {
    it("accepts exactly one default", () => {
      expect(checkExactlyOneDefault([red, black])).toEqual([]);
    });

    it("reports none and several defaults", () => {
      expect(checkExactlyOneDefault([{ ...red, isDefault: false }, black])).toEqual([
        { code: "no_default_variant" },
      ]);
      expect(checkExactlyOneDefault([])).toEqual([{ code: "no_default_variant" }]);
      expect(checkExactlyOneDefault([red, { ...black, isDefault: true }])).toEqual([
        { code: "multiple_default_variants", variantIndex: 0 },
        { code: "multiple_default_variants", variantIndex: 1 },
      ]);
    });
  });

  describe("checkOptionCoverage", () => {
    it("accepts full coverage and the option-less simple product", () => {
      expect(checkOptionCoverage(["color"], [red, black])).toEqual([]);
      expect(checkOptionCoverage([], [simple])).toEqual([]);
    });

    it("reports a missing value", () => {
      expect(checkOptionCoverage(["color", "size"], [red])).toEqual([
        { code: "missing_option_value", variantIndex: 0, optionCode: "size" },
      ]);
    });

    it("reports a value for an option the product does not use", () => {
      expect(checkOptionCoverage([], [red])).toEqual([
        { code: "unexpected_option_value", variantIndex: 0, optionCode: "color" },
      ]);
    });

    it("reports two values for the same option", () => {
      const twice: VariantInvariantInput = {
        ...red,
        optionValues: [pair("color", "red"), pair("color", "black")],
      };
      expect(checkOptionCoverage(["color"], [twice])).toEqual([
        { code: "duplicate_option_value", variantIndex: 0, optionCode: "color" },
      ]);
    });
  });

  describe("checkUniqueSignatures", () => {
    it("accepts distinct signatures", () => {
      expect(checkUniqueSignatures([red, black])).toEqual([]);
    });

    it("reports every repeat after the first occurrence", () => {
      expect(checkUniqueSignatures([red, black, { ...black, isDefault: false }])).toEqual([
        { code: "duplicate_option_signature", variantIndex: 2, signature: "color=black" },
      ]);
    });

    it("rejects a second variant for a product without options", () => {
      expect(checkUniqueSignatures([simple, { ...simple, isDefault: false }])).toEqual([
        { code: "duplicate_option_signature", variantIndex: 1, signature: "" },
      ]);
    });
  });

  describe("checkSignatureConsistency", () => {
    it("accepts a signature computed from the option values", () => {
      const two: VariantInvariantInput = {
        isDefault: false,
        optionSignature: "color=red;size=m",
        optionValues: [pair("size", "m"), pair("color", "red")],
      };
      expect(checkSignatureConsistency([red, simple, two])).toEqual([]);
    });

    it("reports a stale or wrong signature", () => {
      expect(checkSignatureConsistency([red, { ...black, optionSignature: "color=red" }])).toEqual([
        { code: "signature_mismatch", variantIndex: 1, signature: "color=red" },
      ]);
    });
  });

  describe("checkVariantInvariants", () => {
    it("accepts a consistent set", () => {
      expect(checkVariantInvariants(["color"], [red, black])).toEqual([]);
      expect(checkVariantInvariants([], [simple])).toEqual([]);
    });

    it("reports no_variants once for an empty list", () => {
      expect(checkVariantInvariants(["color"], [])).toEqual([{ code: "no_variants" }]);
    });

    it("aggregates every violation", () => {
      const broken: VariantInvariantInput = {
        isDefault: true,
        optionSignature: "color=blue",
        optionValues: [],
      };
      const codes = checkVariantInvariants(["color"], [red, broken]).map((v) => v.code);
      expect(codes).toEqual([
        "multiple_default_variants",
        "multiple_default_variants",
        "missing_option_value",
        "signature_mismatch",
      ]);
    });

    it("does not mutate frozen input and is deterministic", () => {
      const variants = deepFreeze([red, black]);
      const options = deepFreeze(["color"]);
      expect(checkVariantInvariants(options, variants)).toEqual(
        checkVariantInvariants(options, variants),
      );
    });
  });
});
