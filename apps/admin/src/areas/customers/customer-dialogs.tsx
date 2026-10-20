import { ConfirmDialog, type Translator } from "@fluxkit/ui";

/**
 * The confirmation of the one action that gets one: deactivating a customer (it ends their sessions at once). Props in,
 * markup out; Escape and the buttons do nothing while the write runs. Activating and unlocking are reversible or only
 * relax a lock and need no confirmation (their effect is spelled out beside the button).
 */
export function DeactivateDialog({
  t,
  open,
  busy,
  onConfirm,
  onClose,
}: {
  t: Translator;
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      tone="danger"
      title={t("customer.deactivate.title")}
      description={t("customer.deactivate.description")}
      confirmLabel={busy ? t("customer.dialog.sending") : t("customer.deactivate.submit")}
      cancelLabel={t("customer.dialog.cancel")}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
