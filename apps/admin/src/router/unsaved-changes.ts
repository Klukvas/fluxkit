import { createContext, useContext, useEffect, useId } from "react";
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
 * Which mounted guards report unsaved input right now. The shell holds one, so an action that leaves the page without a
 * navigation the router could block (sign-out) asks the same question (step 13 review, L4).
 */
export interface UnsavedChangesRegistry {
  report(guardId: string, dirty: boolean): void;
  hasUnsavedChanges(): boolean;
}

export function createUnsavedChangesRegistry(): UnsavedChangesRegistry {
  const dirtyGuards = new Set<string>();
  return {
    report(guardId, dirty) {
      if (dirty) dirtyGuards.add(guardId);
      else dirtyGuards.delete(guardId);
    },
    hasUnsavedChanges: () => dirtyGuards.size > 0,
  };
}

/** `null` outside the shell (the sign-in page, static tests): nothing to report to. */
export const UnsavedChangesContext = createContext<UnsavedChangesRegistry | null>(null);

export function useUnsavedChangesRegistry(): UnsavedChangesRegistry | null {
  return useContext(UnsavedChangesContext);
}

/**
 * Runs `leave` at once when nothing is unsaved; otherwise hands it to `ask`, which shows the "Leave this page?" question
 * and runs it only on "Leave".
 */
export function leaveOrAsk(
  registry: UnsavedChangesRegistry | null,
  leave: () => void,
  ask: (leave: () => void) => void,
): void {
  if (registry?.hasUnsavedChanges() === true) ask(leave);
  else leave();
}

/**
 * Asks before an unsaved form is left: in-app navigation through the router's blocker (render `UnsavedChangesDialog` with
 * the returned blocker), closing or reloading the tab through the browser's own `beforeunload` prompt, and sign-out
 * through the shell's registry (`useConfirmLeave`).
 */
export function useUnsavedChangesGuard(dirty: boolean): Blocker {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldBlockNavigation(dirty, currentLocation, nextLocation),
  );
  const registry = useUnsavedChangesRegistry();
  const guardId = useId();
  useEffect(() => {
    if (registry === null) return undefined;
    registry.report(guardId, dirty);
    return () => registry.report(guardId, false);
  }, [registry, guardId, dirty]);
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
