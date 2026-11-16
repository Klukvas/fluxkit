import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A minimal hook runtime (the admin's unit tests run in plain Node, no DOM and no React renderer): `render()` is one
 * React render plus its commit (the effects whose dependencies changed run, after the cleanup of their previous run),
 * a state update asks for another one, and `unmount()` runs every cleanup.
 */
const runtime = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  pending: [] as { index: number; effect: () => (() => void) | undefined }[],
  cleanups: new Map<number, () => void>(),
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
  useRef<T>(initial: T) {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = { current: initial };
    return runtime.slots[index] as { current: T };
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
  useEffect(effect: () => (() => void) | undefined, deps?: unknown[]) {
    const index = runtime.cursor++;
    const previous = runtime.slots[index] as { deps: unknown[] | undefined } | undefined;
    const changed =
      previous === undefined ||
      deps === undefined ||
      previous.deps === undefined ||
      deps.some((dep, i) => !Object.is(dep, previous.deps?.[i]));
    runtime.slots[index] = { deps };
    if (changed) runtime.pending.push({ index, effect });
  },
}));

import {
  secretHolder,
  useSecretValues,
  watchPageLifecycle,
  type PageLifecycleEvent,
  type PageLifecycleTarget,
  type SecretValues,
} from "./use-secret-values";

type Listener = (event: PageLifecycleEvent) => void;

/** A stand-in for `window`: records the listeners and lets a test fire the two events. */
function fakePage() {
  const listeners = new Map<string, Set<Listener>>();
  const target: PageLifecycleTarget = {
    addEventListener: (type, listener) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    target,
    fire: (type: "pagehide" | "pageshow", event: PageLifecycleEvent = {}) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

interface Form {
  value: string;
  currentPassword: string;
}
const BLANK: Form = { value: "", currentPassword: "" };
const TYPED: Form = { value: "fake_abcdefgh12345678", currentPassword: "owner-password" };

function mount(initialHolder: string | null, page = fakePage()) {
  runtime.slots = [];
  runtime.pending = [];
  runtime.cleanups = new Map();
  runtime.dirty = false;
  const onRevoked = vi.fn();
  let holder = initialHolder;
  let current: SecretValues<Form>;
  const commit = () => {
    do {
      runtime.dirty = false;
      runtime.cursor = 0;
      runtime.pending = [];
      // A new function every render, as an inline callback of a component is.
      current = useSecretValues(BLANK, holder, () => onRevoked(), page.target);
      for (const { index, effect } of runtime.pending) {
        runtime.cleanups.get(index)?.();
        runtime.cleanups.delete(index);
        const cleanup = effect();
        if (typeof cleanup === "function") runtime.cleanups.set(index, cleanup);
      }
    } while (runtime.dirty);
  };
  commit();
  return {
    page,
    onRevoked,
    get: () => current,
    render: commit,
    setHolder: (next: string | null) => {
      holder = next;
      commit();
    },
    type: (values: Form) => {
      current.set(values);
      commit();
    },
    unmount: () => {
      for (const cleanup of runtime.cleanups.values()) cleanup();
      runtime.cleanups.clear();
    },
    /** The values as they are in the hook's state, whatever a render would hand out. */
    stored: () => runtime.slots[1] as Form,
  };
}

beforeEach(() => {
  runtime.slots = [];
});

describe("watchPageLifecycle", () => {
  it("wipes on every pagehide and on a pageshow from the Back/Forward cache only", () => {
    const page = fakePage();
    const wipe = vi.fn();
    watchPageLifecycle(wipe, page.target);
    page.fire("pageshow", { persisted: false });
    page.fire("pageshow");
    expect(wipe).not.toHaveBeenCalled();
    page.fire("pagehide", { persisted: false });
    page.fire("pagehide", { persisted: true });
    page.fire("pageshow", { persisted: true });
    expect(wipe).toHaveBeenCalledTimes(3);
  });

  it("stops listening when asked", () => {
    const page = fakePage();
    const wipe = vi.fn();
    const stop = watchPageLifecycle(wipe, page.target);
    expect(page.count()).toBe(2);
    stop();
    expect(page.count()).toBe(0);
    page.fire("pagehide");
    expect(wipe).not.toHaveBeenCalled();
  });
});

describe("secretHolder", () => {
  const me = { user: { id: "owner-1" } };
  it("is the signed-in admin, and nobody in every other session state", () => {
    expect(secretHolder({ status: "signedIn", me })).toBe("owner-1");
    for (const status of ["expired", "signedOut", "loading", "failed"]) {
      expect(secretHolder({ status, me }), status).toBeNull();
    }
    expect(secretHolder({ status: "signedIn", me: null })).toBeNull();
  });
});

describe("useSecretValues", () => {
  it("starts empty and holds what is typed across renders", () => {
    const hook = mount("owner-1");
    expect(hook.get().values).toEqual(BLANK);
    hook.type(TYPED);
    hook.render();
    expect(hook.get().values).toEqual(TYPED);
    expect(hook.onRevoked).not.toHaveBeenCalled();
  });

  it("take: hands the values out once and leaves the state empty, whatever the request answers", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    expect(hook.get().take()).toEqual(TYPED);
    hook.render();
    expect(hook.get().values).toEqual(BLANK);
    expect(hook.stored()).toEqual(BLANK);
    expect(hook.onRevoked).not.toHaveBeenCalled();
  });

  it("wipe (cancel, close): empties the state", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    hook.get().wipe();
    hook.render();
    expect(hook.stored()).toEqual(BLANK);
  });

  it("session expiry: the values are gone in the same render and the dialog is told to close", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    hook.setHolder(null);
    expect(hook.get().values).toEqual(BLANK);
    expect(hook.stored()).toEqual(BLANK);
    expect(hook.onRevoked).toHaveBeenCalledTimes(1);
  });

  it("another admin signs in: the values never reach that session", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    hook.setHolder("owner-2");
    expect(hook.get().values).toEqual(BLANK);
    expect(hook.get().take()).toEqual(BLANK);
    expect(hook.stored()).toEqual(BLANK);
    expect(hook.onRevoked).toHaveBeenCalledTimes(1);
  });

  it("the same admin read again (after a 403) keeps the values", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    hook.setHolder("owner-1");
    expect(hook.get().values).toEqual(TYPED);
    expect(hook.onRevoked).not.toHaveBeenCalled();
  });

  it("pagehide: wipes and closes", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    hook.page.fire("pagehide", { persisted: true });
    hook.render();
    expect(hook.stored()).toEqual(BLANK);
    expect(hook.onRevoked).toHaveBeenCalledTimes(1);
  });

  it("pageshow from the Back/Forward cache: wipes and closes; an ordinary pageshow does nothing", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    hook.page.fire("pageshow", { persisted: false });
    hook.render();
    expect(hook.stored()).toEqual(TYPED);
    hook.page.fire("pageshow", { persisted: true });
    hook.render();
    expect(hook.stored()).toEqual(BLANK);
    expect(hook.onRevoked).toHaveBeenCalledTimes(1);
  });

  it("unmount (navigation, the dialog closed by its parent): wipes and stops listening", () => {
    const hook = mount("owner-1");
    hook.type(TYPED);
    hook.unmount();
    expect(hook.stored()).toEqual(BLANK);
    expect(hook.page.count()).toBe(0);
  });

  it("typing and re-rendering never wipes: the listeners are set once, not per render", () => {
    const hook = mount("owner-1");
    hook.type({ ...TYPED, currentPassword: "" });
    hook.type(TYPED);
    hook.render();
    hook.render();
    expect(hook.stored()).toEqual(TYPED);
    expect(hook.page.count()).toBe(2);
  });

  it("calls the newest onRevoked, not the one of the first render", () => {
    const hook = mount("owner-1");
    hook.render();
    hook.page.fire("pagehide");
    expect(hook.onRevoked).toHaveBeenCalledTimes(1);
  });
});
