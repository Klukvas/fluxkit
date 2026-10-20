/** The pause after the last keystroke before a search is applied (plan, "Performance"). */
export const SEARCH_DEBOUNCE_MS = 300;

export interface Debounce {
  /** Replaces any pending call; `run` happens after `delayMs` without another `schedule`. */
  schedule: (run: () => void) => void;
  cancel: () => void;
}

/** A trailing debounce over the global timers (no DOM, so it is tested with fake timers). */
export function createDebounce(delayMs: number): Debounce {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    schedule(run) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel,
  };
}
