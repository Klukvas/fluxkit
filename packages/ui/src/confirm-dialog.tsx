import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

export interface ConfirmDialogProps {
  open: boolean;
  /** Cancel button and Escape. Not called while `busy`. */
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` for destructive actions: the confirm button gets the danger look. */
  tone?: "default" | "danger";
  /** A request is running: both buttons are disabled, so it cannot be repeated or abandoned halfway. */
  busy?: boolean;
  /** Extra content between the description and the buttons, for example a reason field. */
  children?: ReactNode;
}

/** Confirmation of one action. `alertdialog`: it needs an answer. The focus starts on cancel, the safe choice. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  busy = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={title}
      description={description}
      role="alertdialog"
      aria-busy={busy || undefined}
      footer={
        <>
          <Button
            variant="secondary"
            data-autofocus=""
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
