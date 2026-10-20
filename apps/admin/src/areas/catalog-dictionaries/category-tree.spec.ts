import type { AdminCategory, AdminCategoryList, AdminResult } from "@fluxkit/api-client";
import { CATALOG_LIMITS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  CHILD_PAGE_SIZE,
  MAX_CATEGORY_DEPTH,
  MAX_ROOT_PAGES,
  ROOT_PAGE_SIZE,
  collectRoots,
  initialTreeState,
  toggleNode,
  treeItems,
  treeReducer,
  type TreeState,
} from "./category-tree";

function category(id: string, parentId: string | null, position = 0): AdminCategory {
  return {
    id,
    parentId,
    slug: id,
    name: { uk: id },
    description: null,
    position,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function page(
  items: AdminCategory[],
  total: number,
  offset: number,
  limit = 100,
): AdminResult<AdminCategoryList> {
  return { ok: true, status: 200, data: { items, total, limit, offset } };
}

const failure = {
  ok: false as const,
  status: 500,
  retryAfter: null,
  problem: {
    type: "about:blank",
    title: "t",
    status: 500,
    code: "internal_error" as const,
    detail: "d",
  },
};

describe("limits copied from core", () => {
  it("match core", () => {
    expect(MAX_CATEGORY_DEPTH).toBe(CATALOG_LIMITS.maxCategoryDepth);
    expect(ROOT_PAGE_SIZE).toBe(CATALOG_LIMITS.maxPageSize);
    expect(CHILD_PAGE_SIZE).toBe(CATALOG_LIMITS.maxPageSize);
    expect(ROOT_PAGE_SIZE * MAX_ROOT_PAGES).toBeLessThanOrEqual(CATALOG_LIMITS.maxOffset);
  });
});

describe("collectRoots (the API cannot list the root level alone)", () => {
  it("keeps only the rows without a parent, in the API's order", async () => {
    const result = await collectRoots(async (offset) =>
      page([category("a", null), category("a1", "a"), category("b", null)], 3, offset),
    );
    expect(result).toEqual({
      ok: true,
      roots: [category("a", null), category("b", null)],
      truncated: false,
      scanned: 3,
    });
  });

  it("pages the flat list until the total is reached, 100 rows per request", async () => {
    const offsets: number[] = [];
    const all = Array.from({ length: 250 }, (_, index) =>
      category(`c${index}`, index % 2 === 0 ? null : "x"),
    );
    const result = await collectRoots(async (offset) => {
      offsets.push(offset);
      return page(all.slice(offset, offset + 100), all.length, offset);
    });
    expect(offsets).toEqual([0, 100, 200]);
    expect(result.ok && result.roots.length).toBe(125);
    expect(result.ok && result.truncated).toBe(false);
  });

  it("stops at the page cap and says the list is truncated", async () => {
    let calls = 0;
    const result = await collectRoots(async (offset) => {
      calls += 1;
      return page(
        Array.from({ length: 100 }, (_, index) => category(`r${offset + index}`, null)),
        100_000,
        offset,
      );
    });
    expect(calls).toBe(MAX_ROOT_PAGES);
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.scanned).toBe(MAX_ROOT_PAGES * ROOT_PAGE_SIZE);
  });

  it("is not truncated when the total is exactly what the cap allows", async () => {
    const total = MAX_ROOT_PAGES * ROOT_PAGE_SIZE;
    const result = await collectRoots(async (offset) =>
      page(
        Array.from({ length: 100 }, (_, index) => category(`r${offset + index}`, null)),
        total,
        offset,
      ),
    );
    expect(result.ok && result.truncated).toBe(false);
  });

  it("stops on an empty page even if the total says more (no endless loop)", async () => {
    let calls = 0;
    const result = await collectRoots(async (offset) => {
      calls += 1;
      return page([], 500, offset);
    });
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("returns the failure of any page, with no partial list", async () => {
    let calls = 0;
    const result = await collectRoots(async (offset) => {
      calls += 1;
      return calls === 1 ? page([category("a", null)], 300, offset) : failure;
    });
    expect(result).toEqual({ ok: false, result: failure });
  });

  it("does not retry a failed page", async () => {
    let calls = 0;
    await collectRoots(async () => {
      calls += 1;
      return failure;
    });
    expect(calls).toBe(1);
  });
});

function withRoots(): TreeState {
  return treeReducer(initialTreeState, {
    type: "rootsLoaded",
    roots: [category("a", null), category("b", null)],
    truncated: false,
  });
}

describe("tree state", () => {
  it("starts loading its roots, then lists them collapsed", () => {
    expect(initialTreeState.roots.status).toBe("loading");
    const items = treeItems(withRoots());
    expect(items.map((item) => item.category.id)).toEqual(["a", "b"]);
    expect(items.every((item) => !item.expanded && item.children.length === 0)).toBe(true);
    expect(items.map((item) => [item.depth, item.posInSet, item.setSize])).toEqual([
      [1, 1, 2],
      [1, 2, 2],
    ]);
  });

  it("marks failed and truncated roots", () => {
    expect(treeReducer(initialTreeState, { type: "rootsFailed" }).roots.status).toBe("error");
    const truncated = treeReducer(initialTreeState, {
      type: "rootsLoaded",
      roots: [],
      truncated: true,
    });
    expect(truncated.roots.truncated).toBe(true);
  });

  it("expanding an unloaded node asks for its children and shows it loading", () => {
    const { state, load } = toggleNode(withRoots(), "a");
    expect(load).toBe(true);
    const item = treeItems(state)[0];
    expect(item?.expanded).toBe(true);
    expect(item?.childStatus).toBe("loading");
  });

  it("shows the loaded children below their parent, one level deeper", () => {
    let state = toggleNode(withRoots(), "a").state;
    state = treeReducer(state, {
      type: "childrenLoaded",
      id: "a",
      items: [category("a1", "a"), category("a2", "a")],
      total: 2,
    });
    const parent = treeItems(state)[0];
    expect(parent?.childStatus).toBe("loaded");
    expect(
      parent?.children.map((child) => [
        child.category.id,
        child.depth,
        child.posInSet,
        child.setSize,
      ]),
    ).toEqual([
      ["a1", 2, 1, 2],
      ["a2", 2, 2, 2],
    ]);
  });

  it("collapses without loading, and expands again without a second load", () => {
    let state = toggleNode(withRoots(), "a").state;
    state = treeReducer(state, {
      type: "childrenLoaded",
      id: "a",
      items: [category("a1", "a")],
      total: 1,
    });
    const collapsed = toggleNode(state, "a");
    expect(collapsed.load).toBe(false);
    expect(treeItems(collapsed.state)[0]?.expanded).toBe(false);
    const expanded = toggleNode(collapsed.state, "a");
    expect(expanded.load).toBe(false);
    expect(treeItems(expanded.state)[0]?.expanded).toBe(true);
    expect(treeItems(expanded.state)[0]?.children.length).toBe(1);
  });

  it("a failed load keeps the node expanded with an error, and expanding again retries (the admin's choice)", () => {
    let state = toggleNode(withRoots(), "a").state;
    state = treeReducer(state, { type: "childrenFailed", id: "a" });
    expect(treeItems(state)[0]?.childStatus).toBe("error");
    state = toggleNode(state, "a").state; // collapse
    const again = toggleNode(state, "a"); // expand: loads again
    expect(again.load).toBe(true);
    expect(treeItems(again.state)[0]?.childStatus).toBe("loading");
  });

  it("an empty loaded level is loaded with no children, not an error", () => {
    let state = toggleNode(withRoots(), "b").state;
    state = treeReducer(state, { type: "childrenLoaded", id: "b", items: [], total: 0 });
    const item = treeItems(state)[1];
    expect(item?.childStatus).toBe("loaded");
    expect(item?.children).toEqual([]);
  });

  it("offers more children when the total is larger than what was loaded, and appends without duplicates", () => {
    let state = toggleNode(withRoots(), "a").state;
    state = treeReducer(state, {
      type: "childrenLoaded",
      id: "a",
      items: [category("a1", "a"), category("a2", "a")],
      total: 3,
    });
    expect(treeItems(state)[0]?.hasMore).toBe(true);
    state = treeReducer(state, {
      type: "childrenLoaded",
      id: "a",
      items: [category("a2", "a"), category("a3", "a")],
      total: 3,
      append: true,
    });
    const parent = treeItems(state)[0];
    expect(parent?.children.map((child) => child.category.id)).toEqual(["a1", "a2", "a3"]);
    expect(parent?.hasMore).toBe(false);
  });

  it("no node at the maximum depth can be expanded", () => {
    let state = withRoots();
    let parent = "a";
    for (let depth = 2; depth <= MAX_CATEGORY_DEPTH; depth += 1) {
      state = toggleNode(state, parent).state;
      const id = `n${depth}`;
      state = treeReducer(state, {
        type: "childrenLoaded",
        id: parent,
        items: [category(id, parent)],
        total: 1,
      });
      parent = id;
    }
    let item = treeItems(state)[0];
    const depths: [number, boolean][] = [];
    while (item !== undefined) {
      depths.push([item.depth, item.canExpand]);
      item = item.children[0];
    }
    expect(depths).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
      [5, false],
    ]);
    expect(toggleNode(state, parent)).toEqual({ state, load: false });
  });

  it("ignores a toggle of an unknown node", () => {
    const state = withRoots();
    expect(toggleNode(state, "nope")).toEqual({ state, load: false });
  });
});
