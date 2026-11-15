import { describe, expect, it } from "vitest";
import { deriveListingKey, partitionListingVariants, type ListingVariant } from "./listing.js";

const variant = (id: string, value: string, extra: Partial<ListingVariant> = {}) => ({
  id,
  isActive: true,
  hasShopPrice: true,
  optionValues: [{ optionCode: "axis", valueCode: value }],
  ...extra,
});
const variants = [variant("a", "one"), variant("b", "two"), variant("c", "one")];
const input = {
  productId: "product",
  productStatus: "active" as const,
  optionCodes: ["axis"],
  splitOptionCode: "axis",
  variants,
};

describe("catalog listing identity and partitioning", () => {
  it("derives opaque, collision-free keys without labels or SKU ids", () => {
    expect(deriveListingKey("p", null)).toBe("p");
    expect(deriveListingKey("p", { optionCode: "axis", valueCode: "one" })).toBe("p:axis:one");
    expect(deriveListingKey("q", { optionCode: "axis", valueCode: "one" })).toBe("q:axis:one");
    expect(() => deriveListingKey("p", { optionCode: "bad:code", valueCode: "one" })).toThrow(
      "Invalid",
    );
    expect(() => deriveListingKey("p:axis:one", null)).toThrow("Invalid");
  });

  it("partitions every eligible variant exactly once, preserving input order", () => {
    const groups = partitionListingVariants(input);
    expect(
      groups.map((group) => [group.listingKey, group.variants.map((entry) => entry.id)]),
    ).toEqual([
      ["product:axis:one", ["a", "c"]],
      ["product:axis:two", ["b"]],
    ]);
    expect(groups[0]?.listingOption).toEqual({ optionCode: "axis", valueCode: "one" });
    expect(new Set(groups.flatMap((group) => group.variants)).size).toBe(3);
    expect(variants).toEqual([variant("a", "one"), variant("b", "two"), variant("c", "one")]);
  });

  it("keeps a base group when the type has no split or the product does not choose it", () => {
    for (const splitOptionCode of [null, "unchosen"]) {
      expect(partitionListingVariants({ ...input, splitOptionCode })).toEqual([
        { listingKey: "product", listingOption: null, variants },
      ]);
    }
    expect(
      partitionListingVariants({
        ...input,
        optionCodes: [],
        variants: [variant("default", "", { optionValues: [] })],
      }),
    ).toHaveLength(1);
  });

  it("keeps a single value split and excludes inactive/unpriced variants, regardless of stock", () => {
    const groups = partitionListingVariants({
      ...input,
      variants: [
        { ...variant("zero-stock", "one"), available: 0 },
        variant("inactive", "two", { isActive: false }),
        variant("unpriced", "three", { hasShopPrice: false }),
      ],
    });
    expect(groups.map((group) => group.listingKey)).toEqual(["product:axis:one"]);
    expect(partitionListingVariants({ ...input, productStatus: "draft" })).toEqual([]);
    expect(partitionListingVariants({ ...input, variants: [] })).toEqual([]);
  });

  it("rejects missing and duplicate coverage, even on an inactive variant", () => {
    for (const optionValues of [
      [],
      [
        { optionCode: "axis", valueCode: "one" },
        { optionCode: "axis", valueCode: "two" },
      ],
    ]) {
      expect(() =>
        partitionListingVariants({
          ...input,
          variants: [variant("corrupt", "one", { isActive: false, optionValues })],
        }),
      ).toThrow(/Invalid listing variant option coverage/);
    }
  });

  it("uses safe maps for valid prototype-like option and value codes", () => {
    expect(
      partitionListingVariants({
        ...input,
        optionCodes: ["constructor"],
        splitOptionCode: "constructor",
        variants: [
          variant("a", "", {
            optionValues: [{ optionCode: "constructor", valueCode: "constructor" }],
          }),
        ],
      })[0]?.listingKey,
    ).toBe("product:constructor:constructor");
  });
});
