import type { EffectCallback, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cartLine, cartOf } from "../lib/test-fixtures";
import { createQuantityAutosave } from "../lib/quantity-autosave";
import { CartDrawerProvider } from "./cart-drawer-provider";
import { CartDrawer } from "./cart-drawer";

// Hook slots persist across render calls, effects run after each dependency change.
// No DOM is needed: these controllers return view elements whose callbacks we exercise directly.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  function memo<T>(factory: () => T, deps: readonly unknown[]): T {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as { value: T; deps: readonly unknown[] } | undefined;
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      hooks.slots[index] = { value: factory(), deps };
    }
    return (hooks.slots[index] as { value: T }).value;
  }
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (value: T) => {
          hooks.slots[index] = value;
        },
      ];
    },
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => memo(() => callback, deps),
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useEffect: (effect: EffectCallback, deps: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { deps: readonly unknown[]; cleanup?: ReturnType<EffectCallback> } | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks.effects.push(() => {
          if (typeof previous?.cleanup === "function") previous.cleanup();
          hooks.slots[index] = { deps, cleanup: effect() };
        });
      }
    },
    useContext: () => context.drawer,
  };
});
const context = vi.hoisted(() => ({
  drawer: { isOpen: true, opener: null, open: vi.fn(), close: vi.fn() },
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: context.push }) }));
vi.mock("./i18n-provider", () => ({ useI18n: () => ({ locale: "en", t: vi.fn() }) }));
vi.mock("./session-provider", () => ({
  useCart: () => ({
    state: {},
    store: { getState: () => ({ cart: cartOf([cartLine("one")]) }) },
  }),
}));
function render<T>(component: () => T): T {
  hooks.cursor = 0;
  const tree = component();
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  context.drawer.isOpen = true;
  vi.clearAllMocks();
});

describe("drawer lifecycle", () => {
  it("omits the drawer initially, mounts on first open, and retains it through close/reopen", () => {
    const drawer = <span>drawer instance</span>;
    const draw = () => render(() => CartDrawerProvider({ children: null, drawer }));
    let tree = draw();
    const children = () => tree.props.children as ReactNode[];
    expect(children()).not.toContain(drawer);
    tree.props.value.open({} as HTMLElement);
    tree = draw();
    expect(children()).toContain(drawer);
    tree.props.value.close();
    tree = draw();
    expect(tree.props.value.isOpen).toBe(false);
    expect(children()).toContain(drawer);
    tree.props.value.open({} as HTMLElement);
    tree = draw();
    expect(children()).toContain(drawer);
  });

  it("reopening retains pending saves and a fresh checkout waits for the same line", async () => {
    const answers: (() => void)[] = [];
    const save = vi.fn(
      () =>
        new Promise<{ status: "ok" }>((resolve) => {
          answers.push(() => resolve({ status: "ok" }));
        }),
    );
    const autosave = createQuantityAutosave({ serverQuantity: () => 1, save });
    const draw = () => render(() => CartDrawer({ exponent: 2, imageHosts: [] }));
    let tree = draw();
    tree.props.registerLine("one", autosave);
    autosave.change(2);
    tree.props.onCheckout({ preventDefault: vi.fn() });
    tree.props.onClose();
    context.drawer.isOpen = false;
    draw();
    context.drawer.isOpen = true;
    tree = draw();
    autosave.change(3);
    const preventDefault = vi.fn();
    tree.props.onCheckout({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(1);
    expect(context.push).not.toHaveBeenCalled();
    answers[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.push).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(2);
    answers[1]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.push).toHaveBeenCalledExactlyOnceWith("/en/checkout");
    autosave.dispose();
  });

  it("cancels checkout after dismissal while a save is pending, and resets leaving", async () => {
    let answer: () => void = () => undefined;
    const autosave = createQuantityAutosave({
      serverQuantity: () => 1,
      save: () =>
        new Promise((resolve) => {
          answer = () => resolve({ status: "ok" });
        }),
    });
    const draw = () => render(() => CartDrawer({ exponent: 2, imageHosts: [] }));
    let tree = draw();
    const registerLine = tree.props.registerLine;
    tree.props.registerLine("one", autosave);
    autosave.change(2);
    tree.props.onCheckout({ preventDefault: vi.fn() });
    tree = draw();
    expect(tree.props.leaving).toBe(true);
    tree.props.onClose();
    context.drawer.isOpen = false;
    draw();
    tree = draw();
    const leavingAfterClose = tree.props.leaving;
    context.drawer.isOpen = true;
    tree = draw();
    expect(tree.props.registerLine).toBe(registerLine);
    answer();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.push).not.toHaveBeenCalled();
    expect(leavingAfterClose).toBe(false);
  });
});
