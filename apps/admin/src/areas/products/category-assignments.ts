import type { AdminProductCategory, PutProductCategoriesBody } from "@fluxkit/api-client";
import { jsonEqual } from "../../lib/diff-for-patch";

/**
 * The categories of a product as the Categories tab edits them: an ordered set of category ids and the primary one.
 * `PUT /admin/products/{id}/categories` replaces the whole set (position = index in the list); exactly one assignment
 * is primary (`docs/api/catalog.md`). Pure; tested first.
 */
export const MAX_PRODUCT_CATEGORIES = 100;

export interface AssignmentState {
  ids: string[];
  primaryId: string | null;
}

export function assignmentsFrom(categories: readonly AdminProductCategory[]): AssignmentState {
  const sorted = [...categories].sort((left, right) => left.position - right.position);
  return {
    ids: sorted.map((entry) => entry.categoryId),
    primaryId: sorted.find((entry) => entry.isPrimary)?.categoryId ?? null,
  };
}

/** Appends a category (once, within the API's limit); the first category of a product becomes its primary. */
export function addCategory(state: AssignmentState, id: string): AssignmentState {
  if (state.ids.includes(id) || state.ids.length >= MAX_PRODUCT_CATEGORIES) return state;
  return { ids: [...state.ids, id], primaryId: state.primaryId ?? id };
}

export function removeCategory(state: AssignmentState, id: string): AssignmentState {
  const ids = state.ids.filter((entry) => entry !== id);
  return { ids, primaryId: state.primaryId === id ? (ids[0] ?? null) : state.primaryId };
}

export function setPrimary(state: AssignmentState, id: string): AssignmentState {
  return state.ids.includes(id) ? { ...state, primaryId: id } : state;
}

export function categoriesBody(state: AssignmentState): PutProductCategoriesBody {
  return {
    categories: state.ids.map((categoryId) => ({ categoryId })),
    primaryCategoryId: state.primaryId,
  };
}

export function assignmentsDirty(initial: AssignmentState, current: AssignmentState): boolean {
  return !jsonEqual(initial, current);
}
