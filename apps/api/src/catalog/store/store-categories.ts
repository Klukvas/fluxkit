import type { ActiveCategoryRow } from "./store.repository.js";

function byPositionThenSlug(left: ActiveCategoryRow, right: ActiveCategoryRow): number {
  return (
    left.position - right.position ||
    (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

export interface VisibleCategory {
  readonly row: ActiveCategoryRow;
  readonly children: readonly VisibleCategory[];
}

/**
 * The public category tree. `activeRows` are the categories with `is_active = true`; a category is public only when
 * every ancestor is active too (ADR 0006 section 10), which is what walking down from the roots guarantees: a row whose
 * parent is inactive (so absent from `activeRows`) is never reached. Siblings are ordered by position, then slug.
 */
export function visibleCategoryTree(
  activeRows: readonly ActiveCategoryRow[],
): readonly VisibleCategory[] {
  const childrenOf = new Map<string | null, ActiveCategoryRow[]>();
  for (const row of activeRows) {
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row]);
  }
  // A parent loop is unreachable from the roots (a root has no parent), so the recursion always ends.
  const build = (parentId: string | null): VisibleCategory[] =>
    [...(childrenOf.get(parentId) ?? [])]
      .sort(byPositionThenSlug)
      .map((row) => ({ row, children: build(row.id) }));
  return build(null);
}

/** Every node of the tree, flattened depth first. */
export function flattenCategories(tree: readonly VisibleCategory[]): ActiveCategoryRow[] {
  return tree.flatMap((node) => [node.row, ...flattenCategories(node.children)]);
}

/** Ids of the public category with `slug` and all its public descendants; empty when there is no such public category. */
export function subtreeIds(tree: readonly VisibleCategory[], slug: string): string[] {
  const find = (nodes: readonly VisibleCategory[]): VisibleCategory | undefined => {
    for (const node of nodes) {
      const found = node.row.slug === slug ? node : find(node.children);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };
  const root = find(tree);
  return root === undefined ? [] : flattenCategories([root]).map((row) => row.id);
}
