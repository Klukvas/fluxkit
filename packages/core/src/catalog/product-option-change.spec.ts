import { describe, expect, it } from "vitest";
import {
  planProductOptionChange,
  type PlanProductOptionChangeInput,
  type ProductOptionChangeError,
  type ProductOptionSelection,
} from "./product-option-change.js";
import { deepFreeze } from "./test-support.js";
import type { ProductStatus } from "./types.js";

const ALLOWED = ["color", "size", "fit", "material"] as const;

function plan(
  productStatus: ProductStatus,
  current: readonly ProductOptionSelection[],
  desired: readonly ProductOptionSelection[],
  extra: Partial<PlanProductOptionChangeInput> = {},
) {
  return planProductOptionChange({
    productStatus,
    current,
    desired,
    allowedOptionIds: ALLOWED,
    ...extra,
  });
}

function errorsOf(result: ReturnType<typeof plan>): readonly ProductOptionChangeError[] {
  return result.ok ? [] : result.errors;
}

const color = (...valueIds: string[]): ProductOptionSelection => ({ optionId: "color", valueIds });
const size = (...valueIds: string[]): ProductOptionSelection => ({ optionId: "size", valueIds });

describe("planProductOptionChange in draft", () => {
  it("reports no changes and no regeneration for identical selections", () => {
    const result = plan("draft", [color("red", "blue")], [color("blue", "red")]);
    expect(result).toEqual({
      ok: true,
      plan: {
        hasChanges: false,
        regeneratesAllVariants: false,
        addedOptionIds: [],
        removedOptionIds: [],
        addedValues: [],
        removedValues: [],
      },
    });
  });

  it("allows adding an option and asks for a full regeneration", () => {
    const result = plan("draft", [color("red")], [color("red"), size("m", "l")]);
    expect(result).toEqual({
      ok: true,
      plan: {
        hasChanges: true,
        regeneratesAllVariants: true,
        addedOptionIds: ["size"],
        removedOptionIds: [],
        addedValues: [{ optionId: "size", valueIds: ["m", "l"] }],
        removedValues: [],
      },
    });
  });

  it("allows removing an option", () => {
    const result = plan("draft", [color("red"), size("m")], [color("red")]);
    expect(result.ok && result.plan.removedOptionIds).toEqual(["size"]);
    expect(result.ok && result.plan.removedValues).toEqual([{ optionId: "size", valueIds: ["m"] }]);
    expect(result.ok && result.plan.regeneratesAllVariants).toBe(true);
  });

  it("allows removing and adding values of an existing option", () => {
    const result = plan("draft", [color("red", "blue")], [color("blue", "green")]);
    expect(result.ok && result.plan.addedValues).toEqual([{ optionId: "color", valueIds: ["green"] }]);
    expect(result.ok && result.plan.removedValues).toEqual([{ optionId: "color", valueIds: ["red"] }]);
    expect(result.ok && result.plan.addedOptionIds).toEqual([]);
  });

  it("allows turning a product with options into a simple product", () => {
    const result = plan("draft", [color("red")], []);
    expect(result.ok && result.plan.removedOptionIds).toEqual(["color"]);
  });

  it("allows starting from no options", () => {
    expect(plan("draft", [], [color("red")]).ok).toBe(true);
    expect(plan("draft", [], []).ok).toBe(true);
  });
});

describe.each(["active", "archived"] as const)("planProductOptionChange in %s", (status) => {
  it("allows adding values to an existing option without regenerating everything", () => {
    const result = plan(status, [color("red")], [color("red", "blue")]);
    expect(result).toEqual({
      ok: true,
      plan: {
        hasChanges: true,
        regeneratesAllVariants: false,
        addedOptionIds: [],
        removedOptionIds: [],
        addedValues: [{ optionId: "color", valueIds: ["blue"] }],
        removedValues: [],
      },
    });
  });

  it("allows an unchanged selection", () => {
    expect(plan(status, [color("red")], [color("red")]).ok).toBe(true);
  });

  it("refuses to add an option", () => {
    expect(errorsOf(plan(status, [color("red")], [color("red"), size("m")]))).toEqual([
      { reason: "options_frozen", optionId: "size" },
    ]);
  });

  it("refuses to remove an option", () => {
    expect(errorsOf(plan(status, [color("red"), size("m")], [color("red")]))).toEqual([
      { reason: "options_frozen", optionId: "size" },
    ]);
  });

  it("refuses to remove a value", () => {
    expect(errorsOf(plan(status, [color("red", "blue")], [color("red")]))).toEqual([
      { reason: "options_frozen", optionId: "color", valueId: "blue" },
    ]);
  });

  it("refuses replacing a value even when the count stays the same", () => {
    expect(errorsOf(plan(status, [color("red")], [color("blue")]))).toEqual([
      { reason: "options_frozen", optionId: "color", valueId: "red" },
    ]);
  });
});

describe("planProductOptionChange validation", () => {
  it("refuses an option that the product type does not allow, in every status", () => {
    for (const status of ["draft", "active", "archived"] as const) {
      expect(
        errorsOf(plan(status, [color("red")], [color("red"), { optionId: "weight", valueIds: ["x"] }])),
      ).toContainEqual({ reason: "option_not_allowed", optionId: "weight" });
    }
  });

  it("does not complain about a current option that stays removed", () => {
    expect(plan("draft", [{ optionId: "legacy", valueIds: ["a"] }], [color("red")]).ok).toBe(true);
  });

  it("refuses more than 3 options", () => {
    const result = plan("draft", [], [color("a"), size("a"), { optionId: "fit", valueIds: ["a"] }, { optionId: "material", valueIds: ["a"] }]);
    expect(errorsOf(result)).toContainEqual({ reason: "too_many_options", limit: 3, actual: 4 });
  });

  it("allows exactly 3 options", () => {
    expect(
      plan("draft", [], [color("a"), size("a"), { optionId: "fit", valueIds: ["a"] }]).ok,
    ).toBe(true);
  });

  it("refuses an option with no values", () => {
    expect(errorsOf(plan("draft", [], [color()]))).toContainEqual({
      reason: "empty_value_list",
      optionId: "color",
    });
  });

  it("refuses more than 30 values and allows exactly 30", () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => `v${index}`);
    expect(errorsOf(plan("draft", [], [color(...many(31))]))).toContainEqual({
      reason: "too_many_values",
      optionId: "color",
      limit: 30,
      actual: 31,
    });
    expect(plan("draft", [], [color(...many(30))]).ok).toBe(true);
  });

  it("refuses duplicate options and duplicate values", () => {
    const errors = errorsOf(plan("draft", [], [color("a", "a"), color("b")]));
    expect(errors).toContainEqual({ reason: "duplicate_value", optionId: "color", valueId: "a" });
    expect(errors).toContainEqual({ reason: "duplicate_option", optionId: "color" });
  });

  it("respects custom limits", () => {
    const result = plan("draft", [], [color("a", "b"), size("a")], {
      limits: { maxOptionsPerProduct: 1, maxValuesPerProductOption: 1 },
    });
    const reasons = errorsOf(result).map((error) => error.reason);
    expect(reasons).toContain("too_many_options");
    expect(reasons).toContain("too_many_values");
  });

  it("ignores undefined custom limits", () => {
    const result = plan("draft", [], [color("a")], {
      limits: { maxOptionsPerProduct: undefined },
    });
    expect(result.ok).toBe(true);
  });

  it("reports validation errors before frozen-status errors", () => {
    const reasons = errorsOf(plan("active", [color("red")], [size()])).map((error) => error.reason);
    expect(reasons).toContain("empty_value_list");
    expect(reasons).not.toContain("options_frozen");
  });
});

describe("planProductOptionChange purity", () => {
  it("does not mutate frozen input and returns equal results", () => {
    const input = deepFreeze({
      productStatus: "active" as const,
      current: [color("red")],
      desired: [color("red", "blue")],
      allowedOptionIds: [...ALLOWED],
    });
    expect(planProductOptionChange(input)).toEqual(planProductOptionChange(input));
  });
});
