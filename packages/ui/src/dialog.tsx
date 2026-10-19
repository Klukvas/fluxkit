"use client";

import { useEffect, useId, useRef, type DialogHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { openModal } from "./dialog-focus";

export interface DialogProps extends Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  "open" | "title" | "onClose" | "onCancel"
> {
  /** Controlled: the caller owns the state, the dialog follows it. */
  open: boolean;
  /** Called when the user presses Escape. The caller closes the dialog by setting `open` to false. */
  onClose: () => void;
  /** Escape is ignored while false (for example while a request is running). */
  dismissible?: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** Actions, rendered after the body. */
  footer?: ReactNode;
}

// Separate string on purpose: the backdrop is not the surface behind the dialog's text (see the contrast scan).
const backdrop = "backdrop:bg-foreground/50";

/**
 * Modal dialog on the native `<dialog>`: `showModal()` makes the rest of the page inert, traps the focus and gives
 * Escape. Client component: opening needs an effect. It never renders the `open` attribute (that would open it
 * without the modal behavior); the server renders it closed. A click on the backdrop does nothing, so a half-filled
 * form is never discarded by a stray click; closing is an explicit action or Escape.
 */
export function Dialog({
  open,
  onClose,
  dismissible = true,
  title,
  description,
  footer,
  className,
  children,
  ...props
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) {
      return undefined;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return openModal(dialog, opener);
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // The native cancel (Escape) would close the dialog behind React's back; the state stays the single source.
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) {
          onClose();
        }
      }}
      // A second Escape press can close the dialog natively without a cancel event; bring the state back in line.
      onClose={() => {
        if (!open) {
          return;
        }
        if (dismissible) {
          onClose();
        } else {
          dialogRef.current?.showModal();
        }
      }}
      className={cn(
        "m-auto w-full max-w-lg rounded-lg border border-border bg-background p-6 text-foreground shadow-card",
        backdrop,
        className,
      )}
      {...props}
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      {description ? (
        <p id={descriptionId} className="mt-2 text-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
      {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
    </dialog>
  );
}
