"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { nativeCloseAction, openModal, type FocusableLike } from "./dialog-focus";
import { textStyles } from "./styles";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  /** Preserve the actual submitter, including a sticky button outside the form. */
  opener?: FocusableLike | null;
  children: ReactNode;
  footer?: ReactNode;
}

export function cancelDrawer(event: { preventDefault(): void }, onClose: () => void): void {
  event.preventDefault();
  onClose();
}

/**
 * Native modal semantics make the page inert. May stay mounted while closed: the open
 * effect's closer closes the dialog and returns focus to its opener when open becomes false.
 * No exit animation: a closed dialog is display:none immediately. The @starting-style
 * entry replays on every modal open, including after a close without unmounting.
 */
export function Drawer({
  open,
  onClose,
  title,
  closeLabel,
  opener,
  children,
  footer,
}: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return openModal(dialog, opener ?? active);
  }, [open, opener]);

  return (
    <dialog
      ref={ref}
      data-drawer=""
      aria-labelledby={titleId}
      className="fk-drawer text-foreground"
      onCancel={(event) => cancelDrawer(event, onClose)}
      onClose={(event) => {
        if (nativeCloseAction(open, event.currentTarget.open, true) === "close") onClose();
      }}
    >
      <button
        type="button"
        aria-label={closeLabel}
        tabIndex={-1}
        className="fk-drawer-backdrop absolute inset-0 bg-foreground/50"
        onClick={onClose}
      />
      <section className="fk-drawer-panel relative ms-auto flex h-full w-full max-w-md flex-col border-s border-border bg-background shadow-overlay">
        <header className="flex items-center justify-between gap-4 border-b border-border p-4">
          <h2 id={titleId} className={textStyles.dialogTitle}>
            {title}
          </h2>
          <Button
            data-autofocus
            variant="secondary"
            className="min-h-11 min-w-11"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <footer className="fk-drawer-footer border-t border-border p-4">{footer}</footer>
        ) : null}
      </section>
    </dialog>
  );
}
