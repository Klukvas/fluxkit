import type { AdminCategory, AdminCategoryList, AdminResult } from "@fluxkit/api-client";

/**
 * The category tree as a pure model (tests first). The tree loads level by level: the roots first, the children of a node
 * when it is expanded (`GET /admin/categories?parentId=`). The API cannot list the root level alone (there is no
 * `parentId=null`; without the filter it lists every category of every level), so the roots are found by paging the flat
 * list and keeping the rows whose parent is null: a KNOWN WORKAROUND, bounded by `MAX_ROOT_PAGES` and reported as
 * truncated when the cap is hit. An additive `parentId=null` filter in the API would remove it (HANDOFF, known gaps).
 */

/** `CATALOG_LIMITS.maxCategoryDepth` of core (compared with core in the spec). */
export const MAX_CATEGORY_DEPTH = 5;
/** The API's maximum page size. */
export const ROOT_PAGE_SIZE = 100;
export const CHILD_PAGE_SIZE = 100;
/** At most this many pages (1 000 categories) are scanned for roots; more is shown as a truncated list. */
export const MAX_ROOT_PAGES = 10;

export type RootsResult =
  | { ok: true; roots: AdminCategory[]; truncated: boolean; scanned: number }
  | { ok: false; result: Extract<AdminResult<AdminCategoryList>, { ok: false }> };

/**
 * Pages the flat category list (limit 100) and keeps the rows with no parent, in the API's order (position, slug, id).
 * Stops at the total, at an empty page, or after `maxPages`. A failed page ends the scan with no partial result; nothing
 * is retried.
 */
export async function collectRoots(
  fetchPage: (offset: number) => Promise<AdminResult<AdminCategoryList>>,
  limits: { maxPages?: number } = {},
): Promise<RootsResult> {
  const maxPages = limits.maxPages ?? MAX_ROOT_PAGES;
  const roots: AdminCategory[] = [];
  let offset = 0;
  let total = 0;
  for (let pages = 0; pages < maxPages; pages += 1) {
    const result = await fetchPage(offset);
    if (!result.ok) return { ok: false, result };
    total = result.data.total;
    for (const category of result.data.items) {
      if (category.parentId === null) roots.push(category);
    }
    offset += result.data.items.length;
    if (result.data.items.length === 0 || offset >= total) {
      return { ok: true, roots, truncated: false, scanned: offset };
    }
  }
  return { ok: true, roots, truncated: offset < total, scanned: offset };
}

// ------------------------------------------------------------------------- state

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface NodeState {
  category: AdminCategory;
  expanded: boolean;
  childStatus: LoadStatus;
  childIds: string[];
  childTotal: number;
}

export interface TreeState {
  roots: { status: "loading" | "loaded" | "error"; ids: string[]; truncated: boolean };
  nodes: Record<string, NodeState>;
}

export const initialTreeState: TreeState = {
  roots: { status: "loading", ids: [], truncated: false },
  nodes: {},
};

export type TreeAction =
  | { type: "rootsRequested" }
  | { type: "rootsLoaded"; roots: AdminCategory[]; truncated: boolean }
  | { type: "rootsFailed" }
  | { type: "childrenLoaded"; id: string; items: AdminCategory[]; total: number; append?: boolean }
  | { type: "childrenRequested"; id: string }
  | { type: "childrenFailed"; id: string };

function freshNode(category: AdminCategory): NodeState {
  return { category, expanded: false, childStatus: "idle", childIds: [], childTotal: 0 };
}

function addNodes(
  nodes: Record<string, NodeState>,
  categories: readonly AdminCategory[],
): Record<string, NodeState> {
  const next = { ...nodes };
  for (const category of categories) {
    const known = next[category.id];
    // A reloaded category keeps its expansion; its data is the server's newest.
    next[category.id] = known === undefined ? freshNode(category) : { ...known, category };
  }
  return next;
}

export function treeReducer(state: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case "rootsRequested":
      return { ...state, roots: { ...state.roots, status: "loading" } };
    case "rootsLoaded":
      return {
        roots: {
          status: "loaded",
          ids: action.roots.map((category) => category.id),
          truncated: action.truncated,
        },
        nodes: addNodes(state.nodes, action.roots),
      };
    case "rootsFailed":
      return { ...state, roots: { ...state.roots, status: "error" } };
    case "childrenRequested": {
      const node = state.nodes[action.id];
      if (node === undefined) return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, childStatus: "loading" } },
      };
    }
    case "childrenFailed": {
      const node = state.nodes[action.id];
      if (node === undefined) return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, childStatus: "error" } },
      };
    }
    case "childrenLoaded": {
      const node = state.nodes[action.id];
      if (node === undefined) return state;
      const loaded = action.append === true ? node.childIds : [];
      const ids = [...loaded];
      for (const category of action.items) if (!ids.includes(category.id)) ids.push(category.id);
      const nodes = addNodes(state.nodes, action.items);
      nodes[action.id] = {
        ...(nodes[action.id] ?? node),
        childStatus: "loaded",
        childIds: ids,
        childTotal: action.total,
      };
      return { ...state, nodes };
    }
  }
}

/**
 * Expands or collapses one node. Returns whether its children must be loaded now: only when the node is being expanded and
 * its children were never loaded (or the last load failed). A node at the maximum depth cannot have children, so a
 * toggle of it changes nothing.
 */
export function toggleNode(state: TreeState, id: string): { state: TreeState; load: boolean } {
  const node = state.nodes[id];
  if (node === undefined) return { state, load: false };
  if (depthOf(state, id) >= MAX_CATEGORY_DEPTH) return { state, load: false };
  if (node.expanded) {
    return {
      state: { ...state, nodes: { ...state.nodes, [id]: { ...node, expanded: false } } },
      load: false,
    };
  }
  const load = node.childStatus === "idle" || node.childStatus === "error";
  return {
    state: {
      ...state,
      nodes: {
        ...state.nodes,
        [id]: { ...node, expanded: true, childStatus: load ? "loading" : node.childStatus },
      },
    },
    load,
  };
}

function depthOf(state: TreeState, id: string): number {
  let depth = 1;
  let current = state.nodes[id]?.category.parentId ?? null;
  const seen = new Set<string>([id]);
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = state.nodes[current]?.category.parentId ?? null;
  }
  return depth;
}

// -------------------------------------------------------------------------- view

export interface TreeItem {
  category: AdminCategory;
  /** 1 for a root. */
  depth: number;
  posInSet: number;
  setSize: number;
  expanded: boolean;
  /** False at the maximum depth: such a category cannot have subcategories. */
  canExpand: boolean;
  childStatus: LoadStatus;
  /** More children exist on the server than are loaded. */
  hasMore: boolean;
  children: TreeItem[];
}

function build(state: TreeState, ids: readonly string[], depth: number): TreeItem[] {
  return ids.flatMap((id, index) => {
    const node = state.nodes[id];
    if (node === undefined) return [];
    return [
      {
        category: node.category,
        depth,
        posInSet: index + 1,
        setSize: ids.length,
        expanded: node.expanded,
        canExpand: depth < MAX_CATEGORY_DEPTH,
        childStatus: node.childStatus,
        hasMore: node.childStatus === "loaded" && node.childIds.length < node.childTotal,
        children: node.expanded ? build(state, node.childIds, depth + 1) : [],
      },
    ];
  });
}

/** The visible tree: collapsed nodes have no children in it. */
export function treeItems(state: TreeState): TreeItem[] {
  return build(state, state.roots.ids, 1);
}
