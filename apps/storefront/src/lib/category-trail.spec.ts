import { describe, expect, it } from "vitest";
import { categoryTrail, deepestTrail, findCategory } from "./category-trail";
import { category } from "./test-fixtures";

const tree = [
  category("clothing", [category("tops", [category("t-shirts")]), category("bottoms")]),
  category("books"),
];

describe("categoryTrail", () => {
  it("returns the nodes from the root to the category, at any depth", () => {
    expect(categoryTrail(tree, "t-shirts")?.map((node) => node.slug)).toEqual([
      "clothing",
      "tops",
      "t-shirts",
    ]);
    expect(categoryTrail(tree, "books")?.map((node) => node.slug)).toEqual(["books"]);
  });
  it("returns null for an unknown slug", () => {
    expect(categoryTrail(tree, "missing")).toBeNull();
    expect(categoryTrail([], "books")).toBeNull();
  });
});

describe("findCategory", () => {
  it("finds a node at any depth with its children", () => {
    expect(findCategory(tree, "tops")?.children.map((node) => node.slug)).toEqual(["t-shirts"]);
    expect(findCategory(tree, "missing")).toBeNull();
  });
});

describe("deepestTrail", () => {
  it("picks the longest trail of the product's categories (ties: the first listed)", () => {
    expect(deepestTrail(tree, ["books", "tops", "clothing"]).map((node) => node.slug)).toEqual([
      "clothing",
      "tops",
    ]);
    expect(deepestTrail(tree, ["bottoms", "tops"]).map((node) => node.slug)).toEqual([
      "clothing",
      "bottoms",
    ]);
  });
  it("is empty when none of the categories is in the tree (hidden or inactive)", () => {
    expect(deepestTrail(tree, ["gone"])).toEqual([]);
    expect(deepestTrail(tree, [])).toEqual([]);
  });
});
