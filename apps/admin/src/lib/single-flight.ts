/**
 * Double-submit protection for one write button (plan, "Writes"): while a write runs, another `run` does nothing and
 * answers `null`, so a double click, Enter held down or a click before React re-renders the disabled button never sends
 * a second request. It never repeats a write either: a settled write (answered, refused or lost) simply frees the slot.
 */
export interface SingleFlight {
  run: <T>(task: () => Promise<T>) => Promise<T> | null;
  pending: () => boolean;
}

export function createSingleFlight(): SingleFlight {
  let busy = false;
  return {
    run<T>(task: () => Promise<T>): Promise<T> | null {
      if (busy) return null;
      busy = true;
      return task().finally(() => {
        busy = false;
      });
    },
    pending: () => busy,
  };
}
