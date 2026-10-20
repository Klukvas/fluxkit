/** The part of `useResource`'s answer the choice below needs. */
export type RefreshableStatus =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "notFound" };

/**
 * What a screen shows while it can keep its last data across an explicit reload (after a write): the data itself while
 * the reload runs (no flash of skeleton rows, no unmounted forms), and the fallback (loading, failure, not allowed, not
 * found) in every other case. A failed reload is shown as the failure, never as stale data that looks current.
 */
export function refreshingFallback<State extends RefreshableStatus>(
  view: State,
  hasLast: boolean,
): { fallback: State | null; refreshing: boolean } {
  if (view.status === "ready") return { fallback: null, refreshing: false };
  if (view.status === "loading" && hasLast) return { fallback: null, refreshing: true };
  return { fallback: view, refreshing: false };
}
