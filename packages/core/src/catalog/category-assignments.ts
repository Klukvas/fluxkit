/**
 * Product to category assignments (ADR 0006 section 8): when a product has categories, exactly one
 * is primary. The database only guarantees "at most one"; these rules supply the "exactly one".
 */

export interface CategoryAssignmentInput {
  readonly categoryId: string;
  readonly position: number;
}

export interface CategoryAssignment extends CategoryAssignmentInput {
  readonly isPrimary: boolean;
}

export type CategoryAssignmentErrorReason = "duplicate_category" | "primary_not_assigned";

export interface CategoryAssignmentError {
  readonly reason: CategoryAssignmentErrorReason;
  readonly categoryId: string;
}

export type NormalizeCategoryAssignmentsResult =
  | { readonly ok: true; readonly assignments: readonly CategoryAssignment[] }
  | { readonly ok: false; readonly errors: readonly CategoryAssignmentError[] };

/** Index of the entry with the lowest position; the earliest one wins a tie. -1 for an empty list. */
function indexOfLowestPosition(entries: readonly CategoryAssignmentInput[]): number {
  let best = -1;
  entries.forEach((entry, index) => {
    const current = entries[best];
    if (current === undefined || entry.position < current.position) {
      best = index;
    }
  });
  return best;
}

/**
 * Returns the assignments (input order kept) with exactly one primary, or no primary for an empty
 * list. The primary is `primaryCategoryId` when given, otherwise the lowest position.
 */
export function normalizeCategoryAssignments(input: {
  readonly assignments: readonly CategoryAssignmentInput[];
  readonly primaryCategoryId?: string | null;
}): NormalizeCategoryAssignmentsResult {
  const { assignments, primaryCategoryId } = input;
  const errors: CategoryAssignmentError[] = [];

  const seen = new Set<string>();
  for (const { categoryId } of assignments) {
    if (seen.has(categoryId)) {
      errors.push({ reason: "duplicate_category", categoryId });
    }
    seen.add(categoryId);
  }
  if (primaryCategoryId !== undefined && primaryCategoryId !== null) {
    if (!seen.has(primaryCategoryId)) {
      errors.push({ reason: "primary_not_assigned", categoryId: primaryCategoryId });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const hasGivenPrimary = primaryCategoryId !== undefined && primaryCategoryId !== null;
  const primaryIndex = hasGivenPrimary
    ? assignments.findIndex((assignment) => assignment.categoryId === primaryCategoryId)
    : indexOfLowestPosition(assignments);
  return {
    ok: true,
    assignments: assignments.map((assignment, index) => ({
      categoryId: assignment.categoryId,
      position: assignment.position,
      isPrimary: index === primaryIndex,
    })),
  };
}

/**
 * The assignments left after detaching one category. If that left the product without a primary
 * (the removed one was primary), the remaining assignment with the lowest position becomes primary.
 */
export function promotePrimaryAfterRemoval(
  assignments: readonly CategoryAssignment[],
  removedCategoryId: string,
): readonly CategoryAssignment[] {
  const remaining = assignments.filter((assignment) => assignment.categoryId !== removedCategoryId);
  if (remaining.some((assignment) => assignment.isPrimary)) {
    return remaining.map((assignment) => ({ ...assignment }));
  }
  const promotedIndex = indexOfLowestPosition(remaining);
  return remaining.map((assignment, index) => ({
    ...assignment,
    isPrimary: index === promotedIndex,
  }));
}
