import type { EffectCallback } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { Drawer } from "./drawer";
import type { DialogLike } from "./dialog-focus";

const runtime = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  dialog: null as DialogLike | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => ({ current: runtime.dialog }),
  useId: () => "drawer-title",
  useEffect: (effect: EffectCallback) => {
    runtime.effects.push(effect);
  },
}));
beforeEach(() => {
  runtime.effects = [];
});

it("closes through the effect cleanup while mounted, restores focus, and reopens safely after StrictMode cleanup", () => {
  const focus = vi.fn();
  const onClose = vi.fn();
  const dialog: DialogLike = {
    open: false,
    showModal: vi.fn(() => {
      dialog.open = true;
    }),
    close: vi.fn(() => {
      dialog.open = false;
    }),
    querySelector: () => null,
  };
  runtime.dialog = dialog;
  const props = {
    open: true,
    title: "Cart",
    closeLabel: "Close",
    onClose,
    opener: { isConnected: true, focus },
    children: null,
  };
  vi.stubGlobal("HTMLElement", Object);
  vi.stubGlobal("document", { activeElement: null });
  try {
    const open = () => {
      const tree = Drawer(props);
      const close = runtime.effects.pop()?.();
      expect(dialog.open).toBe(true);
      return { tree, close };
    };
    const first = open();
    first.close?.();
    expect(dialog.open).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
    const replay = open();
    // A native close event queued by StrictMode's cleanup arrives after reopening.
    replay.tree.props.onClose({ currentTarget: dialog });
    expect(onClose).not.toHaveBeenCalled();
    replay.close?.();
    Drawer({ ...props, open: false });
    runtime.effects.pop()?.();
    expect(dialog.open).toBe(false);
    expect(focus).toHaveBeenCalledTimes(2);
    const reopened = open();
    expect(dialog.showModal).toHaveBeenCalledTimes(3);
    reopened.close?.();
  } finally {
    vi.unstubAllGlobals();
  }
});
