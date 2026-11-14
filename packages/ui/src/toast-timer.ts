export interface ToastTimer {
  pause: (reason: string) => void;
  resume: (reason: string) => void;
  dispose: () => void;
  remaining: () => number;
}

/** A reading-time clock, independent of motion and with separate hover/focus holds. */
export function createToastTimer(lifetime: number, onElapsed: () => void): ToastTimer {
  let remaining = lifetime;
  let started = Date.now();
  let holds: readonly string[] = [];
  let disposed = false;
  let timeout = setTimeout(finish, remaining);
  function finish(): void {
    disposed = true;
    remaining = 0;
    onElapsed();
  }
  return {
    pause(reason) {
      if (disposed || holds.includes(reason)) return;
      if (holds.length === 0) {
        remaining = Math.max(0, remaining - (Date.now() - started));
        clearTimeout(timeout);
      }
      holds = [...holds, reason];
    },
    resume(reason) {
      if (disposed || !holds.includes(reason)) return;
      holds = holds.filter((hold) => hold !== reason);
      if (holds.length > 0) return;
      started = Date.now();
      timeout = setTimeout(finish, remaining);
    },
    dispose() {
      disposed = true;
      clearTimeout(timeout);
    },
    remaining: () =>
      disposed || holds.length > 0 ? remaining : Math.max(0, remaining - (Date.now() - started)),
  };
}

/** A new notice never queues behind an old one; retain the latest three. */
export function appendToast<T>(items: readonly T[], item: T): readonly T[] {
  return [...items, item].slice(-3);
}
