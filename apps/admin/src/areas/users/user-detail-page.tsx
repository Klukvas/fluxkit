import type { AdminResult, AdminRole, AdminUser } from "@fluxkit/api-client";
import { Alert, type Translator } from "@fluxkit/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite, type WriteOutcome } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useCrash } from "../../lib/use-crash";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { useSession } from "../../session/session-context";
import { PageHeading, ResourceFallback } from "../../views/status-views";
import {
  activityPatch,
  confirmationOf,
  describeUserRefusal,
  offeredUserActions,
  rolePatch,
  stateAfterUnknown,
  type UserAction,
} from "./user-actions";
import { DeactivateDialog, RoleChangeDialog } from "./user-dialogs";
import { UserDetailView } from "./user-detail-view";
import { DescriptorText, StatusLine } from "./user-parts";
import { ResetPasswordSection } from "./user-reset-form";
import { isSelf, roleLabelKey } from "./user-view";

/** What the status line says after an answer; the user on screen is always the server's (reloaded). */
export type UserNotice =
  | { kind: "done"; action: UserAction; self: boolean }
  | { kind: "refused"; action: UserAction; descriptor: MessageDescriptor }
  /** `before` is the user as read before the write: the reading text shows until a newer read replaces it. */
  | { kind: "unknown"; action: UserAction; before: AdminUser; sentRole?: AdminRole };

export function UserNoticeView({
  t,
  notice,
  user,
  refreshing,
}: {
  t: Translator;
  notice: UserNotice | null;
  /** The user as last read (after the reload that follows every answer); `null` when it could not be read. */
  user: AdminUser | null;
  refreshing: boolean;
}) {
  if (notice === null) return null;
  switch (notice.kind) {
    case "done":
      return (
        <Alert variant="success">
          {t(
            notice.self && notice.action === "resetPassword"
              ? "user.notice.done.resetPasswordSelf"
              : `user.notice.done.${notice.action}`,
          )}
        </Alert>
      );
    case "refused":
      return (
        <Alert variant="danger" title={t(`user.notice.refused.${notice.action}`)}>
          <p>
            <DescriptorText t={t} descriptor={notice.descriptor} />
          </p>
        </Alert>
      );
    case "unknown": {
      if (refreshing || user === notice.before) {
        return (
          <Alert variant="warning" title={t("user.notice.unknownTitle")}>
            <p>{t("user.notice.unknownReading")}</p>
          </Alert>
        );
      }
      const state = stateAfterUnknown(notice.action, notice.sentRole, user);
      return (
        <Alert variant="warning" title={t("user.notice.unknownTitle")}>
          <p>
            {state.kind === "roleIs"
              ? t(
                  state.changed
                    ? "user.notice.unknown.roleChanged"
                    : "user.notice.unknown.roleUnchanged",
                  {
                    role: t(roleLabelKey(state.role)),
                  },
                )
              : t(`user.notice.unknown.${state.kind}`)}
          </p>
        </Alert>
      );
    }
  }
}

type DialogState =
  | {
      action: "changeRole";
      role: AdminRole;
      selfTicked: boolean;
      refusal: MessageDescriptor | null;
    }
  | { action: "deactivate"; selfTicked: boolean; refusal: MessageDescriptor | null };

function UserDetail({ userId }: { userId: string }) {
  const { t, locale } = useI18n();
  const session = useSession();
  const permissions = session.state.me?.permissions ?? null;
  const meId = session.state.me?.user.id ?? null;
  const resource = useRefreshingResource(
    (signal) => adminClient.getUser(userId, { signal }),
    [userId],
  );
  const [flight] = useState(createSingleFlight);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<{ value: UserNotice; n: number; focus: boolean } | null>(
    null,
  );
  const [resetDirty, setResetDirty] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const crash = useCrash();

  // The role form starts at the stored role and follows it after every reload.
  const storedRole = resource.data?.role ?? null;
  const [roleChoice, setRoleChoice] = useState<{ base: AdminRole | null; value: AdminRole | null }>(
    { base: storedRole, value: storedRole },
  );
  if (roleChoice.base !== storedRole) setRoleChoice({ base: storedRole, value: storedRole });

  const roleDirty = roleChoice.value !== null && roleChoice.value !== storedRole;
  const blocker = useUnsavedChangesGuard((roleDirty || resetDirty) && !busy);
  const onResetDirty = useCallback((dirty: boolean) => setResetDirty(dirty), []);

  useEffect(() => {
    if (notice?.focus === true) statusRef.current?.focus();
  }, [notice]);

  const user = resource.data;
  const self = user !== null && isSelf(user.id, meId);
  const statusLine = (
    <StatusLine innerRef={statusRef}>
      {notice === null ? null : (
        <UserNoticeView t={t} notice={notice.value} user={user} refreshing={resource.refreshing} />
      )}
      {resource.refreshing ? (
        <p className="text-muted-foreground">{t("user.detail.reloading")}</p>
      ) : null}
    </StatusLine>
  );

  if (resource.fallback !== null || user === null) {
    // The status line stays: after a reset of the own password the next read is a 401 (the shell asks to sign in again).
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>{t("user.detail.title")}</PageHeading>
        {statusLine}
        {resource.fallback === null ? null : (
          <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
        )}
      </div>
    );
  }
  const current: AdminUser = user;
  const actions = offeredUserActions(current, permissions);
  const selectedRole = roleChoice.value ?? current.role;

  function announce(value: UserNotice, focus: boolean) {
    setNotice((previous) => ({ value, n: (previous?.n ?? 0) + 1, focus }));
  }

  /**
   * Sends one write through the single flight (a second submit while one runs sends nothing) and `runWrite` (once, never
   * retried). Whatever the answer, the user is read again, so the screen shows the server's state; nothing is optimistic.
   */
  async function send<T>(
    action: UserAction,
    write: () => Promise<AdminResult<T>>,
    sentRole?: AdminRole,
  ): Promise<WriteOutcome<T> | null> {
    const running = flight.run(() => runWrite(write));
    if (running === null) return null;
    setBusy(true);
    let outcome: WriteOutcome<T>;
    try {
      outcome = await running;
    } catch (bug) {
      crash(bug);
      return null;
    } finally {
      setBusy(false);
    }
    if (outcome.kind === "aborted") return outcome;
    if (outcome.kind === "ok") {
      setDialog(null);
      announce({ kind: "done", action, self }, true);
    } else if (outcome.kind === "problem") {
      const descriptor = describeUserRefusal(outcome.status, outcome.problem);
      // A refusal stays in the open dialog (explained there); the status line says it too.
      setDialog((open) => (open === null ? null : { ...open, refusal: descriptor }));
      announce({ kind: "refused", action, descriptor }, dialog === null);
    } else {
      setDialog(null);
      announce(
        {
          kind: "unknown",
          action,
          before: current,
          ...(sentRole === undefined ? {} : { sentRole }),
        },
        true,
      );
    }
    resource.reload();
    return outcome;
  }

  function perform(action: UserAction, role: AdminRole = selectedRole) {
    // The controls are only rendered for what the session may do; this keeps a stale click from sending anything else.
    if (!actions.includes(action)) return;
    if (action === "changeRole") {
      const patch = rolePatch(current, role);
      if (patch.role === undefined) return;
      void send(action, () => adminClient.updateUser(current.id, patch), patch.role);
    } else if (action === "deactivate" || action === "activate") {
      const patch = activityPatch(current, action === "activate");
      if (patch.isActive === undefined) return;
      void send(action, () => adminClient.updateUser(current.id, patch));
    }
  }

  function onAction(action: UserAction) {
    if (!actions.includes(action)) return;
    if (action === "changeRole") {
      setDialog({ action, role: selectedRole, selfTicked: false, refusal: null });
    } else if (action === "deactivate") {
      setDialog({ action, selfTicked: false, refusal: null });
    } else if (!confirmationOf(action, self).ask) {
      perform(action);
    }
  }

  function closeDialog() {
    if (!busy) setDialog(null);
  }

  function confirmDialog() {
    if (dialog === null) return;
    if (confirmationOf(dialog.action, self).selfCheck && !dialog.selfTicked) return;
    if (dialog.action === "changeRole") perform(dialog.action, dialog.role);
    else perform(dialog.action);
  }

  const common = {
    t,
    busy,
    email: current.email,
    self,
    onSelfTick: (ticked: boolean) =>
      setDialog((open) => (open === null ? null : { ...open, selfTicked: ticked })),
    onConfirm: confirmDialog,
    onClose: closeDialog,
  };

  return (
    <>
      <UserDetailView
        t={t}
        uiLocale={locale}
        user={current}
        self={self}
        actions={actions}
        selectedRole={selectedRole}
        onSelectRole={(role) => setRoleChoice({ base: storedRole, value: role })}
        onAction={onAction}
        busy={busy || resource.refreshing}
        statusLine={statusLine}
        resetForm={
          <ResetPasswordSection
            key={current.id}
            t={t}
            email={current.email}
            self={self}
            busy={busy || resource.refreshing}
            send={(newPassword) =>
              actions.includes("resetPassword")
                ? send("resetPassword", () =>
                    adminClient.resetUserPassword(current.id, { newPassword }),
                  )
                : Promise.resolve(null)
            }
            onDirtyChange={onResetDirty}
          />
        }
      />
      <RoleChangeDialog
        {...common}
        open={dialog?.action === "changeRole"}
        from={current.role}
        to={dialog?.action === "changeRole" ? dialog.role : selectedRole}
        selfTicked={dialog?.selfTicked ?? false}
        refusal={dialog?.action === "changeRole" ? dialog.refusal : null}
      />
      <DeactivateDialog
        {...common}
        open={dialog?.action === "deactivate"}
        selfTicked={dialog?.selfTicked ?? false}
        refusal={dialog?.action === "deactivate" ? dialog.refusal : null}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

/** `/users/:id`: one admin user with the role change, the activity and the password reset (owner only). */
export function UserDetailPage() {
  const { id } = useParams();
  if (id === undefined || id === "") throw new Error("The user route has no id.");
  return <UserDetail key={id} userId={id} />;
}
