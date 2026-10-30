import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A minimal hook runtime: the admin's unit tests run in plain Node (no DOM, no React renderer), so the hook is driven
 * through a stand-in for the three React hooks it uses. `commit()` is one React commit: the component function runs
 * again, then the layout effects whose dependencies changed run (as React does after the DOM is updated).
 */
const runtime = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  pendingEffects: [] as (() => void)[],
  dirty: false,
}));

vi.mock("react", () => ({
  useState<T>(initial: T) {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = initial;
    const set = (next: T | ((current: T) => T)) => {
      const current = runtime.slots[index] as T;
      runtime.slots[index] = typeof next === "function" ? (next as (c: T) => T)(current) : next;
      runtime.dirty = true;
    };
    return [runtime.slots[index] as T, set] as const;
  },
  useCallback<T>(callback: T, deps: unknown[]) {
    const index = runtime.cursor++;
    const previous = runtime.slots[index] as { callback: T; deps: unknown[] } | undefined;
    if (previous !== undefined && previous.deps.every((dep, i) => Object.is(dep, deps[i]))) {
      return previous.callback;
    }
    runtime.slots[index] = { callback, deps };
    return callback;
  },
  useLayoutEffect(effect: () => void, deps?: unknown[]) {
    const index = runtime.cursor++;
    const previous = runtime.slots[index] as { deps: unknown[] | undefined } | undefined;
    const changed =
      previous === undefined ||
      deps === undefined ||
      previous.deps === undefined ||
      deps.some((dep, i) => !Object.is(dep, previous.deps?.[i]));
    runtime.slots[index] = { deps };
    if (changed) runtime.pendingEffects.push(effect);
  },
}));

import { focusWhenPresent, useFocusAfterCommit, type FocusTarget } from "./use-focus-after-commit";

function element(name: string, log: string[]) {
  return { name, focus: vi.fn(() => log.push(name)) } as unknown as HTMLElement & {
    focus: ReturnType<typeof vi.fn>;
  };
}

/** Renders the hook once; `commit()` re-renders and runs the layout effects like React does after a state update. */
function mount() {
  runtime.slots = [];
  runtime.cursor = 0;
  runtime.pendingEffects = [];
  runtime.dirty = false;
  let request!: (target: FocusTarget) => void;
  const render = () => {
    runtime.cursor = 0;
    runtime.pendingEffects = [];
    request = useFocusAfterCommit();
    runtime.dirty = false;
    for (const effect of runtime.pendingEffects) effect();
  };
  render();
  return {
    request: (target: FocusTarget) => request(target),
    requester: () => request,
    commit: () => {
      if (runtime.dirty) render();
    },
    rerenderUnconditionally: render,
  };
}

describe("useFocusAfterCommit", () => {
  const log: string[] = [];
  let byId: Record<string, HTMLElement | undefined>;

  beforeEach(() => {
    log.length = 0;
    byId = {};
    vi.useFakeTimers();
    vi.stubGlobal("document", { getElementById: (id: string) => byId[id] ?? null });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("focuses nothing before the commit and the requested element in the commit", () => {
    const summary = element("summary", log);
    const view = mount();
    view.request({ current: summary });
    expect(summary.focus).not.toHaveBeenCalled();
    view.commit();
    expect(summary.focus).toHaveBeenCalledTimes(1);
  });

  it("never defers the focus to a timer, a microtask or an animation frame (a late frame stole focus from the next field)", () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const first = element("first", log);
    const view = mount();
    view.request({ current: first });
    view.commit();
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("focuses only the requested element, looked up by id in the commit (the target may be rendered by that very update)", () => {
    const wanted = element("wanted", log);
    const other = element("other", log);
    byId["other"] = other;
    const view = mount();
    view.request("wanted");
    // The element appears with the update that carries the request.
    byId["wanted"] = wanted;
    view.commit();
    expect(log).toEqual(["wanted"]);
    expect(other.focus).not.toHaveBeenCalled();
  });

  it("does nothing, and does not throw, for a missing id or an empty ref", () => {
    const view = mount();
    view.request("not-rendered");
    expect(() => view.commit()).not.toThrow();
    view.request({ current: null });
    expect(() => view.commit()).not.toThrow();
    expect(log).toEqual([]);
  });

  it("focuses again when the same target is requested again, and not when nothing was requested", () => {
    const field = element("field", log);
    const ref = { current: field };
    const view = mount();
    view.request(ref);
    view.commit();
    view.rerenderUnconditionally();
    view.rerenderUnconditionally();
    expect(field.focus).toHaveBeenCalledTimes(1);
    view.request(ref);
    view.commit();
    expect(field.focus).toHaveBeenCalledTimes(2);
  });

  it("focuses the last target when two are requested before one commit", () => {
    const first = element("first", log);
    const second = element("second", log);
    const view = mount();
    view.request({ current: first });
    view.request({ current: second });
    view.commit();
    expect(log).toEqual(["second"]);
  });

  it("hands out the same function on every render, so it can be a dependency of other callbacks", () => {
    const view = mount();
    const before = view.requester();
    view.request("x");
    view.commit();
    expect(view.requester()).toBe(before);
  });
});

describe("focusWhenPresent", () => {
  const log: string[] = [];
  beforeEach(() => {
    log.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  function environment() {
    const present: Record<string, HTMLElement | undefined> = {};
    let notify: (() => void) | null = null;
    const disconnect = vi.fn(() => {
      notify = null;
    });
    return {
      present,
      disconnect,
      changed: () => notify?.(),
      find: (id: string) => present[id] ?? null,
      watch: (onChange: () => void) => {
        notify = onChange;
        return disconnect;
      },
    };
  }

  it("focuses an element that is there at once and reports done", () => {
    const env = environment();
    env.present["row"] = element("row", log);
    const done = vi.fn();
    focusWhenPresent("row", done, 5000, env);
    expect(log).toEqual(["row"]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an element rendered later (a tab that reads its own data) and focuses it when it appears", () => {
    const env = environment();
    const done = vi.fn();
    focusWhenPresent("row", done, 5000, env);
    env.changed();
    expect(done).not.toHaveBeenCalled();
    env.present["row"] = element("row", log);
    env.changed();
    expect(log).toEqual(["row"]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(env.disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up after the timeout without focusing anything, and reports done", () => {
    const env = environment();
    const done = vi.fn();
    focusWhenPresent("row", done, 5000, env);
    vi.advanceTimersByTime(4999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);
    expect(env.disconnect).toHaveBeenCalled();
  });

  it("stops watching when cleaned up", () => {
    const env = environment();
    const done = vi.fn();
    const cleanup = focusWhenPresent("row", done, 5000, env);
    cleanup();
    env.present["row"] = element("row", log);
    env.changed();
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual([]);
    expect(done).not.toHaveBeenCalled();
    expect(env.disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
