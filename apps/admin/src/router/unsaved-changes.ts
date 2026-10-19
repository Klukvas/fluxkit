import { useEffect } from "react";
import { useBlocker, type Blocker } from "react-router";

interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Whether leaving `current` for `next` would discard unsaved input. A jump to a fragment of the same page (the skip
 * link) does not leave the form; another path or another query string does.
 */
export function shouldBlockNavigation(
  dirty: boolean,
  current: LocationLike,
  next: LocationLike,
): boolean {
  return dirty && (current.pathname !== next.pathname || current.search !== next.search);
}

/**
 * Asks before an unsaved form is left: in-app navigation through the router's blocker (render `UnsavedChangesDialog` with
 * the returned blocker), and closing or reloading the tab through the browser's own `beforeunload` prompt.
 */
export function useUnsavedChangesGuard(dirty: boolean): Blocker {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldBlockNavigation(dirty, currentLocation, nextLocation),
  );
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  return blocker;
}
