import { describe, expect, it } from "vitest";
import { openModal, type DialogLike, type FocusableLike } from "./dialog-focus";

function fakeDialog(options: { initialFocus?: FocusableLike | null; open?: boolean } = {}) {
  const calls: string[] = [];
  const dialog: DialogLike & { calls: string[] } = {
    calls,
    open: options.open ?? false,
    showModal() {
      calls.push("showModal");
      dialog.open = true;
    },
    close() {
      calls.push("close");
      dialog.open = false;
    },
    querySelector(selector) {
      calls.push(`query ${selector}`);
      return options.initialFocus ?? null;
    },
  };
  return dialog;
}

function fakeFocusable(isConnected = true) {
  const state = { isConnected, focused: 0 };
  return Object.assign(state, {
    focus() {
      state.focused += 1;
    },
  });
}

describe("openModal", () => {
  it("opens the dialog as a modal", () => {
    const dialog = fakeDialog();
    openModal(dialog, null);
    expect(dialog.open).toBe(true);
    expect(dialog.calls).toContain("showModal");
  });

  it("does not open a dialog that is already open", () => {
    const dialog = fakeDialog({ open: true });
    openModal(dialog, null);
    expect(dialog.calls).not.toContain("showModal");
  });

  it("moves the focus to the marked initial control, when there is one", () => {
    const initial = fakeFocusable();
    openModal(fakeDialog({ initialFocus: initial }), null);
    expect(initial.focused).toBe(1);
  });

  it("closes the dialog and returns the focus to the opener", () => {
    const dialog = fakeDialog();
    const opener = fakeFocusable();
    const close = openModal(dialog, opener);
    expect(opener.focused).toBe(0);
    close();
    expect(dialog.open).toBe(false);
    expect(opener.focused).toBe(1);
  });

  it("does not focus an opener that left the document", () => {
    const opener = fakeFocusable(false);
    openModal(fakeDialog(), opener)();
    expect(opener.focused).toBe(0);
  });

  it("closes without an opener and closes only once", () => {
    const dialog = fakeDialog();
    const close = openModal(dialog, null);
    close();
    close();
    expect(dialog.calls.filter((call) => call === "close")).toHaveLength(1);
  });

  it("returns the focus even when the dialog was already closed from outside", () => {
    const dialog = fakeDialog();
    const opener = fakeFocusable();
    const close = openModal(dialog, opener);
    dialog.open = false;
    close();
    expect(opener.focused).toBe(1);
  });
});
