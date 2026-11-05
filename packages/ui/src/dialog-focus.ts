export interface FocusableLike {
  isConnected: boolean;
  focus(): void;
}

/** The part of `HTMLDialogElement` that `openModal` uses, so the logic runs without a DOM in tests. */
export interface DialogLike {
  open: boolean;
  showModal(): void;
  close(): void;
  querySelector(selector: string): FocusableLike | null;
}

/** Marks the control that gets the focus when a dialog opens (the safe choice of a confirmation). */
export const initialFocusSelector = "[data-autofocus]";

/** What the dialog does with a native `close` event. */
export type NativeCloseAction = "ignore" | "close" | "reopen";

/**
 * The answer to a native `close` event of a controlled dialog (the browser closed it without asking React, for example a
 * second Escape that fires no `cancel`):
 * - `ignore` while the state says closed (the dialog was closed by state, nothing to bring in line), and while the element
 *   is open again: the event is stale. React's StrictMode (the admin's `vite dev`) runs the open effect, its cleanup
 *   (`dialog.close()`, which QUEUES a `close` event) and the effect again (`showModal()`) before the event fires; acting on
 *   it would close a dialog that has just opened. Production builds run the effect once, so they never saw it.
 * - `close` (tell the caller) when it may be dismissed, else `reopen` it.
 */
export function nativeCloseAction(
  propOpen: boolean,
  elementOpen: boolean,
  dismissible: boolean,
): NativeCloseAction {
  if (!propOpen || elementOpen) {
    return "ignore";
  }
  return dismissible ? "close" : "reopen";
}

/**
 * Opens the dialog as a modal and returns the function that closes it and puts the focus back on the element that
 * opened it. Returning the focus is done here, not left to the browser, so it also works when the dialog is closed by
 * state (a controlled `open` prop) and the opener is only known to the caller. An opener that left the document is skipped.
 */
export function openModal(dialog: DialogLike, opener: FocusableLike | null): () => void {
  if (!dialog.open) {
    dialog.showModal();
  }
  dialog.querySelector(initialFocusSelector)?.focus();
  let closed = false;
  return () => {
    if (closed) {
      return;
    }
    closed = true;
    if (dialog.open) {
      dialog.close();
    }
    if (opener?.isConnected) {
      opener.focus();
    }
  };
}
