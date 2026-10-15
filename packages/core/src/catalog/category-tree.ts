import { CATALOG_LIMITS } from "./limits.js";
import type { CategoryNode } from "./types.js";

function indexById(nodes: readonly CategoryNode[]): Map<string, CategoryNode> {
  const index = new Map<string, CategoryNode>();
  for (const node of nodes) {
    if (!index.has(node.id)) {
      index.set(node.id, node);
    }
  }
  return index;
}

/**
 * Level of a node, root = 1. `null` when the node does not exist or its chain of parents is
 * broken (dangling parent or cycle), so callers cannot mistake corrupted data for a real depth.
 */
export function depthOf(nodes: readonly CategoryNode[], id: string): number | null {
  return depthIn(indexById(nodes), id);
}

function depthIn(index: ReadonlyMap<string, CategoryNode>, id: string): number | null {
  const visited = new Set<string>();
  let depth = 0;
  let current: string | null = id;
  while (current !== null) {
    const node = index.get(current);
    if (node === undefined || visited.has(current)) {
      return null;
    }
    visited.add(current);
    depth += 1;
    current = node.parentId;
  }
  return depth;
}

/**
 * Number of levels in the subtree rooted at `id`, counting the node itself (a leaf is 1).
 * `null` when the node does not exist or the subtree contains a cycle.
 */
export function subtreeHeight(nodes: readonly CategoryNode[], id: string): number | null {
  if (!nodes.some((node) => node.id === id)) {
    return null;
  }
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
    }
  }
  const visited = new Set<string>([id]);
  let frontier = [id];
  let height = 0;
  while (frontier.length > 0) {
    height += 1;
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of children.get(parent) ?? []) {
        if (visited.has(child)) {
          return null;
        }
        visited.add(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return height;
}

/**
 * True when making `newParentId` the parent of `nodeId` would put the node under itself or under one
 * of its descendants. Also true when the chain above the new parent already loops, because the move
 * cannot be shown to be safe.
 */
export function wouldCreateCycle(
  nodes: readonly CategoryNode[],
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) {
    return false;
  }
  const index = indexById(nodes);
  const visited = new Set<string>();
  let current: string | null = newParentId;
  while (current !== null) {
    if (current === nodeId || visited.has(current)) {
      return true;
    }
    visited.add(current);
    const node = index.get(current);
    if (node === undefined) {
      return false;
    }
    current = node.parentId;
  }
  return false;
}

export type CategoryMoveErrorReason =
  | "node_not_found"
  | "parent_not_found"
  | "moved_under_itself"
  | "would_create_cycle"
  | "max_depth_exceeded"
  | "tree_corrupted";

export interface CategoryMoveError {
  readonly reason: CategoryMoveErrorReason;
  /** The depth the deepest node would reach, for `max_depth_exceeded`. */
  readonly depth?: number;
  readonly limit?: number;
}

export type CategoryMoveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly CategoryMoveError[] };

function checkDepth(
  parentDepth: number | null,
  height: number | null,
  maxDepth: number,
): CategoryMoveResult {
  if (parentDepth === null || height === null) {
    return { ok: false, errors: [{ reason: "tree_corrupted" }] };
  }
  const depth = parentDepth + height;
  return depth > maxDepth
    ? { ok: false, errors: [{ reason: "max_depth_exceeded", depth, limit: maxDepth }] }
    : { ok: true };
}

/**
 * Checks a move of `nodeId` under `newParentId` (`null` = root level): the node and the parent
 * exist, no cycle, and the moved subtree still fits into `maxDepth` levels (ADR 0006 section 8).
 */
export function validateMove(
  nodes: readonly CategoryNode[],
  nodeId: string,
  newParentId: string | null,
  maxDepth: number = CATALOG_LIMITS.maxCategoryDepth,
): CategoryMoveResult {
  const index = indexById(nodes);
  if (!index.has(nodeId)) {
    return { ok: false, errors: [{ reason: "node_not_found" }] };
  }
  if (newParentId !== null && !index.has(newParentId)) {
    return { ok: false, errors: [{ reason: "parent_not_found" }] };
  }
  if (newParentId === nodeId) {
    return { ok: false, errors: [{ reason: "moved_under_itself" }] };
  }
  if (wouldCreateCycle(nodes, nodeId, newParentId)) {
    return { ok: false, errors: [{ reason: "would_create_cycle" }] };
  }
  return checkDepth(
    newParentId === null ? 0 : depthIn(index, newParentId),
    subtreeHeight(nodes, nodeId),
    maxDepth,
  );
}

/** Checks that a new category can be created under `parentId` (`null` = root level). */
export function validateNewNode(
  nodes: readonly CategoryNode[],
  parentId: string | null,
  maxDepth: number = CATALOG_LIMITS.maxCategoryDepth,
): CategoryMoveResult {
  const index = indexById(nodes);
  if (parentId !== null && !index.has(parentId)) {
    return { ok: false, errors: [{ reason: "parent_not_found" }] };
  }
  return checkDepth(parentId === null ? 0 : depthIn(index, parentId), 1, maxDepth);
}

export type CategoryTreeViolationReason =
  | "duplicate_id"
  | "parent_not_found"
  | "self_parent"
  | "cycle"
  | "max_depth_exceeded";

export interface CategoryTreeViolation {
  readonly reason: CategoryTreeViolationReason;
  readonly nodeId: string;
  readonly depth?: number;
  readonly limit?: number;
}

export type CategoryTreeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly CategoryTreeViolation[] };

function isOnCycle(index: ReadonlyMap<string, CategoryNode>, start: CategoryNode): boolean {
  const visited = new Set<string>();
  let current = start.parentId;
  while (current !== null && !visited.has(current)) {
    if (current === start.id) {
      return true;
    }
    visited.add(current);
    current = index.get(current)?.parentId ?? null;
  }
  return false;
}

/** Checks a flat list of nodes: unique ids, existing parents, no cycles, depth within `maxDepth`. */
export function validateTree(
  nodes: readonly CategoryNode[],
  maxDepth: number = CATALOG_LIMITS.maxCategoryDepth,
): CategoryTreeResult {
  const index = indexById(nodes);
  const seen = new Set<string>();
  const violations: CategoryTreeViolation[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) {
      violations.push({ reason: "duplicate_id", nodeId: node.id });
      continue;
    }
    seen.add(node.id);
    if (node.parentId === node.id) {
      violations.push({ reason: "self_parent", nodeId: node.id });
    } else if (node.parentId !== null && !index.has(node.parentId)) {
      violations.push({ reason: "parent_not_found", nodeId: node.id });
    } else if (isOnCycle(index, node)) {
      violations.push({ reason: "cycle", nodeId: node.id });
    } else {
      const depth = depthIn(index, node.id);
      if (depth !== null && depth > maxDepth) {
        violations.push({ reason: "max_depth_exceeded", nodeId: node.id, depth, limit: maxDepth });
      }
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
