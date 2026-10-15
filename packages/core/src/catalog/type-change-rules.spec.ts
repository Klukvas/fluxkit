import { describe, expect, it } from "vitest";
import {
  decideChangeProductType,
  decideCodeChange,
  decideDeleteAttribute,
  decideDeleteAttributeOption,
  decideDeleteOption,
  decideDeleteOptionValue,
  decideDeleteProductType,
  decideInputTypeChange,
  decideLevelChange,
  decideLocalizationChange,
  decideProductOptionChange,
  decideRemoveAttributeFromType,
  decideRemoveOptionFromType,
  decideRemoveProductOptionValue,
  decideUnitChange,
  type TypeChangeDecision,
  type TypeChangeReason,
} from "./type-change-rules.js";
import { deepFreeze } from "./test-support.js";
import type { ProductStatus } from "./types.js";

const allowed: TypeChangeDecision = { allowed: true };
function forbidden(reason: TypeChangeReason): TypeChangeDecision {
  return { allowed: false, reason };
}

describe("rename of a code (attribute, attribute option, option, option value, product type)", () => {
  it("is allowed only when the code does not change", () => {
    expect(decideCodeChange({ currentCode: "color", nextCode: "color" })).toEqual(allowed);
  });

  it.each([
    ["color", "colour"],
    ["color", "Color"],
    ["color", ""],
  ])("forbids %s -> %s, always", (currentCode, nextCode) => {
    expect(decideCodeChange({ currentCode, nextCode })).toEqual(forbidden("code_immutable"));
  });
});

describe("attribute input_type and is_localized", () => {
  it("allows an unchanged input type and forbids every change", () => {
    expect(decideInputTypeChange({ current: "text", next: "text" })).toEqual(allowed);
    const types = ["text", "number", "boolean", "select", "multiselect", "date"] as const;
    for (const current of types) {
      for (const next of types) {
        expect(decideInputTypeChange({ current, next })).toEqual(
          current === next ? allowed : forbidden("input_type_immutable"),
        );
      }
    }
  });

  it("allows an unchanged is_localized and forbids a flip in both directions", () => {
    expect(decideLocalizationChange({ current: true, next: true })).toEqual(allowed);
    expect(decideLocalizationChange({ current: false, next: false })).toEqual(allowed);
    expect(decideLocalizationChange({ current: false, next: true })).toEqual(
      forbidden("is_localized_immutable"),
    );
    expect(decideLocalizationChange({ current: true, next: false })).toEqual(
      forbidden("is_localized_immutable"),
    );
  });
});

describe("attribute unit", () => {
  it.each([
    ["mm", "cm", false, allowed],
    ["mm", "cm", true, forbidden("unit_in_use")],
    [null, "kg", false, allowed],
    [null, "kg", true, forbidden("unit_in_use")],
    ["kg", null, true, forbidden("unit_in_use")],
    ["kg", null, false, allowed],
    ["mm", "mm", true, allowed],
    [null, null, true, allowed],
  ] as const)("%s -> %s with valuesExist=%s", (currentUnit, nextUnit, valuesExist, expected) => {
    expect(decideUnitChange({ currentUnit, nextUnit }, { valuesExist })).toEqual(expected);
  });
});

describe("level of an assigned attribute", () => {
  it.each([
    ["product", "variant", false, allowed],
    ["variant", "product", false, allowed],
    ["product", "variant", true, forbidden("level_in_use")],
    ["variant", "product", true, forbidden("level_in_use")],
    ["product", "product", true, allowed],
    ["variant", "variant", false, allowed],
  ] as const)("%s -> %s with valuesExist=%s", (currentLevel, nextLevel, valuesExist, expected) => {
    expect(decideLevelChange({ currentLevel, nextLevel }, { valuesExist })).toEqual(expected);
  });
});

describe("removing an attribute from a product type", () => {
  it("is allowed only while no product or variant of that type has a value", () => {
    expect(decideRemoveAttributeFromType({ valuesExist: false })).toEqual(allowed);
    expect(decideRemoveAttributeFromType({ valuesExist: true })).toEqual(
      forbidden("attribute_assignment_in_use"),
    );
  });
});

describe("deleting an attribute option", () => {
  it("is allowed only when no value uses the code", () => {
    expect(decideDeleteAttributeOption({ valuesUseCode: false })).toEqual(allowed);
    expect(decideDeleteAttributeOption({ valuesUseCode: true })).toEqual(
      forbidden("attribute_option_in_use"),
    );
  });
});

describe("deleting an option value", () => {
  it("is blocked while a product has chosen it", () => {
    expect(decideDeleteOptionValue({ usedByProducts: false })).toEqual(allowed);
    expect(decideDeleteOptionValue({ usedByProducts: true })).toEqual(
      forbidden("option_value_in_use"),
    );
  });
});

describe("deleting an attribute, an option or a product type", () => {
  it("blocks an attribute assigned to any product type", () => {
    expect(decideDeleteAttribute({ assignedToProductTypes: false })).toEqual(allowed);
    expect(decideDeleteAttribute({ assignedToProductTypes: true })).toEqual(
      forbidden("attribute_assigned"),
    );
  });

  it("blocks an option assigned to a product type or used by a product", () => {
    expect(decideDeleteOption({ assignedToProductTypes: false, usedByProducts: false })).toEqual(
      allowed,
    );
    expect(decideDeleteOption({ assignedToProductTypes: true, usedByProducts: false })).toEqual(
      forbidden("option_assigned_to_product_type"),
    );
    expect(decideDeleteOption({ assignedToProductTypes: false, usedByProducts: true })).toEqual(
      forbidden("option_in_use_by_products"),
    );
    expect(decideDeleteOption({ assignedToProductTypes: true, usedByProducts: true })).toEqual(
      forbidden("option_assigned_to_product_type"),
    );
  });

  it("blocks a product type that has products", () => {
    expect(decideDeleteProductType({ hasProducts: false })).toEqual(allowed);
    expect(decideDeleteProductType({ hasProducts: true })).toEqual(forbidden("product_type_in_use"));
  });
});

describe("removing an option from a product type", () => {
  it("is allowed only when no product of that type uses it", () => {
    expect(decideRemoveOptionFromType({ usedByProducts: false })).toEqual(allowed);
    expect(decideRemoveOptionFromType({ usedByProducts: true })).toEqual(
      forbidden("option_in_use_by_products"),
    );
  });
});

describe("changing product.product_type_id", () => {
  it("is forbidden after creation, allowed only as a no-op", () => {
    expect(decideChangeProductType({ currentId: "t1", nextId: "t1" })).toEqual(allowed);
    expect(decideChangeProductType({ currentId: "t1", nextId: "t2" })).toEqual(
      forbidden("product_type_immutable"),
    );
  });
});

describe("adding or removing a product option, by product status", () => {
  const cases: readonly (readonly [ProductStatus, TypeChangeDecision])[] = [
    ["draft", allowed],
    ["active", forbidden("product_options_frozen")],
    ["archived", forbidden("product_options_frozen")],
  ];

  it.each(cases)("status %s", (productStatus, expected) => {
    expect(decideProductOptionChange({ productStatus })).toEqual(expected);
  });
});

describe("removing a product option value", () => {
  it("is blocked while a variant or media uses it", () => {
    expect(decideRemoveProductOptionValue({ usedByVariantsOrMedia: false })).toEqual(allowed);
    expect(decideRemoveProductOptionValue({ usedByVariantsOrMedia: true })).toEqual(
      forbidden("product_option_value_in_use"),
    );
  });
});

describe("purity", () => {
  it("does not mutate frozen input and returns equal results on repeat calls", () => {
    const input = deepFreeze({ currentUnit: "mm" as string | null, nextUnit: "cm" as string | null });
    const facts = deepFreeze({ valuesExist: true });
    const first = decideUnitChange(input, facts);
    expect(decideUnitChange(input, facts)).toEqual(first);
    expect(input).toEqual({ currentUnit: "mm", nextUnit: "cm" });
  });
});
