import { ConfirmDialog } from "@fluxkit/ui";
import type { Blocker } from "react-router";
import { useI18n } from "../i18n/i18n-context";

/** The question of `useUnsavedChangesGuard` for in-app navigation; the safe choice (stay) has the focus. */
export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  const { t } = useI18n();
  if (blocker.state !== "blocked") return null;
  return (
    <ConfirmDialog
      open
      tone="danger"
      title={t("unsaved.title")}
      description={t("unsaved.description")}
      confirmLabel={t("unsaved.leave")}
      cancelLabel={t("unsaved.stay")}
      onConfirm={() => blocker.proceed()}
      onClose={() => blocker.reset()}
    />
  );
}
