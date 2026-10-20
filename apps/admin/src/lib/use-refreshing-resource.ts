import { useState, type DependencyList } from "react";
import { refreshingFallback } from "./refreshing-view";
import { useResource, type ResourceLoader, type ResourceView } from "./use-resource";

export interface RefreshingResource<T> {
  /** The data to render: the newest, or the previous one while a reload runs; `null` when the fallback is shown. */
  data: T | null;
  /** Show this instead of the data (loading the first time, failure, forbidden, not found); `null` to show the data. */
  fallback: ResourceView<T> | null;
  /** A reload is running and the previous data is still shown. */
  refreshing: boolean;
  reload: () => void;
}

/**
 * `useResource` that keeps the last data on screen while `reload()` runs, so a write in one section of a page reloads the
 * page's data without unmounting its other forms (a form that is being edited keeps its input). Key the component by the
 * resource id, so another id starts empty.
 */
export function useRefreshingResource<T>(
  loader: ResourceLoader<T>,
  deps: DependencyList,
): RefreshingResource<T> {
  const view = useResource(loader, deps);
  const [last, setLast] = useState<{ data: T } | null>(null);
  if (view.status === "ready" && last?.data !== view.data) setLast({ data: view.data });
  const { fallback, refreshing } = refreshingFallback(view, last !== null);
  return {
    data: view.status === "ready" ? view.data : fallback === null ? (last?.data ?? null) : null,
    fallback,
    refreshing,
    reload: view.reload,
  };
}
