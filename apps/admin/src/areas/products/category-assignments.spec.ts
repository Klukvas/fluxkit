import type { AdminProductCategory } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  MAX_PRODUCT_CATEGORIES,
  addCategory,
  assignmentsDirty,
  assignmentsFrom,
  categoriesBody,
  removeCategory,
  setPrimary,
} from "./category-assignments";

const stored: AdminProductCategory[] = [
  { categoryId: "c", isPrimary: false, position: 2 },
  { categoryId: "a", isPrimary: false, position: 0 },
  { categoryId: "b", isPrimary: true, position: 1 },
];

describe("product category assignments", () => {
  it("are read in position order with the stored primary", () => {
    expect(assignmentsFrom(stored)).toEqual({ ids: ["a", "b", "c"], primaryId: "b" });
    expect(assignmentsFrom([])).toEqual({ ids: [], primaryId: null });
  });

  it("add a category at the end once; the first one becomes primary", () => {
    const empty = assignmentsFrom([]);
    const one = addCategory(empty, "x");
    expect(one).toEqual({ ids: ["x"], primaryId: "x" });
    expect(addCategory(one, "x")).toBe(one);
    expect(addCategory(one, "y")).toEqual({ ids: ["x", "y"], primaryId: "x" });
  });

  it("refuse more than the API's 100 categories", () => {
    expect(MAX_PRODUCT_CATEGORIES).toBe(100);
    let state = assignmentsFrom([]);
    for (let index = 0; index < 100; index += 1) state = addCategory(state, `id-${index}`);
    expect(addCategory(state, "one-more")).toBe(state);
  });

  it("remove a category; removing the primary makes the first remaining one primary", () => {
    const state = assignmentsFrom(stored);
    expect(removeCategory(state, "c")).toEqual({ ids: ["a", "b"], primaryId: "b" });
    expect(removeCategory(state, "b")).toEqual({ ids: ["a", "c"], primaryId: "a" });
    expect(removeCategory(removeCategory(removeCategory(state, "a"), "b"), "c")).toEqual({
      ids: [],
      primaryId: null,
    });
  });

  it("change the primary only to an assigned category", () => {
    const state = assignmentsFrom(stored);
    expect(setPrimary(state, "c")).toEqual({ ids: ["a", "b", "c"], primaryId: "c" });
    expect(setPrimary(state, "nope")).toBe(state);
  });

  it("build the PUT body: the whole set in order (position = index) and the primary", () => {
    expect(categoriesBody(assignmentsFrom(stored))).toEqual({
      categories: [{ categoryId: "a" }, { categoryId: "b" }, { categoryId: "c" }],
      primaryCategoryId: "b",
    });
    expect(categoriesBody(assignmentsFrom([]))).toEqual({
      categories: [],
      primaryCategoryId: null,
    });
  });

  it("are dirty when the set, its order or the primary differs", () => {
    const state = assignmentsFrom(stored);
    expect(assignmentsDirty(state, state)).toBe(false);
    expect(assignmentsDirty(state, setPrimary(state, "a"))).toBe(true);
    expect(assignmentsDirty(state, removeCategory(state, "a"))).toBe(true);
    expect(assignmentsDirty(state, addCategory(removeCategory(state, "a"), "a"))).toBe(true);
  });
});
