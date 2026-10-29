import type { StoreResult } from "@fluxkit/api-client";
import { failureFromResult, failureFromThrown, type Failure } from "./failure";

/**
 * The search behind a combobox of the delivery step (shipping plan step 10): the city and the pickup point lookups through
 * our API (`GET /store/shipping/providers/{code}/...`; the browser never talks to a carrier). One small store per picker.
 * Rules, each with a test:
 * - Typing is debounced (300 ms by default) and a query shorter than `minChars` sends nothing and drops the old results.
 * - Requests are numbered when they START. Only the newest query's answer is applied, so a slow older answer cannot replace
 *   the results of what the shopper typed since.
 * - The request in flight is ABORTED (its `AbortSignal`) when the text changes, on `reset` and on `dispose`, so a stale
 *   answer is dropped by the browser and never read; the numbering above stays as the second line of defence.
 * - The old results are cleared as soon as the query changes: an option is never offered for text it does not match.
 * - A failed lookup is a value (`failure`, translated by the view) with a retry; a caller's abort or a bug is rethrown.
 * - `stale` is the API's flag: the carrier is unreachable and saved data is shown.
 */

export type LookupStatus = "idle" | "waiting" | "loading" | "ready" | "error";

export interface LookupState<T> {
  status: LookupStatus;
  /** The (trimmed) text the items belong to, or that is being looked up. */
  query: string;
  items: readonly T[];
  /** The API's count of all matches; more than `items.length` when the page is cut. */
  total: number;
  stale: boolean;
  failure: Failure | null;
}

export interface LookupPage<T> {
  items: T[];
  total: number;
  stale: boolean;
}

export interface LookupSourceOptions<T> {
  /**
   * One call to the typed client for the (trimmed) query. `signal` is aborted when the answer is no longer wanted (the
   * text changed, `reset`, `dispose`): pass it on, so the browser drops the request instead of reading a stale answer.
   */
  search(query: string, signal: AbortSignal): Promise<StoreResult<LookupPage<T>>>;
  /** Fewest characters that start a search (the cities API needs 2). */
  minChars: number;
  /** An empty query lists everything at once (the points of a chosen city) instead of waiting for text. Default false. */
  searchEmpty?: boolean;
  debounceMs?: number;
  /** Replaceable in tests. */
  timers?: {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

export interface LookupSource<T> {
  getState(): LookupState<T>;
  subscribe(listener: () => void): () => void;
  /** The text in the box changed (every keystroke). */
  setQuery(text: string): void;
  /** Asks again for the current query now (after an error). */
  retry(): void;
  /** Forgets everything and cancels a pending search. */
  reset(): void;
  /** Cancels a pending search and ignores the answer of one in flight; the source can be used again (React strict mode mounts twice). */
  dispose(): void;
}

/** The debounce of the plan: results are asked for when the shopper pauses typing for 300 ms. */
export const LOOKUP_DEBOUNCE_MS = 300;

export function initialLookupState<T>(): LookupState<T> {
  return { status: "idle", query: "", items: [], total: 0, stale: false, failure: null };
}

export function createLookupSource<T>(options: LookupSourceOptions<T>): LookupSource<T> {
  const debounceMs = options.debounceMs ?? LOOKUP_DEBOUNCE_MS;
  const timers = options.timers ?? {
    set: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let state = initialLookupState<T>();
  let seq = 0;
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  const listeners = new Set<() => void>();

  function set(next: LookupState<T>): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function cancelTimer(): void {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  /** Ends the request in flight, if any; call it AFTER `seq` moved on, so the rejection it causes is recognised as stale. */
  function abortInFlight(): void {
    inFlight?.abort();
    inFlight = null;
  }

  async function run(query: string): Promise<void> {
    cancelTimer();
    seq += 1;
    abortInFlight();
    const mine = seq;
    const controller = new AbortController();
    inFlight = controller;
    set({ ...initialLookupState<T>(), status: "loading", query });
    let result: StoreResult<LookupPage<T>>;
    try {
      result = await options.search(query, controller.signal);
    } catch (thrown) {
      if (mine !== seq) return;
      if (inFlight === controller) inFlight = null;
      try {
        set({
          ...initialLookupState<T>(),
          status: "error",
          query,
          failure: failureFromThrown(thrown),
        });
      } catch (bug) {
        set({ ...initialLookupState<T>(), status: "idle", query });
        throw bug;
      }
      return;
    }
    if (mine !== seq) return;
    if (inFlight === controller) inFlight = null;
    if (result.ok) {
      set({
        status: "ready",
        query,
        items: result.data.items,
        total: result.data.total,
        stale: result.data.stale,
        failure: null,
      });
    } else {
      set({
        ...initialLookupState<T>(),
        status: "error",
        query,
        failure: failureFromResult(result),
      });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setQuery(text) {
      const query = text.trim();
      cancelTimer();
      // Invalidates a request in flight: its answer is for text that is gone.
      seq += 1;
      abortInFlight();
      if (query === "" && options.searchEmpty === true) {
        void run("");
        return;
      }
      if (query.length < options.minChars) {
        set({ ...initialLookupState<T>(), query });
        return;
      }
      set({ ...initialLookupState<T>(), status: "waiting", query });
      timer = timers.set(() => {
        timer = null;
        void run(query);
      }, debounceMs);
    },
    retry() {
      if (state.status === "error") void run(state.query);
    },
    reset() {
      cancelTimer();
      seq += 1;
      abortInFlight();
      set(initialLookupState<T>());
    },
    dispose() {
      cancelTimer();
      seq += 1;
      abortInFlight();
    },
  };
}
