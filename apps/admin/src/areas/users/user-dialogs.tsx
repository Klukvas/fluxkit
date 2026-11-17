import type { AdminRole } from "@fluxkit/api-client";
import type { Translator } from "@fluxkit/ui";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { confirmationOf, selfConsequence } from "./user-actions";
import { UserConfirmDialog } from "./user-parts";
import { roleLabelKey } from "./user-view";

/**
 * The confirmations of the user detail. Each spells out what the API does (`docs/api/auth.md`) before anything is sent;
 * for the owner's own account it adds what happens to their session and asks for an explicit tick where the plan wants
 * one (own role, own activity). The server decides; a refusal is explained inside the dialog.
 */

interface CommonProps {
  t: Translator;
  open: boolean;
  busy: boolean;
  email: string;
  self: boolean;
  selfTicked: boolean;
  refusal: MessageDescriptor | null;
  /** This action makes an owner account, so it asks for the actor's current password too (ADR 0058). */
  stepUp: boolean;
  onSelfTick: (ticked: boolean) => void;
  onConfirm: (currentPassword: string | null) => void;
  onClose: () => void;
}

export function RoleChangeDialog({
  t,
  from,
  to,
  ...props
}: CommonProps & { from: AdminRole; to: AdminRole }) {
  const consequence = selfConsequence("changeRole", props.self, to);
  return (
    <UserConfirmDialog
      t={t}
      open={props.open}
      busy={props.busy}
      title={t("user.roleDialog.title")}
      confirmation={confirmationOf("changeRole", props.self, props.stepUp)}
      selfTicked={props.selfTicked}
      selfCheckLabel={t("user.dialog.selfCheck")}
      refusal={props.refusal}
      confirmLabel={t("user.roleDialog.submit")}
      onSelfTick={props.onSelfTick}
      onConfirm={props.onConfirm}
      onClose={props.onClose}
    >
      <p>
        {t("user.roleDialog.body", {
          email: props.email,
          from: t(roleLabelKey(from)),
          to: t(roleLabelKey(to)),
        })}
      </p>
      <p>{t("user.roleDialog.nextRequest")}</p>
      <p>{t("user.roleDialog.lastOwner")}</p>
      {props.stepUp ? <p>{t("user.stepUp.promote")}</p> : null}
      {consequence === null ? null : <p className="font-medium">{t(`user.self.${consequence}`)}</p>}
    </UserConfirmDialog>
  );
}

export function DeactivateDialog({ t, ...props }: CommonProps) {
  const consequence = selfConsequence("deactivate", props.self);
  return (
    <UserConfirmDialog
      t={t}
      open={props.open}
      busy={props.busy}
      title={t("user.deactivateDialog.title")}
      confirmation={confirmationOf("deactivate", props.self, props.stepUp)}
      selfTicked={props.selfTicked}
      selfCheckLabel={t("user.dialog.selfCheck")}
      refusal={props.refusal}
      confirmLabel={t("user.deactivateDialog.submit")}
      onSelfTick={props.onSelfTick}
      onConfirm={props.onConfirm}
      onClose={props.onClose}
    >
      <p>{t("user.deactivateDialog.body", { email: props.email })}</p>
      <p>{t("user.deactivateDialog.sessions")}</p>
      <p>{t("user.deactivateDialog.lastOwner")}</p>
      {consequence === null ? null : <p className="font-medium">{t(`user.self.${consequence}`)}</p>}
    </UserConfirmDialog>
  );
}

/**
 * Activating a user needs no confirmation (nothing is lost), with one exception: reactivating an OWNER needs the
 * actor's current password, and this dialog is where it is typed.
 */
export function ActivateDialog({ t, ...props }: CommonProps) {
  return (
    <UserConfirmDialog
      t={t}
      open={props.open}
      busy={props.busy}
      title={t("user.activateDialog.title")}
      confirmation={confirmationOf("activate", props.self, props.stepUp)}
      selfTicked={props.selfTicked}
      selfCheckLabel={t("user.dialog.selfCheck")}
      refusal={props.refusal}
      confirmLabel={t("user.activateDialog.submit")}
      onSelfTick={props.onSelfTick}
      onConfirm={props.onConfirm}
      onClose={props.onClose}
    >
      <p>{t("user.activateDialog.body", { email: props.email })}</p>
      <p>{t("user.activateDialog.sessions")}</p>
      {props.stepUp ? <p>{t("user.stepUp.activate")}</p> : null}
    </UserConfirmDialog>
  );
}

export function ResetPasswordDialog({ t, ...props }: CommonProps) {
  const consequence = selfConsequence("resetPassword", props.self);
  return (
    <UserConfirmDialog
      t={t}
      open={props.open}
      busy={props.busy}
      title={t("user.resetDialog.title")}
      confirmation={confirmationOf("resetPassword", props.self, props.stepUp)}
      selfTicked={props.selfTicked}
      selfCheckLabel={t("user.dialog.selfCheck")}
      refusal={props.refusal}
      confirmLabel={t("user.resetDialog.submit")}
      onSelfTick={props.onSelfTick}
      onConfirm={props.onConfirm}
      onClose={props.onClose}
    >
      <p>{t("user.resetDialog.body", { email: props.email })}</p>
      <p>{t("user.resetDialog.sessions")}</p>
      {props.stepUp ? <p>{t("user.stepUp.reset")}</p> : null}
      {consequence === null ? (
        <p>{t("user.resetDialog.handover")}</p>
      ) : (
        <p className="font-medium">{t(`user.self.${consequence}`)}</p>
      )}
    </UserConfirmDialog>
  );
}
