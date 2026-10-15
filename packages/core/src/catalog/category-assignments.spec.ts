import { describe, expect, it } from "vitest";
import {
  normalizeCategoryAssignments,
  promotePrimaryAfterRemoval,
  type CategoryAssignment,
} from "./category-assignments.js";
import { deepFreeze } from "./test-support.js";

describe("normalizeCategoryAssignments", () => {
  it("accepts an empty list and has no primary", () => {
    expect(normalizeCategoryAssignments({ assignments: [] })).toEqual({ ok: true, assignments: [] });
  });

  it("makes the assignment with the lowest position primary when none is given", () => {
    const result = normalizeCategoryAssignments({
      assignments: [
        { categoryId: "a", position: 5 },
        { categoryId: "b", position: 1 },
        { categoryId: "c", position: 3 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      assignments: [
        { categoryId: "a", position: 5, isPrimary: false },
        { categoryId: "b", position: 1, isPrimary: true },
        { categoryId: "c", position: 3, isPrimary: false },
      ],
    });
  });

  it("breaks position ties by input order", () => {
    const result = normalizeCategoryAssignments({
      assignments: [
        { categoryId: "a", position: 2 },
        { categoryId: "b", position: 0 },
        { categoryId: "c", position: 0 },
      ],
    });
    expect(result.ok && result.assignments.filter((a) => a.isPrimary)).toEqual([
      { categoryId: "b", position: 0, isPrimary: true },
    ]);
  });

  it("uses the given primary category when it is assigned", () => {
    const result = normalizeCategoryAssignments({
      assignments: [
        { categoryId: "a", position: 0 },
        { categoryId: "b", position: 1 },
      ],
      primaryCategoryId: "b",
    });
    expect(result).toEqual({
      ok: true,
      assignments: [
        { categoryId: "a", position: 0, isPrimary: false },
        { categoryId: "b", position: 1, isPrimary: true },
      ],
    });
  });

  it("treats a null primaryCategoryId like an absent one", () => {
    const result = normalizeCategoryAssignments({
      assignments: [{ categoryId: "a", position: 0 }],
      primaryCategoryId: null,
    });
    expect(result).toEqual({
      ok: true,
      assignments: [{ categoryId: "a", position: 0, isPrimary: true }],
    });
  });

  it("rejects a primary category that is not assigned", () => {
    expect(
      normalizeCategoryAssignments({
        assignments: [{ categoryId: "a", position: 0 }],
        primaryCategoryId: "x",
      }),
    ).toEqual({ ok: false, errors: [{ reason: "primary_not_assigned", categoryId: "x" }] });
  });

  it("rejects a primary category when the list is empty", () => {
    expect(normalizeCategoryAssignments({ assignments: [], primaryCategoryId: "x" })).toEqual({
      ok: false,
      errors: [{ reason: "primary_not_assigned", categoryId: "x" }],
    });
  });

  it("rejects duplicate categories once per repeated entry", () => {
    expect(
      normalizeCategoryAssignments({
        assignments: [
          { categoryId: "a", position: 0 },
          { categoryId: "a", position: 1 },
          { categoryId: "a", position: 2 },
        ],
      }),
    ).toEqual({
      ok: false,
      errors: [
        { reason: "duplicate_category", categoryId: "a" },
        { reason: "duplicate_category", categoryId: "a" },
      ],
    });
  });

  it("reports duplicates and an unassigned primary together", () => {
    const result = normalizeCategoryAssignments({
      assignments: [
        { categoryId: "a", position: 0 },
        { categoryId: "a", position: 1 },
      ],
      primaryCategoryId: "x",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.reason)).toEqual([
      "duplicate_category",
      "primary_not_assigned",
    ]);
  });

  it("is pure: frozen input is not mutated and two calls agree", () => {
    const input = deepFreeze({
      assignments: [
        { categoryId: "a", position: 4 },
        { categoryId: "b", position: 2 },
      ],
      primaryCategoryId: "a",
    });
    expect(normalizeCategoryAssignments(input)).toEqual(normalizeCategoryAssignments(input));
  });
});

describe("promotePrimaryAfterRemoval", () => {
  const assignments: readonly CategoryAssignment[] = [
    { categoryId: "a", position: 3, isPrimary: true },
    { categoryId: "b", position: 2, isPrimary: false },
    { categoryId: "c", position: 1, isPrimary: false },
  ];

  it("promotes the remaining assignment with the lowest position when the primary is removed", () => {
    expect(promotePrimaryAfterRemoval(assignments, "a")).toEqual([
      { categoryId: "b", position: 2, isPrimary: false },
      { categoryId: "c", position: 1, isPrimary: true },
    ]);
  });

  it("breaks position ties by list order", () => {
    const tied: readonly CategoryAssignment[] = [
      { categoryId: "a", position: 0, isPrimary: true },
      { categoryId: "b", position: 1, isPrimary: false },
      { categoryId: "c", position: 1, isPrimary: false },
    ];
    expect(promotePrimaryAfterRemoval(tied, "a").map((a) => a.isPrimary)).toEqual([true, false]);
  });

  it("keeps the primary when a non-primary category is removed", () => {
    expect(promotePrimaryAfterRemoval(assignments, "b")).toEqual([
      { categoryId: "a", position: 3, isPrimary: true },
      { categoryId: "c", position: 1, isPrimary: false },
    ]);
  });

  it("returns an empty list when the only assignment is removed", () => {
    expect(
      promotePrimaryAfterRemoval([{ categoryId: "a", position: 0, isPrimary: true }], "a"),
    ).toEqual([]);
  });

  it("changes nothing when the removed category is not assigned", () => {
    expect(promotePrimaryAfterRemoval(assignments, "zzz")).toEqual(assignments);
  });

  it("is pure: frozen input is not mutated and two calls agree", () => {
    const frozen = deepFreeze(assignments.map((assignment) => ({ ...assignment })));
    expect(promotePrimaryAfterRemoval(frozen, "a")).toEqual(promotePrimaryAfterRemoval(frozen, "a"));
  });
});
