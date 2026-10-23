import { ConfirmDialog } from "@fluxkit/ui";
import { useState, type ReactNode } from "react";
import type { Blocker } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { leaveOrAsk, useUnsavedChangesRegistry } from "./unsaved-changes";

/** The question itself; the safe choice (stay) has the focus. */
function LeaveDialog({ onLeave, onStay }: { onLeave: () => void; onStay: () => void }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      open
      tone="danger"
      title={t("unsaved.title")}
      description={t("unsaved.description")}
      confirmLabel={t("unsaved.leave")}
      cancelLabel={t("unsaved.stay")}
      onConfirm={onLeave}
      onClose={onStay}
    />
  );
}

/** The question of `useUnsavedChangesGuard` for in-app navigation. */
export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  if (blocker.state !== "blocked") return null;
  return <LeaveDialog onLeave={() => blocker.proceed()} onStay={() => blocker.reset()} />;
}

/**
 * The same question for an action that leaves the page without a navigation the router could block (sign-out):
 * `confirm(leave)` runs `leave` at once when no form of the page has unsaved input, else after "Leave". Render `dialog`.
 */
export function useConfirmLeave(): { confirm: (leave: () => void) => void; dialog: ReactNode } {
  const registry = useUnsavedChangesRegistry();
  const [pending, setPending] = useState<{ leave: () => void } | null>(null);
  return {
    confirm: (leave) => leaveOrAsk(registry, leave, (asked) => setPending({ leave: asked })),
    dialog:
      pending === null ? null : (
        <LeaveDialog
          onLeave={() => {
            setPending(null);
            pending.leave();
          }}
          onStay={() => setPending(null)}
        />
      ),
  };
}
