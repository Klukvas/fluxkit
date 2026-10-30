import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/** What to focus: the id of an element, or a ref to it. */
export type FocusTarget = string | RefObject<HTMLElement | null>;

interface FocusRequest {
  target: FocusTarget;
  /** Counts the requests, so asking for the same target again focuses it again. */
  n: number;
}

function resolve(target: FocusTarget): HTMLElement | null {
  return typeof target === "string" ? document.getElementById(target) : target.current;
}

/**
 * Moves the focus in the commit that renders the target, never in a later frame. Call the returned function next to the
 * state update that shows the target (an error summary, the first invalid field, a status line, a new row): the focus
 * happens in a layout effect of the commit that carries both, so the element exists, and nothing is left pending.
 *
 * Why not `requestAnimationFrame(() => el.focus())`: the frame can come late (a loaded machine, a CI runner). A late frame
 * focuses its element after the admin, or a test, has already moved on to the next field, so what is typed there lands in
 * the wrong field (CI run of PR #191: "50.50Damaged in transit" in the amount). `src/focus-guards.spec.ts` forbids it.
 *
 * The target is read in the commit (a ref's current value, an id looked up then), so it may be rendered by the same update.
 * A target that is not in the page is ignored. The function is stable, so it can be a dependency of other callbacks.
 */
export function useFocusAfterCommit(): (target: FocusTarget) => void {
  const [request, setRequest] = useState<FocusRequest | null>(null);
  useLayoutEffect(() => {
    if (request !== null) resolve(request.target)?.focus();
  }, [request]);
  return useCallback(
    (target: FocusTarget) => setRequest((current) => ({ target, n: (current?.n ?? 0) + 1 })),
    [],
  );
}

/** How `focusWhenPresent` finds the element and learns that the page changed; the browser's by default. */
export interface PresenceEnvironment {
  find: (id: string) => HTMLElement | null;
  /** Calls `onChange` after every change of the page's elements; answers the function that stops watching. */
  watch: (onChange: () => void) => () => void;
}

const browserEnvironment: PresenceEnvironment = {
  find: (id) => document.getElementById(id),
  watch: (onChange) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  },
};

/**
 * Focuses the element with this id as soon as it is in the page, for a target that a screen renders only after it has read
 * its own data (a later commit than any request). The focus happens when the element is inserted, not in a later frame.
 * Gives up after `timeoutMs`; either way `done` is called once, unless the returned cleanup ran first (use it as the cleanup
 * of an effect).
 */
export function focusWhenPresent(
  id: string,
  done: () => void,
  timeoutMs: number,
  environment: PresenceEnvironment = browserEnvironment,
): () => void {
  let stopWatching: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    stopWatching?.();
    stopWatching = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const check = () => {
    const element = environment.find(id);
    if (element === null) return false;
    stop();
    element.focus();
    done();
    return true;
  };
  if (check()) return stop;
  stopWatching = environment.watch(() => void check());
  timer = setTimeout(() => {
    stop();
    done();
  }, timeoutMs);
  return stop;
}
