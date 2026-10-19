import type { CategoryNode } from "@fluxkit/api-client";

/** Nodes from the root of the category tree down to the category with `slug`, or `null` when the tree has no such category. */
export function categoryTrail(tree: readonly CategoryNode[], slug: string): CategoryNode[] | null {
  for (const node of tree) {
    if (node.slug === slug) return [node];
    const below = categoryTrail(node.children, slug);
    if (below !== null) return [node, ...below];
  }
  return null;
}

export function findCategory(tree: readonly CategoryNode[], slug: string): CategoryNode | null {
  const trail = categoryTrail(tree, slug);
  return trail === null ? null : (trail[trail.length - 1] ?? null);
}

/**
 * The breadcrumb trail of a product: the longest trail among its categories (the first listed wins a tie). Categories the
 * tree does not contain (inactive, hidden) are ignored; the result is empty when none is in the tree.
 */
export function deepestTrail(
  tree: readonly CategoryNode[],
  slugs: readonly string[],
): CategoryNode[] {
  let best: CategoryNode[] = [];
  for (const slug of slugs) {
    const trail = categoryTrail(tree, slug);
    if (trail !== null && trail.length > best.length) best = trail;
  }
  return best;
}
