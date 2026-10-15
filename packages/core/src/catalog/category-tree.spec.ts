import { describe, expect, it } from "vitest";
import {
  depthOf,
  subtreeHeight,
  validateMove,
  validateNewNode,
  validateTree,
  wouldCreateCycle,
} from "./category-tree.js";
import { deepFreeze } from "./test-support.js";
import type { CategoryNode } from "./types.js";

function node(id: string, parentId: string | null): CategoryNode {
  return { id, parentId };
}

// a > b > c > d > e   (five levels, the maximum)
// x > y
const nodes: readonly CategoryNode[] = deepFreeze([
  node("a", null),
  node("b", "a"),
  node("c", "b"),
  node("d", "c"),
  node("e", "d"),
  node("x", null),
  node("y", "x"),
]);

describe("depthOf", () => {
  it("counts the root as level 1", () => {
    expect(depthOf(nodes, "a")).toBe(1);
    expect(depthOf(nodes, "y")).toBe(2);
    expect(depthOf(nodes, "e")).toBe(5);
  });

  it("is null for an unknown node, a dangling parent and a cycle", () => {
    expect(depthOf(nodes, "zzz")).toBeNull();
    expect(depthOf([node("a", "missing")], "a")).toBeNull();
    expect(depthOf([node("a", "b"), node("b", "a")], "a")).toBeNull();
    expect(depthOf([node("a", "a")], "a")).toBeNull();
  });
});

describe("subtreeHeight", () => {
  it("counts the node itself, so a leaf has height 1", () => {
    expect(subtreeHeight(nodes, "e")).toBe(1);
    expect(subtreeHeight(nodes, "c")).toBe(3);
    expect(subtreeHeight(nodes, "a")).toBe(5);
    expect(subtreeHeight(nodes, "x")).toBe(2);
  });

  it("takes the deepest branch", () => {
    const branching = [node("r", null), node("s", "r"), node("t", "r"), node("u", "t")];
    expect(subtreeHeight(branching, "r")).toBe(3);
  });

  it("is null for an unknown node or a cyclic subtree", () => {
    expect(subtreeHeight(nodes, "zzz")).toBeNull();
    expect(subtreeHeight([node("a", "b"), node("b", "a")], "a")).toBeNull();
  });
});

describe("wouldCreateCycle", () => {
  it("is true when the new parent is the node itself", () => {
    expect(wouldCreateCycle(nodes, "a", "a")).toBe(true);
  });

  it("is true when the new parent is a descendant", () => {
    expect(wouldCreateCycle(nodes, "a", "c")).toBe(true);
    expect(wouldCreateCycle(nodes, "b", "e")).toBe(true);
  });

  it("is false for an ancestor, a sibling branch, another tree and the root level", () => {
    expect(wouldCreateCycle(nodes, "c", "a")).toBe(false);
    expect(wouldCreateCycle(nodes, "c", "y")).toBe(false);
    expect(wouldCreateCycle(nodes, "b", "x")).toBe(false);
    expect(wouldCreateCycle(nodes, "b", null)).toBe(false);
  });

  it("is false for an unknown new parent (validateMove reports that separately)", () => {
    expect(wouldCreateCycle(nodes, "b", "zzz")).toBe(false);
  });

  it("is true when the chain above the new parent is already corrupted by a cycle", () => {
    const corrupted = [node("p", "q"), node("q", "p"), node("n", null)];
    expect(wouldCreateCycle(corrupted, "n", "p")).toBe(true);
  });
});

describe("validateMove", () => {
  it("accepts a legal move", () => {
    expect(validateMove(nodes, "c", "x", 5)).toEqual({ ok: true });
    expect(validateMove(nodes, "c", null, 5)).toEqual({ ok: true });
  });

  it("accepts a move to the current parent", () => {
    expect(validateMove(nodes, "c", "b", 5)).toEqual({ ok: true });
  });

  it("uses the ADR depth limit of 5 by default", () => {
    expect(validateMove(nodes, "b", "y")).toEqual({
      ok: false,
      errors: [{ reason: "max_depth_exceeded", depth: 6, limit: 5 }],
    });
    expect(validateMove(nodes, "c", "x")).toEqual({ ok: true });
  });

  it("rejects moving a node under itself", () => {
    expect(validateMove(nodes, "a", "a", 5)).toEqual({
      ok: false,
      errors: [{ reason: "moved_under_itself" }],
    });
  });

  it("rejects moving a node under one of its descendants", () => {
    expect(validateMove(nodes, "a", "e", 5)).toEqual({
      ok: false,
      errors: [{ reason: "would_create_cycle" }],
    });
  });

  it("rejects a move that makes the tree deeper than the limit", () => {
    // b has height 4; y is at depth 2; 4 + 2 = 6 > 5.
    expect(validateMove(nodes, "b", "y", 5)).toEqual({
      ok: false,
      errors: [{ reason: "max_depth_exceeded", depth: 6, limit: 5 }],
    });
  });

  it("accepts a move that lands exactly on the limit", () => {
    // c has height 3; x is at depth 1; 3 + 1 = 4. Under y (depth 2): 5.
    expect(validateMove(nodes, "c", "y", 5)).toEqual({ ok: true });
  });

  it("honours a custom limit", () => {
    // x has height 2; a is at depth 1; 2 + 1 = 3 > 2.
    expect(validateMove(nodes, "x", "a", 2)).toEqual({
      ok: false,
      errors: [{ reason: "max_depth_exceeded", depth: 3, limit: 2 }],
    });
    expect(validateMove(nodes, "y", "a", 2)).toEqual({ ok: true });
  });

  it("reports unknown nodes", () => {
    expect(validateMove(nodes, "zzz", null, 5)).toEqual({
      ok: false,
      errors: [{ reason: "node_not_found" }],
    });
    expect(validateMove(nodes, "c", "zzz", 5)).toEqual({
      ok: false,
      errors: [{ reason: "parent_not_found" }],
    });
  });

  it("refuses to decide on a corrupted tree instead of passing silently", () => {
    const corrupted = [node("p", "q"), node("q", "p"), node("n", null), node("m", "ghost")];
    expect(validateMove(corrupted, "n", "m", 5)).toEqual({
      ok: false,
      errors: [{ reason: "tree_corrupted" }],
    });
    expect(validateMove(corrupted, "p", null, 5)).toEqual({
      ok: false,
      errors: [{ reason: "tree_corrupted" }],
    });
  });

  it("walks through the ADR scenario (e)", () => {
    const tree = [
      node("odyag", null),
      node("cholovichyi", "odyag"),
      node("futbolky", "cholovichyi"),
      node("zhinochyi", null),
    ];
    expect(validateMove(tree, "futbolky", "zhinochyi", 5)).toEqual({ ok: true });
    expect(validateMove(tree, "odyag", "futbolky", 5)).toEqual({
      ok: false,
      errors: [{ reason: "would_create_cycle" }],
    });
  });

  it("does not mutate frozen input", () => {
    expect(validateMove(nodes, "c", "x", 5)).toEqual(validateMove(nodes, "c", "x", 5));
  });
});

describe("validateNewNode", () => {
  it("accepts a root and a child within the limit", () => {
    expect(validateNewNode(nodes, null, 5)).toEqual({ ok: true });
    expect(validateNewNode(nodes, "d", 5)).toEqual({ ok: true });
  });

  it("rejects a child below the deepest allowed level", () => {
    expect(validateNewNode(nodes, "e", 5)).toEqual({
      ok: false,
      errors: [{ reason: "max_depth_exceeded", depth: 6, limit: 5 }],
    });
  });

  it("rejects an unknown parent", () => {
    expect(validateNewNode(nodes, "zzz", 5)).toEqual({
      ok: false,
      errors: [{ reason: "parent_not_found" }],
    });
  });
});

describe("validateTree", () => {
  it("accepts a valid tree and an empty list", () => {
    expect(validateTree(nodes, 5)).toEqual({ ok: true });
    expect(validateTree([], 5)).toEqual({ ok: true });
  });

  it("reports duplicate ids", () => {
    expect(validateTree([node("a", null), node("a", null)], 5)).toEqual({
      ok: false,
      violations: [{ reason: "duplicate_id", nodeId: "a" }],
    });
  });

  it("reports a dangling parent", () => {
    expect(validateTree([node("a", "missing")], 5)).toEqual({
      ok: false,
      violations: [{ reason: "parent_not_found", nodeId: "a" }],
    });
  });

  it("reports a node that is its own parent", () => {
    expect(validateTree([node("a", "a")], 5)).toEqual({
      ok: false,
      violations: [{ reason: "self_parent", nodeId: "a" }],
    });
  });

  it("reports every node that sits on a cycle", () => {
    expect(validateTree([node("a", "c"), node("b", "a"), node("c", "b"), node("r", null)], 5)).toEqual({
      ok: false,
      violations: [
        { reason: "cycle", nodeId: "a" },
        { reason: "cycle", nodeId: "b" },
        { reason: "cycle", nodeId: "c" },
      ],
    });
  });

  it("reports nodes deeper than the limit", () => {
    const deep = [
      node("l1", null),
      node("l2", "l1"),
      node("l3", "l2"),
      node("l4", "l3"),
      node("l5", "l4"),
      node("l6", "l5"),
      node("l7", "l6"),
    ];
    expect(validateTree(deep, 5)).toEqual({
      ok: false,
      violations: [
        { reason: "max_depth_exceeded", nodeId: "l6", depth: 6, limit: 5 },
        { reason: "max_depth_exceeded", nodeId: "l7", depth: 7, limit: 5 },
      ],
    });
  });

  it("returns all violations at once", () => {
    const result = validateTree([node("a", null), node("a", null), node("b", "ghost")], 5);
    expect(result).toEqual({
      ok: false,
      violations: [
        { reason: "duplicate_id", nodeId: "a" },
        { reason: "parent_not_found", nodeId: "b" },
      ],
    });
  });

  it("does not mutate frozen input", () => {
    expect(validateTree(nodes, 5)).toEqual(validateTree(nodes, 5));
  });
});
