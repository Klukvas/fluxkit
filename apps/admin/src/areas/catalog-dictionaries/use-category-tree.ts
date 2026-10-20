import { useEffect, useRef, useState } from "react";
import { adminClient } from "../../lib/api";
import { failureFromError } from "../../lib/failure";
import { useCrash } from "../../lib/use-crash";
import { resourceStateFromResult } from "../../lib/use-resource";
import type { ResourceFallbackState } from "../../views/status-views";
import {
  CHILD_PAGE_SIZE,
  ROOT_PAGE_SIZE,
  collectRoots,
  initialTreeState,
  toggleNode,
  treeReducer,
  type TreeAction,
  type TreeState,
} from "./category-tree";

export interface CategoryTreeData {
  tree: TreeState;
  /** Categories scanned to find the roots (for the "list truncated" notice). */
  scanned: number;
  /** Why the roots could not be loaded (`null` while loading or when loaded). */
  rootsFailure: ResourceFallbackState | null;
  retryRoots: () => void;
  toggle: (id: string) => void;
  retryChildren: (id: string) => void;
  loadMore: (id: string) => void;
}

/**
 * The data of the lazy category tree (`category-tree.ts` is the model): the roots through the `collectRoots` workaround,
 * a level when its parent is expanded, more of a level on demand. Reads only; a failed read shows a retry, nothing is
 * retried by itself; requests end with the component. Shared by the category screen and the product editor's picker.
 */
export function useCategoryTree(): CategoryTreeData {
  const crash = useCrash();
  const [tree, setTree] = useState<TreeState>(initialTreeState);
  const [scanned, setScanned] = useState(0);
  const [rootsFailure, setRootsFailure] = useState<ResourceFallbackState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const treeRef = useRef(tree);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    treeRef.current = tree;
  });

  const apply = (action: TreeAction) => setTree((current) => treeReducer(current, action));

  useEffect(() => {
    const own = new AbortController();
    controller.current = own;
    setTree(initialTreeState);
    collectRoots((offset) =>
      adminClient.listCategories({ limit: ROOT_PAGE_SIZE, offset, signal: own.signal }),
    ).then(
      (result) => {
        if (own.signal.aborted) return;
        if (result.ok) {
          setScanned(result.scanned);
          setRootsFailure(null);
          setTree((current) =>
            treeReducer(current, {
              type: "rootsLoaded",
              roots: result.roots,
              truncated: result.truncated,
            }),
          );
        } else {
          const state = resourceStateFromResult(result.result);
          setRootsFailure(state.status === "ready" || state.status === "crashed" ? null : state);
          setTree((current) => treeReducer(current, { type: "rootsFailed" }));
        }
      },
      (error: unknown) => {
        if (own.signal.aborted) return;
        try {
          const failure = failureFromError(error);
          if (failure !== null) {
            setRootsFailure({ status: "error", failure });
            setTree((current) => treeReducer(current, { type: "rootsFailed" }));
          }
        } catch (bug) {
          crash(bug);
        }
      },
    );
    return () => own.abort();
  }, [attempt, crash]);

  function loadChildren(id: string, append: boolean) {
    const own = controller.current;
    if (own === null) return;
    const offset = append ? (treeRef.current.nodes[id]?.childIds.length ?? 0) : 0;
    adminClient
      .listCategories({ parentId: id, limit: CHILD_PAGE_SIZE, offset, signal: own.signal })
      .then(
        (result) => {
          if (own.signal.aborted) return;
          if (result.ok) {
            apply({
              type: "childrenLoaded",
              id,
              items: result.data.items,
              total: result.data.total,
              append,
            });
          } else apply({ type: "childrenFailed", id });
        },
        (error: unknown) => {
          if (own.signal.aborted) return;
          try {
            if (failureFromError(error) !== null) apply({ type: "childrenFailed", id });
          } catch (bug) {
            crash(bug);
          }
        },
      );
  }

  return {
    tree,
    scanned,
    rootsFailure,
    retryRoots: () => setAttempt((count) => count + 1),
    toggle(id) {
      const { state, load } = toggleNode(treeRef.current, id);
      setTree(state);
      if (load) loadChildren(id, false);
    },
    retryChildren(id) {
      apply({ type: "childrenRequested", id });
      loadChildren(id, false);
    },
    loadMore(id) {
      loadChildren(id, true);
    },
  };
}
