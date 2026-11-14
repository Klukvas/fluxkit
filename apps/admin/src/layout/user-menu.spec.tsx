import type { EffectCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => [] as EffectCallback[]);
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useLayoutEffect: (effect: EffectCallback) => effects.push(effect),
}));
import { renderInRouter, sentinelTranslator } from "../test-helpers";
import { emailInitials, UserMenuView } from "./user-menu";

const props = {
  t: sentinelTranslator(),
  email: "admin@example.com",
  signingOut: false,
  failure: null,
  onSignOut: () => undefined,
};

describe("account disclosure", () => {
  it.each([
    ["a@example.com", "A"],
    ["admin@example.com", "AD"],
    ["їжак@example.com", "ЇЖ"],
    ["12.a-b@example.com", "AB"],
    ["@example.com", ""],
    ["", ""],
  ])("derives decorative initials from %s", (email, initials) => {
    expect(emailInitials(email)).toBe(initials);
  });
  it("starts closed with a named button, popup association and ordinary links", () => {
    const html = renderInRouter(<UserMenuView {...props} />);
    expect(html).toContain("§shell.userMenu");
    expect(html).toContain('aria-expanded="false"');
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}" hidden=""`);
    expect(html).not.toContain('role="menu"');
    expect(html).toContain('href="/admin-ui/account"');
  });
  it("renders controlled open, pending and failure states with translated text", () => {
    const html = renderInRouter(
      <UserMenuView {...props} open signingOut failure={{ key: "errors.network" }} />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden=""');
    expect(html).toContain('disabled="" aria-busy="true"');
    expect(html).toContain("§shell.signingOut");
    expect(html).toMatch(/<\/section><p role="alert"[^>]*>§errors.network/);
  });
  it("falls back to a decorative user icon for an empty local part", () => {
    const html = renderInRouter(<UserMenuView {...props} email="" />);
    expect(html.match(/<svg /g)).toHaveLength(2);
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("disclosure outside-event dismissal", () => {
  afterEach(() => {
    effects.length = 0;
    vi.unstubAllGlobals();
  });

  it("keeps the account link available while the router's leave dialog owns focus", () => {
    const listeners = new Map<string, (event: { target: object }) => void>();
    let modalOpen = true;
    class OutsideNode {
      readonly nodeType = 1;
    }
    vi.stubGlobal("Node", OutsideNode);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        expect(selector).toBe("dialog[open]");
        return modalOpen ? {} : null;
      },
      addEventListener: (name: string, listener: (event: { target: object }) => void) =>
        listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    const onOpenChange = vi.fn();
    effects.length = 0;
    renderInRouter(<UserMenuView {...props} open onOpenChange={onOpenChange} />);
    const cleanup = effects.map((effect) => effect());
    try {
      // Opening the leave dialog focuses Stay; clicking Stay must also keep the disclosure open.
      const event = { target: new OutsideNode() };
      listeners.get("focusin")?.(event);
      listeners.get("pointerdown")?.(event);
      expect(onOpenChange).not.toHaveBeenCalled();
      // After Stay, normal outside-focus dismissal resumes.
      modalOpen = false;
      listeners.get("focusin")?.(event);
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    } finally {
      for (const dispose of cleanup) dispose?.();
    }
  });
});
