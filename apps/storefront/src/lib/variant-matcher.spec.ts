import { describe, expect, it } from "vitest";
import { option, product, variant } from "./test-fixtures";
import {
  findVariant,
  hasOptionPicker,
  initialSelection,
  isValueAvailable,
  selectValue,
  selectedValueIds,
} from "./variant-matcher";

// A grid with a hole: (red, l) is not sellable, so it is not in the variant list.
const shirt = product({
  options: [option("color", ["black", "red"]), option("size", ["s", "m", "l"])],
  variants: [
    variant("black-s", { color: "black", size: "s" }),
    variant("black-m", { color: "black", size: "m" }),
    variant("black-l", { color: "black", size: "l" }),
    variant("red-s", { color: "red", size: "s" }),
    variant("red-m", { color: "red", size: "m" }),
  ],
});

// A sparse product: only two real combinations, none shares a value.
const sparse = product({
  options: [option("flavor", ["mint", "lemon"]), option("pack", ["six", "twelve"])],
  variants: [
    variant("mint-six", { flavor: "mint", pack: "six" }),
    variant("lemon-twelve", { flavor: "lemon", pack: "twelve" }),
  ],
});

describe("findVariant", () => {
  it("returns the variant whose option values equal the selection, whatever the order of its values", () => {
    expect(findVariant(shirt, { color: "red", size: "m" })?.id).toBe("red-m");
    const reversed = product({
      options: shirt.options,
      variants: [
        {
          ...variant("x", {}),
          optionValues: [
            { optionCode: "size", valueCode: "m" },
            { optionCode: "color", valueCode: "red" },
          ],
        },
      ],
    });
    expect(findVariant(reversed, { color: "red", size: "m" })?.id).toBe("x");
  });

  it("returns null for a combination that has no sellable variant", () => {
    expect(findVariant(shirt, { color: "red", size: "l" })).toBeNull();
  });

  it("returns null while the selection is incomplete or names an unknown value", () => {
    expect(findVariant(shirt, { color: "red" })).toBeNull();
    expect(findVariant(shirt, {})).toBeNull();
    expect(findVariant(shirt, { color: "red", size: "xxl" })).toBeNull();
  });

  it("never matches a variant by a partial overlap", () => {
    // (black, s) shares `color` with (black, m) but must not answer for (black, xl).
    expect(findVariant(shirt, { color: "black", size: "xl" })).toBeNull();
  });

  it("works for any niche: the codes are data, not 'size' or 'color'", () => {
    expect(findVariant(sparse, { flavor: "lemon", pack: "twelve" })?.id).toBe("lemon-twelve");
    expect(findVariant(sparse, { flavor: "lemon", pack: "six" })).toBeNull();
  });

  it("returns the only variant of a product without options (the default variant)", () => {
    const simple = product();
    expect(findVariant(simple, {})?.id).toBe("v1");
  });

  it("returns null for a product without options that somehow lists several variants", () => {
    const odd = product({ variants: [variant("a", {}), variant("b", {})] });
    expect(findVariant(odd, {})).toBeNull();
  });
});

describe("hasOptionPicker", () => {
  it("is false for a product with one default variant and no options, true otherwise", () => {
    expect(hasOptionPicker(product())).toBe(false);
    expect(hasOptionPicker(shirt)).toBe(true);
  });
});

describe("initialSelection", () => {
  it("selects the first variant that is not out of stock", () => {
    const stocked = product({
      options: shirt.options,
      variants: [
        variant("black-s", { color: "black", size: "s" }, { availability: "out_of_stock" }),
        variant("black-m", { color: "black", size: "m" }, { availability: "low_stock" }),
      ],
    });
    expect(initialSelection(stocked)).toEqual({ color: "black", size: "m" });
  });

  it("falls back to the first variant when everything is out of stock", () => {
    const gone = product({
      options: shirt.options,
      variants: [
        variant("a", { color: "red", size: "s" }, { availability: "out_of_stock" }),
        variant("b", { color: "black", size: "s" }, { availability: "out_of_stock" }),
      ],
    });
    expect(initialSelection(gone)).toEqual({ color: "red", size: "s" });
  });

  it("is empty for a product without options and always names a real variant otherwise", () => {
    expect(initialSelection(product())).toEqual({});
    expect(findVariant(shirt, initialSelection(shirt))).not.toBeNull();
    expect(findVariant(sparse, initialSelection(sparse))).not.toBeNull();
  });
});

describe("isValueAvailable", () => {
  it("never disables a value of the first option, whatever the rest of the selection", () => {
    for (const color of ["black", "red"]) {
      expect(isValueAvailable(shirt, { color: "black", size: "l" }, "color", color)).toBe(true);
    }
  });

  it("disables a value of a later option that has no variant with the earlier selection", () => {
    expect(isValueAvailable(shirt, { color: "red", size: "s" }, "size", "l")).toBe(false);
    expect(isValueAvailable(shirt, { color: "red", size: "s" }, "size", "m")).toBe(true);
    expect(isValueAvailable(shirt, { color: "black", size: "s" }, "size", "l")).toBe(true);
  });

  it("answers false for an option or value the product does not have", () => {
    expect(isValueAvailable(shirt, { color: "red", size: "s" }, "weight", "heavy")).toBe(false);
    expect(isValueAvailable(shirt, { color: "red", size: "s" }, "size", "xxl")).toBe(false);
  });
});

describe("selectValue", () => {
  it("changes one value and keeps the others when the combination exists", () => {
    expect(selectValue(shirt, { color: "black", size: "m" }, "size", "l")).toEqual({
      color: "black",
      size: "l",
    });
  });

  it("repairs later options when an earlier choice makes them impossible", () => {
    // Black has L, red does not: switching to red must move the size to a real one.
    const next = selectValue(shirt, { color: "black", size: "l" }, "color", "red");
    expect(next.color).toBe("red");
    expect(findVariant(shirt, next)).not.toBeNull();
    expect(next.size).toBe("s");
  });

  it("can never get stuck on a sparse product: each value of the first option leads to a real variant", () => {
    const start = initialSelection(sparse);
    expect(start).toEqual({ flavor: "mint", pack: "six" });
    const other = selectValue(sparse, start, "flavor", "lemon");
    expect(other).toEqual({ flavor: "lemon", pack: "twelve" });
    expect(findVariant(sparse, other)?.id).toBe("lemon-twelve");
  });

  it("refuses a disabled value and returns the selection unchanged", () => {
    const before = { color: "red", size: "s" };
    expect(selectValue(shirt, before, "size", "l")).toEqual(before);
  });

  it("does not mutate its input", () => {
    const before = Object.freeze({ color: "black", size: "l" });
    expect(() => selectValue(shirt, before, "color", "red")).not.toThrow();
  });

  it("every reachable selection is a real variant (exhaustive walk)", () => {
    for (const product of [shirt, sparse]) {
      const seen = new Set<string>();
      const queue = [initialSelection(product)];
      while (queue.length > 0) {
        const selection = queue.pop() as Record<string, string>;
        const key = JSON.stringify(selection);
        if (seen.has(key)) continue;
        seen.add(key);
        expect(findVariant(product, selection), key).not.toBeNull();
        for (const o of product.options) {
          for (const value of o.values) {
            queue.push({ ...selectValue(product, selection, o.code, value.code) });
          }
        }
      }
      expect(seen.size).toBeGreaterThan(0);
    }
  });
});

describe("selectedValueIds", () => {
  it("returns the ids of the selected values in option order, ignoring unknown codes", () => {
    expect(selectedValueIds(shirt, { size: "m", color: "red", weight: "x" })).toEqual([
      "value-color-red",
      "value-size-m",
    ]);
  });
});

describe("option codes that are names of Object.prototype members (review L2)", () => {
  const reserved = ["constructor", "__proto__", "toString", "hasOwnProperty"];
  const odd = product({
    options: reserved.map((code) => option(code, ["a", "b"])),
    variants: [
      variant("v-aaaa", Object.fromEntries(reserved.map((code) => [code, "a"]))),
      variant("v-bbbb", Object.fromEntries(reserved.map((code) => [code, "b"]))),
    ],
  });

  it("does not treat an unchosen option as chosen (the inherited function)", () => {
    expect(findVariant(odd, {})).toBeNull();
    expect(findVariant(odd, Object.fromEntries([["constructor", "a"]]))).toBeNull();
  });

  it("selects, finds and repairs through such codes", () => {
    const initial = initialSelection(odd);
    expect(Object.keys(initial).sort()).toEqual([...reserved].sort());
    expect(Object.getPrototypeOf(initial)).toBe(Object.prototype);
    expect(findVariant(odd, initial)?.id).toBe("v-aaaa");
    const next = selectValue(odd, initial, "constructor", "b");
    expect(findVariant(odd, next)?.id).toBe("v-bbbb");
    expect(selectedValueIds(odd, next)).toHaveLength(4);
    expect(isValueAvailable(odd, {}, "toString", "a")).toBe(true);
  });

  it("repairs a later option whose code is __proto__ (assignment to it would change the prototype, not the value)", () => {
    const grid = product({
      options: [option("first", ["x", "y"]), option("__proto__", ["p", "q"])],
      variants: [
        variant("v-xp", { first: "x", ["__proto__"]: "p" }),
        variant("v-yq", { first: "y", ["__proto__"]: "q" }),
      ],
    });
    const next = selectValue(grid, initialSelection(grid), "first", "y");
    expect(Object.hasOwn(next, "__proto__")).toBe(true);
    expect(findVariant(grid, next)?.id).toBe("v-yq");
  });
});
