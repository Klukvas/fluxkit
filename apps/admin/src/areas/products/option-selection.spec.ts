import type { AdminProductMedia, AdminProductOption, ProblemDetails } from "@fluxkit/api-client";
import { CATALOG_LIMITS, planProductOptionChange } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  MAX_OPTIONS_PER_PRODUCT,
  MAX_VALUES_PER_OPTION,
  MAX_VARIANTS_PER_PRODUCT,
  OPTION_REASONS,
  addableValues,
  mediaUsingRemovedValues,
  optionErrorsFromProblem,
  optionReason,
  planOptionChange,
  selectionBody,
  selectionFrom,
  selectionOrder,
  setOptionUsed,
  setValueChosen,
  validateSelection,
  variantCount,
  type OptionSelection,
} from "./option-selection";

/** The product uses option B (values b2, b1, in that stored order) then option A (a1). */
const stored: AdminProductOption[] = [
  {
    optionId: "A",
    optionCode: "axis_a",
    position: 1,
    values: [{ optionValueId: "a1", valueCode: "a_one", position: 0 }],
  },
  {
    optionId: "B",
    optionCode: "axis_b",
    position: 0,
    values: [
      { optionValueId: "b1", valueCode: "b_one", position: 1 },
      { optionValueId: "b2", valueCode: "b_two", position: 0 },
    ],
  },
];

/** The product type allows A, B and C, by its own position; each option's values by their position. */
const definitions = [
  { optionId: "A", valueIds: ["a1", "a2", "a3"] },
  { optionId: "B", valueIds: ["b1", "b2", "b3"] },
  { optionId: "C", valueIds: ["c1", "c2"] },
];

const order = selectionOrder(stored, definitions);
const current = selectionFrom(stored);

describe("the product's option selection", () => {
  it("is read in stored order: options by position, values by position", () => {
    expect(current).toEqual([
      { optionId: "B", valueIds: ["b2", "b1"] },
      { optionId: "A", valueIds: ["a1"] },
    ]);
  });

  it("orders the stored options and values first, then the others in the type's order", () => {
    expect(order.optionIds).toEqual(["B", "A", "C"]);
    expect(order.valueIds["B"]).toEqual(["b2", "b1", "b3"]);
    expect(order.valueIds["A"]).toEqual(["a1", "a2", "a3"]);
    expect(order.valueIds["C"]).toEqual(["c1", "c2"]);
  });

  it("uses the core limits", () => {
    expect(MAX_OPTIONS_PER_PRODUCT).toBe(CATALOG_LIMITS.maxOptionsPerProduct);
    expect(MAX_VALUES_PER_OPTION).toBe(CATALOG_LIMITS.maxValuesPerProductOption);
    expect(MAX_VARIANTS_PER_PRODUCT).toBe(CATALOG_LIMITS.maxVariantsPerProduct);
  });
});

describe("editing the selection", () => {
  it("turns an option on (no values yet) and off", () => {
    const on = setOptionUsed(current, "C", true);
    expect(on.map((entry) => entry.optionId)).toEqual(["B", "A", "C"]);
    expect(on[2]?.valueIds).toEqual([]);
    expect(setOptionUsed(on, "C", true)).toBe(on);
    expect(setOptionUsed(on, "A", false).map((entry) => entry.optionId)).toEqual(["B", "C"]);
  });

  it("chooses and drops values; choosing a value turns its option on", () => {
    const more = setValueChosen(current, "A", "a3", true);
    expect(more[1]?.valueIds).toEqual(["a1", "a3"]);
    expect(setValueChosen(more, "A", "a3", true)).toBe(more);
    expect(setValueChosen(more, "A", "a1", false)[1]?.valueIds).toEqual(["a3"]);
    expect(setValueChosen(current, "C", "c2", true)[2]).toEqual({
      optionId: "C",
      valueIds: ["c2"],
    });
  });

  it("builds the PUT body in a stable order, so dropping and choosing again is no change", () => {
    expect(selectionBody(current, order)).toEqual({
      options: [
        { optionId: "B", valueIds: ["b2", "b1"] },
        { optionId: "A", valueIds: ["a1"] },
      ],
    });
    const again = setValueChosen(setValueChosen(current, "B", "b2", false), "B", "b2", true);
    expect(selectionBody(again, order)).toEqual(selectionBody(current, order));
    const added = setValueChosen(setValueChosen(current, "C", "c2", true), "C", "c1", true);
    expect(selectionBody(added, order).options[2]).toEqual({
      optionId: "C",
      valueIds: ["c1", "c2"],
    });
    expect(selectionBody([], order)).toEqual({ options: [] });
  });

  it("offers on a live product only the option's values the product has not chosen", () => {
    expect(addableValues(["a1", "a2", "a3"], ["a1"])).toEqual(["a2", "a3"]);
    expect(addableValues(["a1"], ["a1"])).toEqual([]);
  });
});

describe("checks before the replace", () => {
  it("accepts the stored selection and no options at all", () => {
    expect(validateSelection(current)).toEqual({});
    expect(validateSelection([])).toEqual({});
  });

  it("refuses an option without values, more than 3 options, more than 30 values, more than 250 variants", () => {
    expect(validateSelection(setOptionUsed(current, "C", true))["options.C"]).toEqual({
      key: "products.optionReason.empty_value_list",
    });
    const four: OptionSelection = [
      ...current,
      { optionId: "C", valueIds: ["c1"] },
      { optionId: "D", valueIds: ["d1"] },
    ];
    expect(validateSelection(four)["options"]).toEqual({ key: "errors.reason.too_many_options" });
    const many = Array.from({ length: 31 }, (_, index) => `v${index}`);
    expect(validateSelection([{ optionId: "A", valueIds: many }])["options.A"]).toEqual({
      key: "products.optionReason.too_many_values",
    });
    const wide = Array.from({ length: 16 }, (_, index) => `v${index}`);
    expect(
      validateSelection([
        { optionId: "A", valueIds: wide },
        { optionId: "B", valueIds: wide },
      ])["options"],
    ).toEqual({ key: "products.optionReason.too_many_variants_total" });
  });

  it("counts the variants the selection makes (one for no options)", () => {
    expect(variantCount([])).toBe(1);
    expect(variantCount(current)).toBe(2);
    expect(variantCount(setValueChosen(current, "A", "a2", true))).toBe(4);
  });
});

describe("what a replace does to the variants (the API's rules, compared with core)", () => {
  function both(desired: OptionSelection) {
    const plan = planOptionChange(current, desired);
    const core = planProductOptionChange({
      productStatus: "draft",
      current,
      desired,
      allowedOptionIds: ["A", "B", "C"],
    });
    if (!core.ok) throw new Error("core refused");
    expect(plan.addedOptionIds).toEqual(core.plan.addedOptionIds);
    expect(plan.removedOptionIds).toEqual(core.plan.removedOptionIds);
    expect(plan.addedValues).toEqual(core.plan.addedValues);
    expect(plan.removedValues).toEqual(core.plan.removedValues);
    expect(plan.hasChanges).toBe(core.plan.hasChanges);
    return plan;
  }

  it("only new values of used options: the variants stay and the new combinations are added", () => {
    const plan = both(setValueChosen(current, "A", "a2", true));
    expect(plan.rebuildsVariants).toBe(false);
    expect(plan.hasChanges).toBe(true);
  });

  it("a removed value, an added option or a removed option rebuilds every variant", () => {
    expect(both(setValueChosen(current, "B", "b1", false)).rebuildsVariants).toBe(true);
    expect(both(setValueChosen(current, "C", "c1", true)).rebuildsVariants).toBe(true);
    expect(both(setOptionUsed(current, "A", false)).rebuildsVariants).toBe(true);
  });

  it("no change is no change", () => {
    const plan = both(current);
    expect(plan.hasChanges).toBe(false);
    expect(plan.rebuildsVariants).toBe(false);
  });

  it("names the images that still link a value the change removes (the API answers in_use)", () => {
    const media = [
      { optionId: "B", optionValueId: "b1" },
      { optionId: null, optionValueId: null },
      { optionId: "A", optionValueId: "a1" },
    ] as AdminProductMedia[];
    expect(
      mediaUsingRemovedValues(
        planOptionChange(current, setValueChosen(current, "B", "b1", false)),
        media,
      ),
    ).toEqual([0]);
    expect(
      mediaUsingRemovedValues(planOptionChange(current, setOptionUsed(current, "A", false)), media),
    ).toEqual([2]);
    expect(mediaUsingRemovedValues(planOptionChange(current, current), media)).toEqual([]);
  });
});

describe("refusals of the replace on the form", () => {
  const body = selectionBody(setOptionUsed(current, "C", true), order);
  const problem = (errors: { path: string; code: string }[]): ProblemDetails => ({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "validation_failed",
    detail: "x",
    errors,
  });

  it("puts options.<i> and options.<i>.valueIds.<j> on the option they name, the rest in the summary", () => {
    const mapped = optionErrorsFromProblem(
      problem([
        { path: "options.2", code: "empty_value_list" },
        { path: "options.0.valueIds.1", code: "duplicate_value" },
        { path: "options", code: "too_many_options" },
        { path: "variants", code: "too_many_variants_total" },
      ]),
      body,
    );
    expect(mapped.fields).toEqual({
      "options.C": { key: "products.optionReason.empty_value_list" },
      "options.B": { key: "errors.reason.duplicate_value" },
    });
    expect(mapped.other).toEqual([
      { key: "errors.reason.too_many_options" },
      { key: "products.optionReason.too_many_variants_total" },
    ]);
  });

  it("explains a refusal without field errors (options_frozen, has_stock_history, in_use) in the summary", () => {
    const frozen = optionErrorsFromProblem(
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "rule_violation",
        rule: "options_frozen",
        detail: "x",
      },
      body,
    );
    expect(frozen).toEqual({ fields: {}, other: [{ key: "errors.reason.options_frozen" }] });
    const history = optionErrorsFromProblem(
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "rule_violation",
        rule: "has_stock_history",
        detail: "x",
      },
      body,
    );
    expect(history.other).toEqual([{ key: "errors.reason.has_stock_history" }]);
  });

  it("has a message for each option reason the problem map does not know", () => {
    expect(OPTION_REASONS).toContain("empty_value_list");
    expect(optionReason("duplicate_option")).toEqual({
      key: "products.optionReason.duplicate_option",
    });
    expect(optionReason("option_not_allowed")).toEqual({
      key: "errors.reason.option_not_allowed",
    });
    expect(optionReason("brand_new")).toEqual({ key: "errors.generic", code: "brand_new" });
  });
});
