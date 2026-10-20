import type { AdminResult } from "@fluxkit/api-client";
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { failureFromError, type Failure } from "./failure";

/**
 * Screen states of one read (plan, "Routing, data and state"). `crashed` is internal: the hook throws its error during
 * render so the route's error boundary shows it (a bug is never turned into a friendly "try again").
 */
export type ResourceState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; failure: Failure }
  | { status: "forbidden" }
  | { status: "notFound" }
  | { status: "crashed"; error: unknown };

export type ResourceLoader<T> = (signal: AbortSignal) => Promise<AdminResult<T>>;

export function resourceStateFromResult<T>(result: AdminResult<T>): ResourceState<T> {
  if (result.ok) return { status: "ready", data: result.data };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "notFound" };
  return {
    status: "error",
    failure: {
      kind: "problem",
      status: result.status,
      problem: result.problem,
      retryAfter: result.retryAfter,
    },
  };
}

function stateFromError<T>(error: unknown): ResourceState<T> | null {
  try {
    const failure = failureFromError(error);
    return failure === null ? null : { status: "error", failure };
  } catch (bug) {
    return { status: "crashed", error: bug };
  }
}

/**
 * Runs a loader with its own `AbortController`. A new run aborts the previous one, `dispose` aborts the current one, and
 * an answer that arrives after either is dropped. One call of the loader per run: nothing is retried. Framework-free, so
 * it is tested without a DOM; `useResource` is the React glue.
 */
export function createResourceRunner<T>(onState: (state: ResourceState<T>) => void) {
  let controller: AbortController | null = null;
  let current = 0;
  return {
    run(loader: ResourceLoader<T>): void {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      current += 1;
      const id = current;
      const isCurrent = () => id === current && !own.signal.aborted;
      onState({ status: "loading" });
      loader(own.signal).then(
        (result) => {
          if (isCurrent()) onState(resourceStateFromResult(result));
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          const state = stateFromError<T>(error);
          if (state !== null) onState(state);
        },
      );
    },
    dispose(): void {
      controller?.abort();
      controller = null;
      current += 1;
    },
  };
}

export type ResourceView<T> = Exclude<ResourceState<T>, { status: "crashed" }> & {
  /** Runs the loader again (a retry button, or after a write). */
  reload: () => void;
};

/**
 * Loads data for a screen: `loading`, then `ready`, `error`, `forbidden` or `notFound`. The request is aborted when the
 * component unmounts (navigation) or `deps` change. `loader` should call the admin client with the given signal. No cache,
 * no retry: `reload()` is explicit.
 */
export function useResource<T>(loader: ResourceLoader<T>, deps: DependencyList): ResourceView<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const [runner] = useState(() => createResourceRunner<T>(setState));
  const loaderRef = useRef(loader);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    runner.run(loaderRef.current);
    return () => runner.dispose();
    // The caller's deps decide when to load again; the loader itself is read from the ref.
  }, [runner, reloads, ...deps]);

  const reload = useCallback(() => setReloads((count) => count + 1), []);
  if (state.status === "crashed") throw state.error;
  return { ...state, reload };
}
