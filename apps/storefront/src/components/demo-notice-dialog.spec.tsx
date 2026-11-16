import { Button, Dialog, createTranslator } from "@fluxkit/ui";
import type { EffectCallback, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messagesByLocale } from "../messages";
import { DemoNoticeDialog } from "./demo-notice-dialog";
import { findElements } from "./test-helpers";

// Same controller-level hook harness as cart-drawer-lifecycle.spec.tsx: effects are flushed explicitly after hydration.
const hooks = vi.hoisted(() => ({ open: false, effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    hooks.open,
    (value: boolean) => {
      hooks.open = value;
    },
  ],
  useEffect: (effect: EffectCallback) => {
    hooks.effects.push(effect);
  },
}));
vi.mock("./i18n-provider", () => ({
  useI18n: () => ({ locale: "en", t: createTranslator(messagesByLocale.en, "en") }),
}));

const key = "fluxkit_demo_notice_seen";
let stored: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

beforeEach(() => {
  hooks.open = false;
  hooks.effects = [];
  stored = new Map();
  storage = {
    getItem: vi.fn((name: string) => stored.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      stored.set(name, value);
    }),
  };
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

function hydrate() {
  const initial = DemoNoticeDialog();
  expect(initial.type).toBe(Dialog);
  expect(initial.props.open).toBe(false);
  expect(storage.getItem).not.toHaveBeenCalled();
  hooks.effects.splice(0).forEach((effect) => effect());
  return DemoNoticeDialog();
}

describe("first-visit demo dialog lifecycle", () => {
  it("marks the absent key seen before opening after hydration", () => {
    storage.setItem.mockImplementation((name: string, value: string) => {
      expect(hooks.open).toBe(false);
      stored.set(name, value);
    });
    expect(hydrate().props.open).toBe(true);
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(key);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(key, "true");
    expect(stored.get(key)).toBe("true");
  });

  it.each(["true", "", "false"])("stays closed when the key already exists (%j)", (value) => {
    stored.set(key, value);
    expect(hydrate().props.open).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["button", "Escape", "FluxLab link"])(
    "%s closes without accessing storage and stays closed on the next visit",
    (via) => {
      const dialog = hydrate();
      expect(stored.get(key)).toBe("true");
      storage.getItem.mockClear();
      storage.setItem.mockClear();
      if (via === "Escape") {
        // The shared Dialog maps native Escape/cancel to this callback (its own focus/keyboard specs cover that mapping).
        dialog.props.onClose();
      } else {
        const footer = dialog.props.footer as ReactElement;
        const [control] = findElements(footer, (element) =>
          via === "button" ? element.type === Button : element.type === "a",
        );
        expect(control).toBeDefined();
        if (via === "FluxLab link") {
          expect(control?.props.href).toBe(
            "https://flux-lab.dev/en?utm_source=fluxkit-demo&utm_medium=demo-notice",
          );
          expect(control?.props.target).toBe("_blank");
          expect(control?.props.rel).toBe("noopener noreferrer");
        }
        (control?.props.onClick as () => void)();
      }
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(DemoNoticeDialog().props.open).toBe(false);
      hooks.open = false;
      hooks.effects = [];
      storage.getItem.mockClear();
      expect(hydrate().props.open).toBe(false);
    },
  );

  it.each(["getter", "read"])("keeps closed when the storage %s throws", (failure) => {
    if (failure === "getter") {
      vi.stubGlobal("window", {
        get localStorage() {
          throw new Error("blocked");
        },
      });
    } else {
      storage.getItem.mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    expect(hydrate().props.open).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("keeps closed on mount and remount when reading works but writing throws", () => {
    storage.setItem.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(hydrate().props.open).toBe(false);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(key, "true");
    expect(stored.has(key)).toBe(false);
    hooks.open = false;
    hooks.effects = [];
    storage.getItem.mockClear();
    expect(hydrate().props.open).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("still closes if storage becomes unwritable after the dialog opens", () => {
    const dialog = hydrate();
    storage.setItem.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => dialog.props.onClose()).not.toThrow();
    expect(DemoNoticeDialog().props.open).toBe(false);
  });
});
