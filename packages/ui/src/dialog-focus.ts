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
