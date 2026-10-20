import { Button, ConfirmDialog, Dialog, type Translator } from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import { useState } from "react";
import type { AdminResult } from "@fluxkit/api-client";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { WriteOutcome } from "../../lib/run-write";
import { FormErrorSummary } from "./form-parts";
import { useFormSubmit } from "./use-form-submit";

/**
 * A modal form (add or edit a row of a section): the form is inside the dialog, its submit button is in the footer and
 * linked with the `form` attribute. Escape and Cancel close it (a half-typed row is discarded on purpose); while a request
 * runs both are off.
 */
export function FormDialog({
  t,
  title,
  description,
  formId,
  busy,
  submitLabel,
  busyLabel,
  onClose,
  onSubmit,
  summary,
  summaryRef,
  children,
}: {
  t: Translator;
  title: string;
  description?: string;
  formId: string;
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("dict.form.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy || undefined}>
            {busy ? busyLabel : submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
        {children}
      </form>
    </Dialog>
  );
}

/**
 * Delete with a confirmation (danger tone, the safe choice focused). A refusal (`409 in_use` or a rule) is explained in
 * the dialog and the dialog stays open; a lost answer closes it and hands over to the page, which reloads what the
 * server has. Renders nothing without write permission.
 */
export function ConfirmDelete({
  t,
  canWrite,
  open,
  onClose,
  remove,
  onDeleted,
  onUnknown,
  title,
  description,
  hint,
  confirmLabel,
}: {
  t: Translator;
  canWrite: boolean;
  open: boolean;
  onClose: () => void;
  remove: () => Promise<AdminResult<undefined>>;
  onDeleted: () => void;
  onUnknown: () => void;
  title: string;
  description: string;
  /** What to do when the item is still used (shown with a 409). */
  hint: string;
  confirmLabel: string;
}) {
  const form = useFormSubmit([]);
  if (!canWrite) return null;

  async function confirm() {
    const outcome: WriteOutcome<undefined> = await form.submit(remove);
    if (outcome.kind === "ok") {
      form.clear();
      onDeleted();
    } else if (outcome.kind === "unknown") {
      form.clear();
      onUnknown();
    }
  }

  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      busy={form.state.busy}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={t("dict.form.cancel")}
      onClose={() => {
        form.clear();
        onClose();
      }}
      onConfirm={() => void confirm()}
    >
      <FormErrorSummary t={t} summary={form.state.summary} summaryRef={form.summaryRef} />
      {form.state.status === 409 ? <p className="mt-3 text-muted-foreground">{hint}</p> : null}
    </ConfirmDialog>
  );
}

/** State of "which row is being edited or deleted" for a section: one dialog at a time. */
export function useDialogTarget<Target>() {
  const [target, setTarget] = useState<{ target: Target; n: number } | null>(null);
  return {
    target: target?.target ?? null,
    key: target?.n ?? 0,
    open: (next: Target) => setTarget((current) => ({ target: next, n: (current?.n ?? 0) + 1 })),
    close: () => setTarget(null),
  };
}
